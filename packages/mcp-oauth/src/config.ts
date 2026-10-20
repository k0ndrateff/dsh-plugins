/**
 * Bounds the library puts on its own work.
 *
 * These are transport and token-lifetime facts, not preferences: they are the
 * same for every provider, and changing one changes how a stalled server or an
 * expiring token behaves everywhere.
 */

/** How long any single OAuth HTTP call may take. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** How many consecutive loopback ports to try for the redirect. */
export const PORT_ATTEMPTS = 20;

/** How long to wait for a human to finish signing in. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/** How long before expiry a token is refreshed. */
export const REFRESH_MARGIN_MS = 60_000;
