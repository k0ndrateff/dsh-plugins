/**
 * The WebSocket framing this plugin speaks, and nothing else.
 *
 * Two connections run through it in opposite directions: the client that watches
 * agent-browser's screencast, and the server that hands frames to the panel. A
 * dependency would bring a whole protocol stack for the four opcodes these two
 * use, so the codec is ours — one encoder and one incremental reader, told which
 * masking its side of the connection requires.
 */

import { randomBytes } from "node:crypto";

/** The opcodes either side of these two connections uses. */
export const OPCODE = {
	continuation: 0x0,
	text: 0x1,
	binary: 0x2,
	close: 0x8,
	ping: 0x9,
	pong: 0xa,
} as const;

export type Opcode = (typeof OPCODE)[keyof typeof OPCODE];

/** Which masking the reader must find, and therefore the writer must apply. */
export type Masking = "masked" | "unmasked";

/** One frame, as it arrived. */
export interface WireFrame {
	readonly opcode: Opcode;
	readonly payload: Buffer;
	/** Whether this frame ends its message; a continuation arrives with `false`. */
	readonly fin: boolean;
}

/** What one read of a socket turned into. */
export interface WireRead {
	readonly frames: readonly WireFrame[];
	/** Bytes of an incomplete frame, to be prepended to the next read. */
	readonly rest: Buffer;
}

/** A peer that broke the framing rule this side of the connection requires. */
export class WireProtocolError extends Error {}

/** The one opcode set this plugin understands, for reading a peer's own byte. */
const KNOWN_OPCODES: readonly number[] = Object.values(OPCODE);

/** The two-byte length's own value, and the eight-byte length's. */
const SHORT_LENGTH = 126;
const LONG_LENGTH = 127;

/** The mask bit, in the second byte of a frame's header. */
const MASK_BIT = 0x80;

/** The final-frame bit, in the first byte. */
const FIN_BIT = 0x80;

/**
 * One frame as bytes.
 * @param opcode - what the payload is.
 * @param payload - the bytes themselves.
 * @param mask - whether to mask them, which a client must and a server must not.
 * @param fin - whether this frame ends its message; `false` starts one a
 *   continuation finishes.
 */
export const encodeFrame = (
	opcode: Opcode,
	payload: Buffer,
	mask: boolean,
	fin = true,
): Buffer => {
	const header = Buffer.alloc(1 + 1);
	header[0] = (fin ? FIN_BIT : 0) | opcode;

	const length = payload.length;
	const maskBit = mask ? MASK_BIT : 0;

	if (length < SHORT_LENGTH) {
		header[1] = maskBit | length;

		return withMask(header, payload, mask);
	}

	if (length < 65_536) {
		header[1] = maskBit | SHORT_LENGTH;

		const extended = Buffer.alloc(2);
		extended.writeUInt16BE(length);

		return withMask(Buffer.concat([header, extended]), payload, mask);
	}

	header[1] = maskBit | LONG_LENGTH;

	const extended = Buffer.alloc(8);
	extended.writeBigUInt64BE(BigInt(length));

	return withMask(Buffer.concat([header, extended]), payload, mask);
};

/** The payload behind its header, masked with a fresh key when asked. */
const withMask = (header: Buffer, payload: Buffer, mask: boolean): Buffer => {
	if (!mask) return Buffer.concat([header, payload]);

	const key = randomBytes(4);
	const masked = Buffer.alloc(payload.length);

	for (let index = 0; index < payload.length; index += 1)
		masked[index] = (payload[index] ?? 0) ^ (key[index % 4] ?? 0);

	return Buffer.concat([header, key, masked]);
};

/**
 * Read every whole frame in a buffer, and keep the remainder.
 * @param buffer - the bytes read so far, frame-aligned at the front.
 * @param expect - the masking this side requires of its peer.
 * @throws WireProtocolError when a frame breaks that rule, or names an opcode
 *   this plugin does not speak: a stream that quietly half-works is worse than
 *   one that stops.
 */
export const readFrames = (buffer: Buffer, expect: Masking): WireRead => {
	const frames: WireFrame[] = [];
	let offset = 0;

	while (offset + 2 <= buffer.length) {
		const first = buffer[offset] ?? 0;
		const second = buffer[offset + 1] ?? 0;
		const opcode = first & 0x0f;

		if (!KNOWN_OPCODES.includes(opcode))
			throw new WireProtocolError(
				`opcode ${opcode} is not one this plugin speaks`,
			);

		const masked = (second & MASK_BIT) !== 0;

		if ((expect === "masked") !== masked)
			throw new WireProtocolError(
				`this side of the connection expects ${expect} frames`,
			);

		let length = second & 0x7f;
		let header = 2;

		if (length === SHORT_LENGTH) {
			if (offset + 4 > buffer.length) break;

			length = buffer.readUInt16BE(offset + 2);
			header = 4;
		} else if (length === LONG_LENGTH) {
			if (offset + 10 > buffer.length) break;

			const wide = buffer.readBigUInt64BE(offset + 2);

			if (wide > BigInt(Number.MAX_SAFE_INTEGER))
				throw new WireProtocolError("a frame larger than this plugin can hold");

			length = Number(wide);
			header = 10;
		}

		const keyLength = masked ? 4 : 0;
		const start = offset + header + keyLength;

		if (start + length > buffer.length) break;

		const payload = Buffer.from(buffer.subarray(start, start + length));

		if (masked) {
			const key = buffer.subarray(offset + header, offset + header + 4);

			for (let index = 0; index < payload.length; index += 1)
				payload[index] = (payload[index] ?? 0) ^ (key[index % 4] ?? 0);
		}

		frames.push({
			opcode: opcode as Opcode,
			payload,
			fin: (first & FIN_BIT) !== 0,
		});
		offset = start + length;
	}

	return { frames, rest: buffer.subarray(offset) };
};

/** The payload of a close frame: a two-byte code, then a reason. */
export const closePayload = (code: number, reason: string): Buffer => {
	const head = Buffer.alloc(2);
	head.writeUInt16BE(code);

	return Buffer.concat([head, Buffer.from(reason, "utf8")]);
};
