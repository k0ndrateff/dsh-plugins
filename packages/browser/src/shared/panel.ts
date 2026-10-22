/**
 * What the two halves of this plugin agree on.
 *
 * They are separate bundles with no shared runtime, so the contract between them
 * is this file and nothing else: the paths the page calls, the page kind it
 * registers, and the messages that ride the socket in between.
 */

/** The route prefix this plugin owns on the harness web server. */
export const ROUTE_PREFIX = "/dsh-browser";

/** The upgrade path the panel's live stream lives on. */
export const STREAM_PATH = `${ROUTE_PREFIX}/stream`;

/** Closing this session's browser, which is the only thing the panel writes. */
export const CLOSE_PATH = `${ROUTE_PREFIX}/close`;

/**
 * The page kind this plugin registers.
 *
 * Deliberately not `browser`: the product ships its own Browser tab under that
 * kind, and two declarations of one kind would fight over every open.
 */
export const PANEL_KIND = "dsh-browser";

/** The panel body's registration id, and the key its title registers under. */
export const PANEL_ID = "dsh-browser";

/** What the panel was opened on. */
export interface PanelParams {
	/** The agent-browser session whose browser is watched. */
	readonly session: string;
	/** The address the browser was last known to be at, when one was known. */
	readonly url?: string;
}

/** What a settled `browser_open` puts on its result for the page half. */
export interface PanelOpenMeta {
	readonly session: string;
	readonly url: string;
	readonly title: string;
}

/** One line of what the agent's browser has been doing. */
export interface PanelActivity {
	/** A command, or the outcome line that belongs under it. */
	readonly kind: "command" | "result";
	readonly text: string;
	/** Epoch milliseconds the CLI reported. */
	readonly at: number;
}

/** Everything the host may send down one panel's socket. */
export type PanelMessage =
	| {
			readonly type: "state";
			readonly session: string;
			/** Whether the host currently holds the browser's own stream. */
			readonly connected: boolean;
			readonly url: string;
			readonly title: string;
			/** Why there is nothing to watch, when the host knows. */
			readonly error?: string;
	  }
	| {
			readonly type: "frame";
			readonly seq: number;
			/** The viewport's size: what a click would be measured against. */
			readonly width: number;
			readonly height: number;
			/** One JPEG, base64. */
			readonly data: string;
	  }
	| {
			readonly type: "activity";
			/** The whole window the panel should show, newest last. */
			readonly items: readonly PanelActivity[];
	  };

/** What the panel may send back. */
export interface PanelRequest {
	readonly type: "config";
	/** Frames per second this reader wants at most. */
	readonly maxFps: number;
}

/**
 * The socket one panel watches a session on.
 * @param origin - the page's own origin, such as `http://127.0.0.1:58052`.
 * @param session - the agent-browser session to watch.
 */
export const streamUrl = (origin: string, session: string): string =>
	`${origin.replace(/^http/u, "ws")}${STREAM_PATH}?session=${encodeURIComponent(session)}`;
