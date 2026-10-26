/**
 * Turning the transport's own words into something a person can act on.
 *
 * The Dev Mode MCP server lives in the Figma desktop app, so the commonest
 * failure on a first run is that nothing is listening — which the MCP client
 * reports as "the connection is not open". That is a prerequisite, not a bug:
 * the tool and the panel answer with the same sentence the settings card uses.
 * Every other failure keeps its own message.
 */

import { CONNECTION_FAILURE } from "../shared/connection";

/** What a missing local server looks like in the MCP client's own words. */
const CONNECTION_FAILURE_PATTERN =
	/connection is not open|did not answer|econnrefused|fetch failed|socket hang up|network is unreachable/iu;

/** The reason inside an unknown thrown value, as a plain sentence. */
export const reasonOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Whether one failure is the Dev Mode server not being there. */
export const isConnectionFailure = (error: unknown): boolean =>
	CONNECTION_FAILURE_PATTERN.test(reasonOf(error));

/**
 * Rewrite one read's failure as the sentence the user needs.
 * @param error - what the MCP client or the server threw.
 * @returns the same failure for a real one, and the prerequisite for a missing
 *   connection.
 */
export const humanFigmaError = (error: unknown): Error =>
	isConnectionFailure(error)
		? new Error(CONNECTION_FAILURE)
		: error instanceof Error
			? error
			: new Error(reasonOf(error));
