/**
 * One WebSocket over a socket that is already upgraded.
 *
 * The two connections this plugin holds differ only in masking, which is why
 * this is one class: one reader, one writer, one heartbeat, told once whether it
 * is the client or the server side. Both speak text and nothing else, so a
 * binary frame is a protocol error rather than a message nobody can read.
 */

import type { Duplex } from "node:stream";
import { errorText } from "../text";
import {
	closePayload,
	encodeFrame,
	type Masking,
	OPCODE,
	type Opcode,
	readFrames,
	type WireFrame,
	type WireRead,
} from "./frame";

/** How long a peer may stay silent before a ping goes out. */
export const DEFAULT_HEARTBEAT_MS = 25_000;

/** The close code for a peer that broke the protocol. */
const PROTOCOL_ERROR = 1002;

/** The largest message this plugin will assemble, in bytes. */
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/** The close code for an ordinary goodbye. */
const NORMAL_CLOSURE = 1000;

/** What one peer reports and needs. */
export interface WirePeerOptions {
	/** Which side of the connection this is, and therefore how it masks. */
	readonly role: "client" | "server";
	readonly onMessage: (text: string) => void;
	/** Called exactly once, with the reason the connection ended. */
	readonly onClose: (reason: string) => void;
	readonly heartbeatMs?: number;
}

export class WirePeer {
	private buffer: Buffer = Buffer.alloc(0);
	private fragments: Buffer[] = [];
	private finished = false;
	private heartbeat: NodeJS.Timeout | undefined;
	private readonly outgoing: Masking;
	/** What this side must find on the way in — the other side's rule. */
	private readonly incoming: Masking;

	/**
	 * @param socket - the socket an upgrade already handed over.
	 * @param options - this side's role, its readers, and its heartbeat.
	 */
	constructor(
		private readonly socket: Duplex,
		private readonly options: WirePeerOptions,
	) {
		// A client masks what it sends and reads unmasked frames back; a server is
		// the mirror of that. One rule applied to both directions would let every
		// frame through and read none of them.
		this.outgoing = options.role === "client" ? "masked" : "unmasked";
		this.incoming = options.role === "client" ? "unmasked" : "masked";
		socket.on("data", (chunk: Buffer) => this.read(chunk));
		socket.on("error", (error: Error) => this.finish(errorText(error)));
		socket.on("close", () => this.finish("the connection closed"));

		const beat = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

		if (beat > 0) {
			// A heartbeat nobody can be reached through must not hold the process up.
			this.heartbeat = setInterval(() => this.ping(), beat).unref();
		}
	}

	/** Whether this peer has ended. */
	get closed(): boolean {
		return this.finished;
	}

	/** Send one text message. */
	send(text: string): void {
		this.write(OPCODE.text, Buffer.from(text, "utf8"));
	}

	/** Say goodbye the way the protocol asks, then end the socket. */
	close(reason = ""): void {
		this.finish(reason === "" ? "closed" : reason, {
			opcode: OPCODE.close,
			payload: closePayload(NORMAL_CLOSURE, reason),
		});
	}

	/** One frame out, masked or not according to this side. */
	private write(opcode: number, payload: Buffer): void {
		if (this.finished) return;

		try {
			this.socket.write(
				encodeFrame(opcode as never, payload, this.outgoing === "masked"),
			);
		} catch (error) {
			this.finish(errorText(error));
		}
	}

	/** One heartbeat, which also proves the socket is still writable. */
	private ping(): void {
		this.write(OPCODE.ping, Buffer.alloc(0));
	}

	/** Everything one read of the socket carried. */
	private read(chunk: Buffer): void {
		if (this.finished) return;

		this.buffer =
			this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

		if (this.buffer.length > MAX_MESSAGE_BYTES) {
			this.fail("a message is larger than this plugin accepts");

			return;
		}

		let read: WireRead;

		try {
			read = readFrames(this.buffer, this.incoming);
		} catch (error) {
			this.fail(errorText(error));

			return;
		}

		this.buffer = read.rest;

		for (const frame of read.frames) {
			if (this.finished) return;

			this.deliver(frame);
		}
	}

	/** One whole frame, by what it asks for. */
	private deliver(frame: WireFrame): void {
		switch (frame.opcode) {
			case OPCODE.text:
				this.fragments = [frame.payload];

				if (frame.fin) this.assemble();

				return;

			case OPCODE.continuation:
				if (this.fragments.length === 0) {
					this.fail("a continuation with nothing to continue");

					return;
				}

				if (this.fragmentBytes() + frame.payload.length > MAX_MESSAGE_BYTES) {
					this.fail("a message is larger than this plugin accepts");

					return;
				}

				this.fragments.push(frame.payload);

				if (frame.fin) this.assemble();

				return;

			case OPCODE.binary:
				this.fail("this plugin speaks text");

				return;

			case OPCODE.ping:
				this.write(OPCODE.pong, frame.payload);

				return;

			case OPCODE.pong:
				return;

			case OPCODE.close:
				this.close("the peer said goodbye");

				return;
		}
	}

	/** The bytes already collected for one fragmented message. */
	private fragmentBytes(): number {
		return this.fragments.reduce((total, part) => total + part.length, 0);
	}

	/** One message, out of however many frames carried it. */
	private assemble(): void {
		const text = Buffer.concat(this.fragments).toString("utf8");

		this.fragments = [];
		this.options.onMessage(text);
	}

	/** Stop this peer because its framing cannot be trusted. */
	private fail(reason: string): void {
		this.finish(reason, {
			opcode: OPCODE.close,
			payload: closePayload(PROTOCOL_ERROR, reason),
		});
	}

	/**
	 * End exactly once, whoever asked.
	 *
	 * The goodbye is written *after* this peer is already finished, and that order
	 * is the point: a socket that echoes what it is given would otherwise hand our
	 * own close frame back to us while this peer still looked open, and the reason
	 * a reader is told would be the echo's rather than ours.
	 */
	private finish(
		reason: string,
		goodbye?: { opcode: Opcode; payload: Buffer },
	): void {
		if (this.finished) return;

		this.finished = true;

		if (this.heartbeat !== undefined) {
			clearInterval(this.heartbeat);
			this.heartbeat = undefined;
		}

		if (goodbye !== undefined) {
			try {
				this.socket.write(
					encodeFrame(
						goodbye.opcode,
						goodbye.payload,
						this.outgoing === "masked",
					),
				);
			} catch {
				// The socket is already gone; the reason this peer ended still stands.
			}

			this.socket.end();
		}

		this.options.onClose(reason);
	}
}
