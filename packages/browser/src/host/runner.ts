/**
 * Running one agent-browser command.
 *
 * The command goes through the subprocess seam as an explicit `argv`, never a
 * shell line: URLs, selectors and text come from the model, and an argument list
 * cannot be re-interpreted by a shell. The harness's bash seam is the wrong door
 * for a second reason — it carries the session's file sandbox, and Chrome does
 * not start inside one: it dies with "Failed to initialize sandbox" before it can
 * write its own profile.
 *
 * Every call names this session, so two agents cannot end up driving one page,
 * and every call is bounded twice: by a deadline the CLI cannot outlive, and by
 * how much of its answer the model may read.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { SubprocessOutcome } from "@deepseek-ai/dsh-subprocess";
import type { BrowserConfig } from "./config";
import { parseEnvelope } from "./envelope";
import { type BrowserStatus, parseDoctor, summarizeDoctor } from "./status";
import { errorText } from "./text";

/** One command to run in this session's browser. */
export interface BrowserCommand {
	/** The agent-browser command and its arguments, without the executable. */
	readonly args: readonly string[];
	/** The session this browser belongs to. */
	readonly session: string;
	/** The directory the command runs in. */
	readonly cwd: string;
	/** The caller's cancellation: the tool call's own signal. */
	readonly signal: AbortSignal;
	/** How long this one command may take, instead of the configured deadline. */
	readonly timeoutMs?: number;
}

/** What one command answered. */
export type BrowserOutcome =
	| {
			readonly ok: true;
			readonly data: unknown;
			readonly durationMs: number;
	  }
	| {
			readonly ok: false;
			readonly error: string;
			readonly durationMs: number;
	  };

/** The executable to run, or the reason there is none. */
type Executable =
	| { readonly found: true; readonly path: string }
	| { readonly found: false; readonly error: string };

/** What one finished process left behind, before it is read as an answer. */
interface Invocation {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number | null;
	readonly timedOut: boolean;
	readonly aborted: boolean;
	readonly failure: string | undefined;
}

/** The CLI's answer is read whole; what the model sees is cut later. */
const STDOUT_CAP_BYTES = 1_000_000;

/** Diagnostics are only ever quoted back, so a tail is enough. */
const STDERR_CAP_BYTES = 64_000;

/** How long the process is given to go away once it is terminated. */
const GRACE_MS = 5_000;

/** The global flags every command is run with. */
const SESSION_FLAG = "--session";
const JSON_FLAG = "--json";

/** What to do about a CLI that is not on this machine. */
const missingExecutable = (executable: string): string =>
	`"${executable}" is not on PATH. Install it with \`npm install -g agent-browser\` and then \`agent-browser install\`, or point the plugin at an existing one with the \`executable\` setting.`;

/**
 * One signal that fires when either the deadline passes or the caller cancels.
 *
 * The two are kept apart outside this function: which of them fired is the
 * difference between "the page never settled" and "the call was cancelled".
 */
const fuse = (deadline: AbortSignal, caller: AbortSignal): AbortSignal => {
	const fused = new AbortController();
	const stop = (): void => {
		deadline.removeEventListener("abort", stop);
		caller.removeEventListener("abort", stop);
		fused.abort();
	};

	if (deadline.aborted || caller.aborted) fused.abort();
	else {
		deadline.addEventListener("abort", stop, { once: true });
		caller.addEventListener("abort", stop, { once: true });
	}

	return fused.signal;
};

/** The last few lines of a stream, for a message that has to stay short. */
const tail = (text: string, lines = 3): string =>
	text.trim().split("\n").slice(-lines).join("\n");

export class AgentBrowserRunner {
	/** The executable this process already resolved, if it did. */
	private resolved: string | undefined;

	/** @param deps - host context carrying the subprocess seam, and the config. */
	constructor(
		private readonly deps: {
			readonly ctx: Context;
			readonly config: BrowserConfig;
		},
	) {}

	/**
	 * Run one command and read the CLI's own answer.
	 * @param command - the arguments, the session, the directory and the deadline.
	 * @returns the payload on success; on failure a reason a model can act on.
	 */
	async run(command: BrowserCommand): Promise<BrowserOutcome> {
		const started = Date.now();
		const executable = await this.executable(command.signal);

		if (!executable.found)
			return {
				ok: false,
				error: executable.error,
				durationMs: Date.now() - started,
			};

		const invoked = await this.invoke(
			[
				executable.path,
				SESSION_FLAG,
				command.session,
				...command.args,
				JSON_FLAG,
			],
			{
				cwd: command.cwd,
				signal: command.signal,
				timeoutMs: command.timeoutMs ?? this.deps.config.timeoutMs,
			},
		);

		return this.read(invoked, started);
	}

	/**
	 * Ask the CLI what it makes of this machine.
	 * @param options - the session, the directory, and the caller's cancellation.
	 * @returns the report's summary, or undefined when the CLI is not installed.
	 */
	async status(options: {
		readonly session: string;
		readonly cwd: string;
		readonly signal: AbortSignal;
	}): Promise<BrowserStatus | undefined> {
		const executable = await this.executable(options.signal);
		if (!executable.found) return undefined;

		const invoked = await this.invoke([executable.path, "doctor", JSON_FLAG], {
			cwd: options.cwd,
			signal: options.signal,
			timeoutMs: this.deps.config.timeoutMs,
		});
		const report = parseDoctor(invoked.stdout);

		if (report !== undefined) return summarizeDoctor(report);

		const reason = invoked.failure ?? tail(invoked.stderr);

		return summarizeDoctor({
			checks: [
				{
					id: "doctor.unreadable",
					category: "Doctor",
					message:
						reason === ""
							? `doctor exited with code ${String(invoked.exitCode)} and said nothing`
							: reason,
					status: "fail",
				},
			],
		});
	}

	/** The executable to run, resolved once per process. */
	private async executable(signal: AbortSignal): Promise<Executable> {
		if (this.resolved !== undefined)
			return { found: true, path: this.resolved };

		try {
			const path = await this.deps.ctx.subprocess.resolveExecutable(
				this.deps.config.executable,
				undefined,
				signal,
			);

			this.resolved = path;

			return { found: true, path };
		} catch {
			return {
				found: false,
				error: missingExecutable(this.deps.config.executable),
			};
		}
	}

	/** Start one process and collect everything it printed. */
	private async invoke(
		argv: readonly string[],
		options: { cwd: string; signal: AbortSignal; timeoutMs: number },
	): Promise<Invocation> {
		const deadline = AbortSignal.timeout(options.timeoutMs);
		const handle = this.deps.ctx.subprocess.spawn({
			argv,
			cwd: options.cwd,
			stdio: {
				stdin: "ignore",
				stdout: { maxBytes: STDOUT_CAP_BYTES },
				stderr: { maxBytes: STDERR_CAP_BYTES },
			},
			graceMs: GRACE_MS,
			signal: fuse(deadline, options.signal),
			env: this.environment(),
		});

		let outcome: SubprocessOutcome | undefined;
		let failure: string | undefined;

		try {
			outcome = await handle.done;
		} catch (error) {
			failure = errorText(error);
		}

		return {
			stdout: handle.collected.stdout?.readFrom(0).text ?? "",
			stderr: handle.collected.stderr?.readFrom(0).text ?? "",
			exitCode: outcome?.exitCode ?? null,
			timedOut: deadline.aborted && !options.signal.aborted,
			aborted: options.signal.aborted,
			failure,
		};
	}

	/** Turn one finished process into an outcome. */
	private read(invoked: Invocation, started: number): BrowserOutcome {
		const durationMs = Date.now() - started;
		const envelope = parseEnvelope(invoked.stdout);

		if (invoked.failure !== undefined)
			return { ok: false, error: invoked.failure, durationMs };

		if (invoked.timedOut)
			return {
				ok: false,
				error: `the command did not finish within ${this.deps.config.timeoutMs}ms and was stopped`,
				durationMs,
			};

		if (invoked.aborted)
			return { ok: false, error: "the call was cancelled", durationMs };

		if (envelope === undefined)
			return { ok: false, error: this.unreadable(invoked), durationMs };

		return envelope.ok
			? { ok: true, data: envelope.data, durationMs }
			: {
					ok: false,
					error:
						envelope.error ??
						`the command failed with exit code ${String(invoked.exitCode)}`,
					durationMs,
				};
	}

	/** What to say about an exit nothing could be read from. */
	private unreadable(invoked: Invocation): string {
		const diagnostics = tail(invoked.stderr);
		const answer = tail(invoked.stdout);

		if (invoked.exitCode !== 0 && diagnostics !== "") return diagnostics;

		return answer === ""
			? `the command exited with code ${String(invoked.exitCode)} and said nothing`
			: `the command answered something this plugin could not read: ${answer}`;
	}

	/** The environment entries the CLI reads, when the config asked for any. */
	private environment(): NodeJS.ProcessEnv | undefined {
		const env: Record<string, string> = {};

		// Both are launch-time facts the CLI owns: `--headed` and a domain policy
		// have to be in place before a browser starts, not on the command that
		// happens to start it.
		if (this.deps.config.headed) env.AGENT_BROWSER_HEADED = "1";
		if (this.deps.config.allowedDomains.length > 0)
			env.AGENT_BROWSER_ALLOWED_DOMAINS =
				this.deps.config.allowedDomains.join(",");

		return Object.keys(env).length === 0 ? undefined : env;
	}
}
