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

import { test } from "bun:test";
import { Duplex } from "node:stream";
import { check } from "../../../test/support";
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
	check("a short frame is two bytes of header", small.length === 4);
	check("and says it is final text", small[0] === 0x81);
	check("with its length in the second byte", small[1] === 2);

	check("a medium frame widens its length", medium[1] === 126);
	check("and carries two length bytes", medium.readUInt16BE(2) === 300);

	check("a large frame widens it further", large[1] === 127);
	check("and carries eight length bytes", large.readBigUInt64BE(2) === 70_000n);

	check(
		"a medium frame survives the round trip",
		readFrames(medium, "unmasked").frames[0]?.payload.length === 300,
	);
	check(
		"and so does a large one",
		readFrames(large, "unmasked").frames[0]?.payload.length === 70_000,
	);
});
test("reading frames back", async () => {
	const read = readFrames(small, "unmasked");
	check("a whole frame is read", read.frames.length === 1);
	check("with its opcode", read.frames[0]?.opcode === OPCODE.text);
	check("with its payload", read.frames[0]?.payload.toString() === "hi");
	check("and nothing left over", read.rest.length === 0);

	const masked = encodeFrame(OPCODE.text, Buffer.from("secret"), true);
	check("a masked frame is longer by its key", masked.length === 2 + 4 + 6);
	check(
		"and is unreadable without unmasking",
		readFrames(masked, "masked").frames[0]?.payload.toString() === "secret",
	);
	check(
		"the client's masking is required, not tolerated",
		(() => {
			try {
				readFrames(masked, "unmasked");
				return false;
			} catch (error) {
				return error instanceof WireProtocolError;
			}
		})(),
	);
	check(
		"and so is the server's",
		(() => {
			try {
				readFrames(small, "masked");
				return false;
			} catch (error) {
				return error instanceof WireProtocolError;
			}
		})(),
	);
});
test("a frame in two pieces", async () => {
	const whole = encodeFrame(OPCODE.text, Buffer.from("split me"), false);
	const firstHalf = readFrames(whole.subarray(0, 4), "unmasked");
	check("a partial frame reads as nothing", firstHalf.frames.length === 0);
	check("and is kept whole", firstHalf.rest.length === 4);
	const secondHalf = readFrames(
		Buffer.concat([firstHalf.rest, whole.subarray(4)]),
		"unmasked",
	);
	check("which the next read completes", secondHalf.frames.length === 1);
	check(
		"with the payload intact",
		secondHalf.frames[0]?.payload.toString() === "split me",
	);

	const two = Buffer.concat([
		encodeFrame(OPCODE.text, Buffer.from("one"), false),
		encodeFrame(OPCODE.text, Buffer.from("two"), false),
	]);
	check(
		"two frames in one read",
		readFrames(two, "unmasked").frames.length === 2,
	);
});
test("what the protocol will not carry", async () => {
	check(
		"an opcode nobody speaks is refused",
		(() => {
			try {
				readFrames(Buffer.from([0x83, 0x00]), "unmasked");
				return false;
			} catch (error) {
				return error instanceof WireProtocolError;
			}
		})(),
	);
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
	check(
		"what a client sends comes back unmasked",
		echoing.messages[0] === "hello",
	);

	const serving = peerOn("server");
	serving.peer.send("hello");
	await tick();
	check("and so does a server's", serving.messages[0] === "hello");

	const fragmented = peerOn("client");
	fragmented.peer.send("ignored");
	await tick();
	const socket = (fragmented.peer as unknown as { socket: Duplex }).socket;
	check("the peer holds a socket", socket instanceof Duplex);
	socket.write(encodeFrame(OPCODE.text, Buffer.from("one "), true, false));
	socket.write(encodeFrame(OPCODE.continuation, Buffer.from("message"), true));
	await tick();
	check(
		"a message split across frames arrives as one",
		fragmented.messages[1] === "one message",
	);

	const binary = peerOn("client");
	(binary.peer as unknown as { socket: Duplex }).socket.write(
		encodeFrame(OPCODE.binary, Buffer.from([1, 2, 3]), true),
	);
	await tick();
	check("a binary frame ends the peer", binary.closes.length === 1);
	check("saying why", binary.closes[0]?.includes("text") === true);

	const pong = peerOn("server");
	(pong.peer as unknown as { socket: Duplex }).socket.write(
		encodeFrame(OPCODE.ping, Buffer.from("beat"), false),
	);
	await tick();
	check("a ping is answered", pong.messages.length === 0);
	check("without becoming a message", pong.closes.length === 0);

	const said = peerOn("client");
	(said.peer as unknown as { socket: Duplex }).socket.write(
		encodeFrame(OPCODE.close, closePayload(1000, "bye"), true),
	);
	await tick();
	check("a close is reported once", said.closes.length === 1);
	check(
		"with the peer's own words",
		said.closes[0] === "the peer said goodbye",
	);
	said.peer.close("again");
	check("and closing again adds nothing", said.closes.length === 1);
});
test("the upgrade's own arithmetic", async () => {
	check(
		"the accept key is the protocol's own example",
		acceptKey("dGhlIHNhbXBsZSBub25jZQ==") === "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
	);
	check(
		"a plain GET is not an upgrade",
		!isUpgradeRequest("GET", { upgrade: "websocket" }),
	);
	check(
		"an upgrade without a key is not one",
		!isUpgradeRequest("GET", {
			upgrade: "websocket",
			connection: "Upgrade",
			"sec-websocket-key": "",
		}),
	);
	check(
		"the panel's own request is one",
		isUpgradeRequest("GET", {
			upgrade: "websocket",
			connection: "keep-alive, Upgrade",
			"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
		}),
	);
	check(
		"a POST is never one",
		!isUpgradeRequest("POST", {
			upgrade: "websocket",
			connection: "Upgrade",
			"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
		}),
	);

	const refused = refusalResponse(403, "this peer may not watch the browser");
	check(
		"a refusal is a real answer",
		refused.startsWith("HTTP/1.1 403 Forbidden"),
	);
	check(
		"with a readable reason",
		refused.includes("may not watch the browser"),
	);
	check(
		"and a length the reader can trust",
		refused.includes("Content-Length: "),
	);
});
