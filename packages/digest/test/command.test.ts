/**
 * The `/digest` command: its grammar, and what each action does to the
 * settings and the reminders.
 *
 *   bun run test/command.ts
 *
 * The command is the only surface that knows which session is asking, so the
 * binding actions are proved here rather than anywhere else: `on` binds to the
 * asking session, `off` releases it, and a change of time reaches reminders
 * that other sessions already own.
 */

import { test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { DigestBlockEntry } from "dsh-integration-host";
import { check } from "../../../test/support";
import type { DigestCollector } from "../src/host/collect";
import {
	createDigestCommand,
	describeDays,
	parseDays,
} from "../src/host/command";
import {
	DigestSchedule,
	type ScheduleCreateRequest,
} from "../src/host/schedule";
import { DigestSettingsStore } from "../src/host/settings";

const workdir = await mkdtemp(join(tmpdir(), "dsh-digest-command-"));

/** A schedule service that remembers what it was asked to do. */
class FakeSchedule {
	readonly held: {
		sessionId: string;
		id: string;
		request: ScheduleCreateRequest;
	}[] = [];
	private next = 1;

	async create(sessionId: string, request: ScheduleCreateRequest) {
		const id = `task-${this.next}`;
		this.next += 1;
		this.held.push({ sessionId, id, request });

		return { id };
	}

	async catalog() {
		return this.held.map((entry) => ({
			id: entry.id,
			title: entry.request.title,
			prompt: entry.request.prompt,
			sessionId: entry.sessionId,
			status: "active" as const,
		}));
	}

	async delete(request: { sessionId: string; id: string }) {
		const index = this.held.findIndex((entry) => entry.id === request.id);

		if (index >= 0) this.held.splice(index, 1);
	}
}

const BLOCKS: readonly DigestBlockEntry[] = [
	{
		id: "jira-active",
		title: "Jira · In progress",
		provider: "Atlassian",
		defaultOn: true,
	},
	{
		id: "coderabbit",
		title: "GitLab · CodeRabbit",
		provider: "GitLab",
		defaultOn: false,
	},
];

/** A collector that answers from a script instead of from providers. */
const collector = {
	async collect(callId: string) {
		return {
			summary: `digest ${callId}`,
			report: { callId, title: "Daily digest", generatedAt: "", sections: [] },
		};
	},
	sources: () => BLOCKS,
} as unknown as DigestCollector;

/** One installation of the command, over one settings file. */
async function commandFor(name: string, withService = true) {
	const file = join(workdir, name, "settings.json");
	const settings = new DigestSettingsStore(file);
	const service = withService ? new FakeSchedule() : undefined;
	const schedule = new DigestSchedule({
		get: (key: string) => (key === "schedule" ? service : undefined),
	} as unknown as Context);

	await settings.ensure();

	return {
		service,
		settings,
		run: createDigestCommand({ collector, settings, schedule }),
		agent: { id: "session-a" },
	};
}

test("the weekday grammar", async () => {
	check(
		"names are matched by their first three letters",
		parseDays("mon,wed,fri")?.join(",") === "1,3,5",
	);
	check(
		"repeats collapse and the order is the week's",
		parseDays("fri,mon,mon")?.join(",") === "1,5",
	);
	check(
		"full names work, and come back in week order",
		parseDays("monday,sunday")?.join(",") === "0,1",
	);
	check(
		"spaces work as well as commas",
		parseDays("mon tue wed")?.join(",") === "1,2,3",
	);
	check("an unknown name is refused", parseDays("mon,funday") === undefined);
	check("an empty list is refused", parseDays(" , ") === undefined);
	check(
		"every day reads as one phrase",
		describeDays([0, 1, 2, 3, 4, 5, 6]) === "every day",
	);
	check("a narrow week reads as its days", describeDays([1, 3]) === "Mon, Wed");
});
test("reading and writing the settings", async () => {
	{
		const { run, settings } = await commandFor("basic");

		const status = await run({ rawInput: "", agent: { id: "session-a" } });

		check(
			"a bare command reports the state",
			status.kind === "success" && status.text.includes("09:00"),
			status.text,
		);

		const time = await run({
			rawInput: "time 07:05",
			agent: { id: "session-a" },
		});

		check(
			"a valid time is stored",
			time.kind === "success" && settings.get().time === "07:05",
			time.text,
		);

		const badTime = await run({
			rawInput: "time 7:5",
			agent: { id: "session-a" },
		});

		check("a malformed time is refused", badTime.kind === "error");
		check("and nothing was written", settings.get().time === "07:05");

		const zone = await run({
			rawInput: "timezone Europe/Berlin",
			agent: { id: "session-a" },
		});

		check(
			"a valid zone is stored",
			zone.kind === "success" && settings.get().timeZone === "Europe/Berlin",
		);

		const badZone = await run({
			rawInput: "timezone Mars/Olympus",
			agent: { id: "session-a" },
		});

		check(
			"an invented zone is refused",
			badZone.kind === "error" && settings.get().timeZone === "Europe/Berlin",
		);

		const days = await run({
			rawInput: "days mon,wed,fri",
			agent: { id: "session-a" },
		});

		check(
			"days are stored in week order",
			days.kind === "success" && settings.get().days.join(",") === "1,3,5",
		);

		const badDays = await run({
			rawInput: "days someday",
			agent: { id: "session-a" },
		});

		check("an unknown weekday is refused", badDays.kind === "error");
	}
});
test("the block switches", async () => {
	{
		const { run, settings } = await commandFor("blocks");

		const list = await run({ rawInput: "blocks", agent: { id: "session-a" } });

		check(
			"the list names every block with its state",
			list.kind === "success" &&
				list.text.includes("on  jira-active") &&
				list.text.includes("off coderabbit"),
			list.text,
		);

		const on = await run({
			rawInput: "blocks coderabbit on",
			agent: { id: "session-a" },
		});

		check(
			"a block is switched on",
			on.kind === "success" && settings.get().blocks.coderabbit === true,
		);

		const off = await run({
			rawInput: "blocks jira-active off",
			agent: { id: "session-a" },
		});

		check(
			"and another off",
			off.kind === "success" && settings.get().blocks["jira-active"] === false,
		);

		const unknown = await run({
			rawInput: "blocks nonsense on",
			agent: { id: "session-a" },
		});

		check(
			"an unknown block is refused",
			unknown.kind === "error",
			unknown.text,
		);
	}
});
test("binding the digest to a session", async () => {
	{
		const { run, service, settings } = await commandFor("binding");

		const on = await run({ rawInput: "on", agent: { id: "session-a" } });

		check(
			"on binds to the asking session",
			on.kind === "success" && service?.held.length === 1,
		);
		check(
			"and says when it will arrive",
			on.text.includes("09:00") && on.text.includes("Mon"),
			on.text,
		);

		const other = await run({ rawInput: "on", agent: { id: "session-b" } });

		check(
			"another session gets its own",
			other.kind === "success" && service?.held.length === 2,
		);

		const retimed = await run({
			rawInput: "time 06:30",
			agent: { id: "session-a" },
		});

		check(
			"a change of time reaches every bound session",
			retimed.kind === "success" &&
				service?.held.length === 2 &&
				service.held.every(
					(entry) =>
						entry.request.weekly?.time === "06:30:00" ||
						entry.request.daily?.time === "06:30:00",
				),
			JSON.stringify(
				service?.held.map(
					(entry) => entry.request.weekly?.time ?? entry.request.daily?.time,
				),
			),
		);

		const off = await run({ rawInput: "off", agent: { id: "session-a" } });

		check(
			"off releases only this session",
			off.kind === "success" && service?.held.length === 1,
		);
		check("and the settings are untouched", settings.get().time === "06:30");

		const again = await run({ rawInput: "off", agent: { id: "session-a" } });

		check(
			"off with nothing bound says so",
			again.kind === "success" && again.text.includes("No digest"),
			again.text,
		);
	}
});
test("a deployment without the reminder service", async () => {
	{
		const { run } = await commandFor("noservice", false);

		const on = await run({ rawInput: "on", agent: { id: "session-a" } });

		check(
			"binding is refused with a reason",
			on.kind === "error" && on.text.includes("no reminder service"),
			on.text,
		);

		const status = await run({
			rawInput: "status",
			agent: { id: "session-a" },
		});

		check(
			"and the status says the same",
			status.kind === "success" && status.text.includes("no reminder service"),
			status.text,
		);
	}
});
test("an agent that names no session", async () => {
	{
		const { run, service } = await commandFor("nosession");
		const on = await run({ rawInput: "on" });

		check("cannot be bound", on.kind === "error", on.text);
		check("and nothing was created", service?.held.length === 0);
	}
});
test("assembling on demand", async () => {
	{
		const { run } = await commandFor("now");
		const now = await run({ rawInput: "now", agent: { id: "session-a" } });

		check(
			"now answers with the collector's text",
			now.kind === "success" && now.text.startsWith("digest digest-command-"),
			now.text,
		);
		check("and binds nothing", now.kind === "success");
	}

	await rm(workdir, { recursive: true, force: true });
});
