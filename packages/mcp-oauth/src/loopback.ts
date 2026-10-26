/**
 * The loopback redirect listener for the authorization-code flow.
 *
 * A desktop OAuth client cannot receive a redirect on a public URL, so it binds
 * `127.0.0.1` and hands the browser a redirect URI pointing at itself. The
 * registered client is bound to the exact URI, and the preferred port may be
 * taken, so the listener reports the port it actually got.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { PORT_ATTEMPTS } from "./config";
import { errorText } from "./log";

/** The five characters a callback page interpolates, as HTML entities. */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** One string as text inside an HTML page. */
const escapeHtml = (value: string): string =>
	value.replace(
		/[&<>"']/gu,
		(character) => HTML_ENTITIES[character] ?? character,
	);

export class LoopbackListener {
	readonly server: Server;
	readonly port: number;
	readonly redirectUri: string;
	/** Resolves with the authorization code the browser returned. */
	readonly code: Promise<string>;

	readonly fail: (error: Error) => void;

	protected constructor(
		server: Server,
		port: number,
		redirectUri: string,
		code: Promise<string>,
		fail: (error: Error) => void,
	) {
		this.server = server;
		this.port = port;
		this.redirectUri = redirectUri;
		this.code = code;
		this.fail = fail;
	}

	/**
	 * Bind the first free port at or after `preferredPort` and wait for the code.
	 * @param preferredPort - the configured port to try first.
	 * @param expectedState - the `state` value the response must carry back.
	 * @param label - the provider's name, for the pages the browser sees.
	 */
	static async listenForCode(
		preferredPort: number,
		expectedState: string,
		label: string,
	): Promise<LoopbackListener> {
		let resolveCode: (code: string) => void = () => {};
		let rejectCode: (error: Error) => void = () => {};

		const code = new Promise<string>((resolve, reject) => {
			resolveCode = resolve;
			rejectCode = reject;
		});

		// The caller always awaits `code`; this keeps a rejection observed even when
		// it settles before that await is attached.
		code.catch(() => undefined);

		let lastError: unknown;

		for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
			const port = preferredPort + offset;

			const server = createServer((request, response) => {
				const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

				if (url.pathname !== "/callback") {
					response
						.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
						.end("not found");
					return;
				}

				const gotState = url.searchParams.get("state") ?? "";
				const oauthError = url.searchParams.get("error");
				const returned = url.searchParams.get("code");

				const comparable =
					Buffer.byteLength(gotState) === Buffer.byteLength(expectedState);
				const stateMatches =
					comparable &&
					timingSafeEqual(Buffer.from(gotState), Buffer.from(expectedState));

				if (oauthError !== null || returned === null || !stateMatches) {
					const reason =
						oauthError !== null
							? `The provider did not authorize the sign-in (${oauthError}). You can close this tab and try again from DeepSeek Harness.`
							: "This sign-in attempt could not be verified. Close this tab and start the sign-in again from DeepSeek Harness.";

					response
						.writeHead(400, { "content-type": "text/html; charset=utf-8" })
						.end(
							LoopbackListener.callbackPage(
								`Could not sign in to ${label}`,
								reason,
							),
						);

					rejectCode(
						new Error(
							oauthError !== null
								? `authorization denied: ${oauthError}`
								: "state mismatch",
						),
					);

					return;
				}

				response
					.writeHead(200, { "content-type": "text/html; charset=utf-8" })
					.end(
						LoopbackListener.callbackPage(
							`Signed in to ${label}`,
							"You can close this tab and return to DeepSeek Harness.",
						),
					);

				resolveCode(returned);
			});

			try {
				await new Promise<void>((resolve, reject) => {
					server.once("error", reject);
					server.listen(port, "127.0.0.1", resolve);
				});
			} catch (error) {
				lastError = error;
				continue;
			}

			return new LoopbackListener(
				server,
				port,
				`http://127.0.0.1:${port}/callback`,
				code,
				rejectCode,
			);
		}

		throw new Error(
			`no free loopback port in ${preferredPort}..${preferredPort + PORT_ATTEMPTS - 1}: ${errorText(lastError)}`,
		);
	}

	// `close()` alone only stops accepting: it waits for existing sockets,
	// and a browser that used keep-alive would hold the flow open forever.
	close = async () => {
		this.server.closeAllConnections();

		await new Promise<void>((resolve) => {
			this.server.close(() => resolve());
		});
	};

	private static callbackPage = (title: string, message: string): string => {
		const safeTitle = escapeHtml(title);
		const safeMessage = escapeHtml(message);

		return (
			'<!doctype html><html lang="en"><head><meta charset="utf-8">' +
			'<meta name="viewport" content="width=device-width, initial-scale=1">' +
			`<title>${safeTitle}</title></head>` +
			'<body style="font:16px/1.5 system-ui;margin:4rem auto;max-width:32rem;' +
			'text-align:center;padding:0 1.25rem;color:#1f2328">' +
			`<h1 style="font-size:1.25rem;margin:0 0 .75rem">${safeTitle}</h1>` +
			`<p style="margin:0">${safeMessage}</p>` +
			'<p style="margin:2rem 0 0;font-size:.8125rem;color:#6e7781">DeepSeek Harness</p>' +
			"</body></html>"
		);
	};
}
