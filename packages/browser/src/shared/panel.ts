/**
 * What the two halves of this plugin agree on.
 *
 * They are separate bundles with no shared runtime, so the contract between them
 * is this file and nothing else: the paths the panel calls, the page kind it
 * registers, and the shape of one poll's answer.
 *
 * Every path here is **relative**: the Desktop application serves its page from
 * its own `dsh-app://` scheme, where a `WebSocket` cannot even be constructed
 * (the scheme is refused) and only an ordinary request reaches the harness's web
 * server. Polling and one `<img>` are what work there, and they are what every
 * other panel in this suite already does.
 */

/** The route prefix this plugin owns on the harness web server. */
export const ROUTE_PREFIX = "/dsh-browser";

/** Everything a panel needs that is not the picture itself. */
export const PANEL_PATH = `${ROUTE_PREFIX}/panel`;

/** The last frame as JPEG bytes; `seq` names the one the reader already has. */
export const FRAME_PATH = `${ROUTE_PREFIX}/frame`;

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

/**
 * What the panel was opened on.
 *
 * Both fields are optional on purpose: an icon or a restored tab may name
 * neither, and the panel can derive the browser from its own session — the one
 * fact a body of a session's pane always has.
 */
export interface PanelParams {
	/** The agent-browser session whose browser is watched. */
	readonly session?: string;
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

/** Everything one poll of the host answers with. */
export interface PanelSnapshot {
	readonly session: string;
	/** Whether the host currently holds the browser's own stream. */
	readonly connected: boolean;
	readonly url: string;
	readonly title: string;
	/** Why there is nothing to watch, when the host knows. */
	readonly error?: string;
	/** The frame the picture path would answer with right now; 0 for none. */
	readonly seq: number;
	/** The whole window a reader should show, newest last. */
	readonly activity: readonly PanelActivity[];
}

/**
 * The picture of one frame.
 *
 * The sequence is a cache key as much as it is a fact: an address that never
 * changed would never be fetched again, and the new frame would sit unseen.
 * @param session - the browser session to watch.
 * @param seq - the frame to show, as the last poll reported it.
 */
export const frameUrl = (session: string, seq: number): string =>
	`${FRAME_PATH}?session=${encodeURIComponent(session)}&seq=${String(seq)}`;

/** The poll that carries everything except the picture. */
export const panelUrl = (session: string): string =>
	`${PANEL_PATH}?session=${encodeURIComponent(session)}`;
