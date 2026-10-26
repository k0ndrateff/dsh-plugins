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

/** Closing this session's browser. */
export const CLOSE_PATH = `${ROUTE_PREFIX}/close`;

/** Asking the host to try connecting to the browser again. */
export const RETRY_PATH = `${ROUTE_PREFIX}/retry`;

/** Whether this machine can run a browser at all, as `doctor` reports it. */
export const DOCTOR_PATH = `${ROUTE_PREFIX}/doctor`;

/** The page as the agent's accessibility tree sees it, for the text view. */
export const TEXT_PATH = `${ROUTE_PREFIX}/text`;

/** Pointing, typing and navigating from the panel into the page. */
export const INPUT_PATH = `${ROUTE_PREFIX}/input`;

/**
 * Whether this conversation has a browser, and where it was last seen.
 *
 * A poll that costs nothing: it answers from what the host already knows and
 * does not touch the screencast, so the chip that shows a closed panel's browser
 * cannot keep frames flowing by looking at it.
 */
export const STATE_PATH = `${ROUTE_PREFIX}/state`;

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
	/**
	 * A command, the outcome line that belongs under it, or something the person
	 * at the panel did to the page themselves.
	 */
	readonly kind: "command" | "result" | "human";
	readonly text: string;
	/** Epoch milliseconds the CLI reported, or the panel's own clock for a person. */
	readonly at: number;
}

/** Which buttons were held while an input event was sent. */
export interface PanelModifiers {
	readonly alt: boolean;
	readonly ctrl: boolean;
	readonly meta: boolean;
	readonly shift: boolean;
}

/**
 * One thing a person did to the page through the panel.
 *
 * Coordinates are the page's own — the panel measures its picture against the
 * viewport the frame was taken in — so nothing here depends on how wide the
 * reader's sidebar happens to be. A click is one event rather than a press and a
 * release, because a person clicking is one act and the host can spell out the
 * pair the browser wants.
 */
export type PanelInput =
	| {
			readonly type: "mouse";
			/** `click` is a whole press and release; `move` is a hover. */
			readonly event: "click" | "down" | "up" | "move";
			readonly x: number;
			readonly y: number;
			readonly button: "left" | "right" | "middle";
			/** Which click of a run this is: 1 for a click, 2 for a double click. */
			readonly clickCount?: number;
			readonly modifiers: PanelModifiers;
	  }
	| {
			readonly type: "wheel";
			readonly x: number;
			readonly y: number;
			readonly deltaX: number;
			readonly deltaY: number;
	  }
	| {
			readonly type: "key";
			readonly event: "down" | "up";
			readonly key: string;
			readonly code: string;
			readonly modifiers: PanelModifiers;
	  }
	| {
			readonly type: "navigate";
			readonly to: "back" | "forward" | "reload";
	  }
	| {
			/** The page's own size, changed from the panel that is showing it. */
			readonly type: "viewport";
			readonly width: number;
			readonly height: number;
	  };

/**
 * The page's own size, which is what a click's coordinates are measured in.
 *
 * Not the picture's size and not `deviceWidth/Height` from the frame: the
 * picture is the page scaled to fit the browser window's surface, and the window
 * is taller than the page inside it.
 */
export interface PanelPage {
	readonly width: number;
	readonly height: number;
}

/**
 * Where a conversation's browser is in its life cycle.
 *
 * The panel draws every one of these differently, and only `unreachable` is an
 * error. "Nothing opened yet", "closed", "paused because nobody was looking" and
 * "connecting" are the normal shapes of a browser that is not on screen right
 * now; the person reading them must not be sent to fix something that is not
 * broken.
 */
export type PanelPhase =
	/** No browser was opened in this conversation, or none is running now. */
	| "none"
	/** Something proved there is a browser, and the host is connecting to it. */
	| "starting"
	/** The stream is open: the picture is as fresh as the page makes it. */
	| "live"
	/** The browser was closed on purpose, by the agent or by the person. */
	| "closed"
	/** The live view ended because nobody was watching, and can reconnect. */
	| "paused"
	/** Connecting failed for a reason that is worth another attempt. */
	| "unreachable";

/** One tab of the browser, as the panel lists them. */
export interface PanelTab {
	readonly url: string;
	readonly title: string;
	readonly active: boolean;
}

/** What the chip above the chat needs: is there a browser, and where. */
export interface PanelState {
	/** Where the browser is in its life cycle. */
	readonly phase: PanelPhase;
	/** Whether this conversation opened a browser and has not closed it. */
	readonly open: boolean;
	/** The address it was last seen at, empty when none is known. */
	readonly url: string;
	/** The page's title at that address, empty when none is known. */
	readonly title: string;
	/** Whether the host currently holds the browser's own stream. */
	readonly connected: boolean;
}

/** Everything one poll of the host answers with. */
export interface PanelSnapshot {
	readonly session: string;
	/** Where the browser is in its life cycle. */
	readonly phase: PanelPhase;
	/** A human sentence for a state that is not an error; empty when none. */
	readonly message: string;
	/** Whether the host currently holds the browser's own stream. */
	readonly connected: boolean;
	/** Whether a browser has been seen in this conversation and not closed. */
	readonly open: boolean;
	/** Whether the live view stopped because nobody was watching. */
	readonly paused: boolean;
	readonly url: string;
	readonly title: string;
	/** The tabs the browser reports, active one included. */
	readonly tabs: readonly PanelTab[];
	/** Why the live view cannot be shown, for a reason worth acting on. */
	readonly error?: string;
	/** Whether clicking Retry is the right next step. */
	readonly retryable: boolean;
	/** The frame the picture path would answer with right now; 0 for none. */
	readonly seq: number;
	/** The page's own size; zero until the browser has been asked for it. */
	readonly page: PanelPage;
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

/** The question the chip asks: is there a browser to go back to. */
export const stateUrl = (session: string): string =>
	`${STATE_PATH}?session=${encodeURIComponent(session)}`;

/** The write one person's click becomes. */
export const inputUrl = (session: string): string =>
	`${INPUT_PATH}?session=${encodeURIComponent(session)}`;

/** Asking the host to reconnect to this session's browser. */
export const retryUrl = (session: string): string =>
	`${RETRY_PATH}?session=${encodeURIComponent(session)}`;

/** The page as the agent's own accessibility tree, for the text view. */
export const textUrl = (session: string): string =>
	`${TEXT_PATH}?session=${encodeURIComponent(session)}`;

/** Whether this machine can run a browser at all. */
export const doctorUrl = (): string => DOCTOR_PATH;
