/**
 * The framing, the handshake, and one peer over a socket that only echoes.
 *
 * The WebSocket here is ours, so every case is about our own rules: how a frame
 * is laid out at each length, whose frames are masked, what happens when a frame
 * arrives in two pieces, and what a peer does with a ping, a close, or a frame
 * nobody should have sent.
 *
 *   bun run test/wire.ts
 */

import { expect, test } from "bun:test";
import { Duplex } from "node:stream";
import {
	closePayload,
	encodeFrame,
	type Masking,
	OPCODE,
	readFrames,
	WireProtocolError,
} from "../src/host/wire/frame";
import {
	acceptKey,
	isUpgradeRequest,
	refusalResponse,
} from "../src/host/wire/handshake";
import { WirePeer } from "../src/host/wire/peer";

/**
 * A socket that answers the way the other side would: the same frames back, with
 * the masking rule flipped. A plain echo would hand this peer its own masking
 * back and prove nothing about the rule the peer must enforce on the way in.
 */
class Loopback extends Duplex {
	/** @param outgoing - how this peer writes, so the answer can be the opposite. */
	constructor(private readonly outgoing: Masking) {
		super();
	}

	override _read(): void {}

	override _write(
		chunk: Buffer,
		_encoding: BufferEncoding,
		done: (error?: Error | null) => void,
	): void {
		try {
			const read = readFrames(chunk, this.outgoing);

			for (const frame of read.frames)
				this.push(
					encodeFrame(
						frame.opcode,
						frame.payload,
						this.outgoing !== "masked",
						frame.fin,
					),
				);

			done();
		} catch (error) {
			done(error as Error);
		}
	}
}

/** One peer over a socket that answers as the other side, and what it heard. */
const peerOn = (role: "client" | "server") => {
	const messages: string[] = [];
	const closes: string[] = [];
	const peer = new WirePeer(
		new Loopback(role === "client" ? "masked" : "unmasked"),
		{
			role,
			onMessage: (text) => messages.push(text),
			onClose: (reason) => closes.push(reason),
			heartbeatMs: 0,
		},
	);

	return { peer, messages, closes };
};

const small = encodeFrame(OPCODE.text, Buffer.from("hi"), false);
const medium = encodeFrame(OPCODE.text, Buffer.alloc(300), false);
const large = encodeFrame(OPCODE.text, Buffer.alloc(70_000), false);

test("one frame, as bytes", async () => {
	expect(small.length === 4, "a short frame is two bytes of header").toBe(true);
	expect(small[0] === 0x81, "and says it is final text").toBe(true);
	expect(small[1] === 2, "with its length in the second byte").toBe(true);

	expect(medium[1] === 126, "a medium frame widens its length").toBe(true);
	expect(medium.readUInt16BE(2) === 300, "and carries two length bytes").toBe(
		true,
	);

	expect(large[1] === 127, "a large frame widens it further").toBe(true);
	expect(
		large.readBigUInt64BE(2) === 70_000n,
		"and carries eight length bytes",
	).toBe(true);

	expect(
		readFrames(medium, "unmasked").frames[0]?.payload.length === 300,
		"a medium frame survives the round trip",
	).toBe(true);
	expect(
		readFrames(large, "unmasked").frames[0]?.payload.length === 70_000,
		"and so does a large one",
	).toBe(true);
});
test("reading frames back", async () => {
	const read = readFrames(small, "unmasked");
	expect(read.frames.length === 1, "a whole frame is read").toBe(true);
	expect(read.frames[0]?.opcode === OPCODE.text, "with its opcode").toBe(true);
	expect(read.frames[0]?.payload.toString() === "hi", "with its payload").toBe(
		true,
	);
	expect(read.rest.length === 0, "and nothing left over").toBe(true);

	const masked = encodeFrame(OPCODE.text, Buffer.from("secret"), true);
	expect(
		masked.length === 2 + 4 + 6,
		"a masked frame is longer by its key",
	).toBe(true);
	expect(
		readFrames(masked, "masked").frames[0]?.payload.toString() === "secret",
		"and is unreadable without unmasking",
	).toBe(true);
	expect(
		(() => {
			try {
				readFrames(masked, "unmasked");
				return false;
			} catch (error) {
				return error instanceof WireProtocolError;
			}
		})(),
		"the client's masking is required, not tolerated",
	).toBe(true);
	expect(
		(() => {
			try {
				readFrames(small, "masked");
				return false;
			} catch (error) {
				return error instanceof WireProtocolError;
			}
		})(),
		"and so is the server's",
	).toBe(true);
});
test("a frame in two pieces", async () => {
	const whole = encodeFrame(OPCODE.text, Buffer.from("split me"), false);
	const firstHalf = readFrames(whole.subarray(0, 4), "unmasked");
	expect(
		firstHalf.frames.length === 0,
		"a partial frame reads as nothing",
	).toBe(true);
	expect(firstHalf.rest.length === 4, "and is kept whole").toBe(true);
	const secondHalf = readFrames(
		Buffer.concat([firstHalf.rest, whole.subarray(4)]),
		"unmasked",
	);
	expect(secondHalf.frames.length === 1, "which the next read completes").toBe(
		true,
	);
	expect(
		secondHalf.frames[0]?.payload.toString() === "split me",
		"with the payload intact",
	).toBe(true);

	const two = Buffer.concat([
		encodeFrame(OPCODE.text, Buffer.from("one"), false),
		encodeFrame(OPCODE.text, Buffer.from("two"), false),
	]);
	expect(
		readFrames(two, "unmasked").frames.length === 2,
		"two frames in one read",
	).toBe(true);
});
test("what the protocol will not carry", async () => {
	expect(
		(() => {
			try {
				readFrames(Buffer.from([0x83, 0x00]), "unmasked");
				return false;
			} catch (error) {
				return error instanceof WireProtocolError;
			}
		})(),
		"an opcode nobody speaks is refused",
	).toBe(true);
});
test("one peer over an echoing socket", async () => {
	/** Let what was written come back through the socket. */
	const tick = (): Promise<void> =>
		new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

	const echoing = peerOn("client");
	echoing.peer.send("hello");
	await tick();
	expect(
		echoing.messages[0] === "hello",
		"what a client sends comes back unmasked",
	).toBe(true);

	const serving = peerOn("server");
	serving.peer.send("hello");
	await tick();
	expect(serving.messages[0] === "hello", "and so does a server's").toBe(true);

	const fragmented = peerOn("client");
	fragmented.peer.send("ignored");
	await tick();
	const socket = (fragmented.peer as unknown as { socket: Duplex }).socket;
	expect(socket instanceof Duplex, "the peer holds a socket").toBe(true);
	socket.write(encodeFrame(OPCODE.text, Buffer.from("one "), true, false));
	socket.write(encodeFrame(OPCODE.continuation, Buffer.from("message"), true));
	await tick();
	expect(
		fragmented.messages[1] === "one message",
		"a message split across frames arrives as one",
	).toBe(true);

	const binary = peerOn("client");
	(binary.peer as unknown as { socket: Duplex }).socket.write(
		encodeFrame(OPCODE.binary, Buffer.from([1, 2, 3]), true),
	);
	await tick();
	expect(binary.closes.length === 1, "a binary frame ends the peer").toBe(true);
	expect(binary.closes[0]?.includes("text") === true, "saying why").toBe(true);

	const pong = peerOn("server");
	(pong.peer as unknown as { socket: Duplex }).socket.write(
		encodeFrame(OPCODE.ping, Buffer.from("beat"), false),
	);
	await tick();
	expect(pong.messages.length === 0, "a ping is answered").toBe(true);
	expect(pong.closes.length === 0, "without becoming a message").toBe(true);

	const said = peerOn("client");
	(said.peer as unknown as { socket: Duplex }).socket.write(
		encodeFrame(OPCODE.close, closePayload(1000, "bye"), true),
	);
	await tick();
	expect(said.closes.length === 1, "a close is reported once").toBe(true);
	expect(
		said.closes[0] === "the peer said goodbye",
		"with the peer's own words",
	).toBe(true);
	said.peer.close("again");
	expect(said.closes.length === 1, "and closing again adds nothing").toBe(true);
});
test("the upgrade's own arithmetic", async () => {
	expect(
		acceptKey("dGhlIHNhbXBsZSBub25jZQ==") === "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
		"the accept key is the protocol's own example",
	).toBe(true);
	expect(
		!isUpgradeRequest("GET", { upgrade: "websocket" }),
		"a plain GET is not an upgrade",
	).toBe(true);
	expect(
		!isUpgradeRequest("GET", {
			upgrade: "websocket",
			connection: "Upgrade",
			"sec-websocket-key": "",
		}),
		"an upgrade without a key is not one",
	).toBe(true);
	expect(
		isUpgradeRequest("GET", {
			upgrade: "websocket",
			connection: "keep-alive, Upgrade",
			"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
		}),
		"the panel's own request is one",
	).toBe(true);
	expect(
		!isUpgradeRequest("POST", {
			upgrade: "websocket",
			connection: "Upgrade",
			"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
		}),
		"a POST is never one",
	).toBe(true);

	const refused = refusalResponse(403, "this peer may not watch the browser");
	expect(
		refused.startsWith("HTTP/1.1 403 Forbidden"),
		"a refusal is a real answer",
	).toBe(true);
	expect(
		refused.includes("may not watch the browser"),
		"with a readable reason",
	).toBe(true);
	expect(
		refused.includes("Content-Length: "),
		"and a length the reader can trust",
	).toBe(true);
});
