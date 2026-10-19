/**
 * Logging for the host half. The harness context carries a logger; a bare
 * context (tests, dry runs) falls back to the console so the same code runs
 * outside the harness.
 */

import type { Context } from "@deepseek-ai/cordis";

export interface Logger {
	info: (message: string, ...args: unknown[]) => void;
	warn: (message: string, ...args: unknown[]) => void;
}

interface MaybeLogger {
	info?: (message: string, ...args: unknown[]) => void;
	warn?: (message: string, ...args: unknown[]) => void;
}

/** The context's logger when it has one, the console otherwise. */
export function loggerOf(ctx: Context): Logger {
	const logger = (ctx as { logger?: MaybeLogger }).logger;

	if (typeof logger?.info === "function" && typeof logger.warn === "function") {
		return {
			info: (message, ...args) => logger.info?.(message, ...args),
			warn: (message, ...args) => logger.warn?.(message, ...args),
		};
	}

	return {
		info: (message, ...args) => console.info(message, ...args),
		warn: (message, ...args) => console.warn(message, ...args),
	};
}

/** A message for a caught value, whatever it is. */
export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
