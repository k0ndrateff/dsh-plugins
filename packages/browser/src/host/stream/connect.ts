/**
 * The client end of agent-browser's screencast.
 *
 * A loopback socket plus the two lines of HTTP that turn it into a WebSocket.
 * The upgrade is negotiated here rather than by `WirePeer`, because the peer must
 * not meet the HTTP answer at all — and the bytes that arrive behind that answer
 * belong to the peer, so they are pushed back onto the socket before it is
 * handed over.
 */

import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { acceptKey, KEY_HEADER } from "../wire/handshake";
import { WirePeer } from "../wire/peer";

/** How long the upgrade may take before the socket is given up on. */
const UPGRADE_TIMEOUT_MS = 5_000;

/** What one peer is built with. */
export interface StreamHandlers {
	readonly onMessage: (text: string) => void;
	readonly onClose: (reason: string) => void;
	readonly heartbeatMs?: number;
}

/** The request that asks for the upgrade. */
const requestFor = (port: number, key: string): string =>
	[
		"GET / HTTP/1.1",
		`Host: 127.0.0.1:${port}`,
		"Upgrade: websocket",
		"Connection: Upgrade",
		`${KEY_HEADER}: ${key}`,
		"Sec-WebSocket-Version: 13",
		"",
		"",
	].join("\r\n");

/** Whether one HTTP answer completes the upgrade this client asked for. */
const isAccepted = (head: string, key: string): boolean => {
	if (!/^HTTP\/1\.1 101\b/u.test(head)) return false;

	const expected = acceptKey(key).toLowerCase();

	return head.split("\r\n").some(
		(line) =>
			line.slice(0, line.indexOf(":")).trim().toLowerCase() ===
				"sec-websocket-accept" &&
			line
				.slice(line.indexOf(":") + 1)
				.trim()
				.toLowerCase() === expected,
	);
};

/** Negotiate the upgrade, and leave the socket positioned on the first frame. */
const upgrade = (socket: Socket, port: number, key: string): Promise<void> =>
	new Promise((resolve, reject) => {
		let received = Buffer.alloc(0);

		const settle = (): void => {
			clearTimeout(timer);
			socket.off("data", onData);
			socket.off("error", onError);
		};

		const onError = (error: Error): void => {
			settle();
			reject(error);
		};

		const onData = (chunk: Buffer): void => {
			received = Buffer.concat([received, chunk]);

			const end = received.indexOf("\r\n\r\n");
			if (end === -1) return;

			const head = received.subarray(0, end).toString("latin1");
			const rest = received.subarray(end + 4);

			settle();

			if (!isAccepted(head, key)) {
				socket.destroy();
				reject(new Error("the screencast refused the upgrade"));

				return;
			}

			// Whatever arrived behind the answer is the peer's first frame.
			socket.pause();
			if (rest.length > 0) socket.unshift(rest);
			resolve();
		};

		const timer = setTimeout(() => {
			settle();
			socket.destroy();
			reject(new Error("the screencast did not answer the upgrade"));
		}, UPGRADE_TIMEOUT_MS);

		timer.unref();
		socket.on("error", onError);
		socket.on("data", onData);
		socket.on("connect", () => socket.write(requestFor(port, key)));
	});

/**
 * Open one connection to a session's screencast.
 * @param port - the loopback port `stream status` named.
 * @param handlers - this connection's readers and its heartbeat.
 * @throws when the socket cannot be reached, or the screencast refuses it.
 */
export const connectStream = async (
	port: number,
	handlers: StreamHandlers,
): Promise<WirePeer> => {
	const socket = connect({ host: "127.0.0.1", port });
	const key = randomBytes(16).toString("base64");

	try {
		await upgrade(socket, port, key);
	} catch (error) {
		socket.destroy();

		throw error;
	}

	const peer = new WirePeer(socket, {
		role: "client",
		onMessage: handlers.onMessage,
		onClose: handlers.onClose,
		...(handlers.heartbeatMs === undefined
			? {}
			: { heartbeatMs: handlers.heartbeatMs }),
	});

	// The upgrade paused the socket so the bytes behind the HTTP answer would not
	// be emitted into nothing, and attaching a listener does not resume a stream
	// that was paused on purpose: without this, the screencast connects and then
	// says nothing at all.
	socket.resume();

	return peer;
};
