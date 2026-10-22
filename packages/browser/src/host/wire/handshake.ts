/**
 * The HTTP half of a WebSocket upgrade.
 *
 * `webServer.registerUpgrade` hands over the socket before any negotiation, so
 * this plugin owns it: the accept key is the SHA-1 of the client's key and the
 * protocol's own constant, and a refusal has to be a real HTTP answer rather
 * than a dropped socket — a browser that only sees the connection close reports
 * nothing a reader can act on.
 */

import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

/** The constant every WebSocket accept key is hashed with. */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Where a client puts the key its accept is derived from. */
export const KEY_HEADER = "sec-websocket-key";

/** The accept key for one client key. */
export const acceptKey = (clientKey: string): string =>
	createHash("sha1")
		.update(clientKey + GUID)
		.digest("base64");

/**
 * Whether one request is an upgrade this plugin can answer.
 * @param method - the request's method.
 * @param headers - the request's headers, as node hands them over.
 */
export const isUpgradeRequest = (
	method: string | undefined,
	headers: IncomingHttpHeaders,
): boolean =>
	method === "GET" &&
	String(headers.upgrade ?? "").toLowerCase() === "websocket" &&
	String(headers.connection ?? "")
		.toLowerCase()
		.includes("upgrade") &&
	typeof headers[KEY_HEADER] === "string" &&
	headers[KEY_HEADER] !== "";

/** The 101 that completes one upgrade. */
export const acceptResponse = (clientKey: string): string =>
	[
		"HTTP/1.1 101 Switching Protocols",
		"Upgrade: websocket",
		"Connection: Upgrade",
		`Sec-WebSocket-Accept: ${acceptKey(clientKey)}`,
		"",
		"",
	].join("\r\n");

/**
 * A refusal, as an HTTP answer the other side can read.
 * @param status - the status line's code, such as 403.
 * @param reason - one line saying why.
 */
export const refusalResponse = (status: number, reason: string): string => {
	const body = `${reason}\n`;

	return [
		`HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Bad Request"}`,
		"Content-Type: text/plain; charset=utf-8",
		`Content-Length: ${Buffer.byteLength(body, "utf8")}`,
		"Connection: close",
		"",
		body,
	].join("\r\n");
};
