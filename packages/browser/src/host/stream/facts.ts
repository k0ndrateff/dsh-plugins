/**
 * What the CLI says about one session's screencast.
 *
 * `stream status --json` answers with the port the screencast listens on, or
 * with no port at all when the session has no stream. It is asked only after a
 * tool call has proved there is a browser in that session: a `stream status` on
 * a session with no daemon starts one, and a panel that opens on a guess should
 * not leave daemons behind.
 */

import type { AgentBrowserRunner } from "../runner";

/** Where one session's screencast listens, and what it is doing. */
export interface StreamFacts {
	/** The loopback port the screencast listens on. */
	readonly port: number;
	/** Whether a reader is attached. */
	readonly connected: boolean;
	/** Whether frames are being encoded right now. */
	readonly screencasting: boolean;
}

/** One answer field, when it is a finite number. */
const numberOf = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * Read `stream status --json`'s payload.
 * @param data - the envelope's `data`.
 * @returns the facts, or undefined when the answer named no port.
 */
export const parseStreamStatus = (data: unknown): StreamFacts | undefined => {
	if (data === null || typeof data !== "object" || Array.isArray(data))
		return undefined;

	const record = data as Record<string, unknown>;
	const port = numberOf(record.port);

	if (port === undefined) return undefined;

	return {
		port,
		connected: record.connected === true,
		screencasting: record.screencasting === true,
	};
};

/**
 * Ask one session where its screencast listens.
 * @param runner - the CLI runner.
 * @param options - the session, the directory, and the caller's cancellation.
 * @returns the facts, or undefined when the session has no stream — which is
 *   what a closed browser answers with.
 */
export const askStreamStatus = async (
	runner: AgentBrowserRunner,
	options: {
		readonly session: string;
		readonly cwd: string;
		readonly signal: AbortSignal;
	},
): Promise<StreamFacts | undefined> => {
	const outcome = await runner.run({
		args: ["stream", "status"],
		session: options.session,
		cwd: options.cwd,
		signal: options.signal,
	});

	return outcome.ok ? parseStreamStatus(outcome.data) : undefined;
};
