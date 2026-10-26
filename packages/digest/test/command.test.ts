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

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { DigestBlockEntry } from "dsh-integration-host";
import type { DigestCollector } from "../src/host/collect";
import {
	createDigestCommand,
	describeDays,
	parseDays,
} from "../src/host/command";
import { DigestSave } from "../src/host/save";
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
		schedule,
		run: createDigestCommand({
			collector,
			settings,
			schedule,
			save: new DigestSave({ settings, schedule }),
		}),
		agent: { id: "session-a" },
	};
}

test("the weekday grammar", async () => {
	expect(
		parseDays("mon,wed,fri")?.join(",") === "1,3,5",
		"names are matched by their first three letters",
	).toBe(true);
	expect(
		parseDays("fri,mon,mon")?.join(",") === "1,5",
		"repeats collapse and the order is the week's",
	).toBe(true);
	expect(
		parseDays("monday,sunday")?.join(",") === "0,1",
		"full names work, and come back in week order",
	).toBe(true);
	expect(
		parseDays("mon tue wed")?.join(",") === "1,2,3",
		"spaces work as well as commas",
	).toBe(true);
	expect(
		parseDays("mon,funday") === undefined,
		"an unknown name is refused",
	).toBe(true);
	expect(parseDays(" , ") === undefined, "an empty list is refused").toBe(true);
	expect(
		describeDays([0, 1, 2, 3, 4, 5, 6]) === "every day",
		"every day reads as one phrase",
	).toBe(true);
	expect(
		describeDays([1, 3]) === "Mon, Wed",
		"a narrow week reads as its days",
	).toBe(true);
});
test("reading and writing the settings", async () => {
	{
		const { run, settings } = await commandFor("basic");

		const status = await run({ rawInput: "", agent: { id: "session-a" } });

		expect(
			status.kind === "success" && status.text.includes("09:00"),
			`a bare command reports the state — ${status.text}`,
		).toBe(true);

		const time = await run({
			rawInput: "time 07:05",
			agent: { id: "session-a" },
		});

		expect(
			time.kind === "success" && settings.get().time === "07:05",
			`a valid time is stored — ${time.text}`,
		).toBe(true);

		const badTime = await run({
			rawInput: "time 7:5",
			agent: { id: "session-a" },
		});

		expect(badTime.kind === "error", "a malformed time is refused").toBe(true);
		expect(settings.get().time === "07:05", "and nothing was written").toBe(
			true,
		);

		const zone = await run({
			rawInput: "timezone Europe/Berlin",
			agent: { id: "session-a" },
		});

		expect(
			zone.kind === "success" && settings.get().timeZone === "Europe/Berlin",
			"a valid zone is stored",
		).toBe(true);

		const badZone = await run({
			rawInput: "timezone Mars/Olympus",
			agent: { id: "session-a" },
		});

		expect(
			badZone.kind === "error" && settings.get().timeZone === "Europe/Berlin",
			"an invented zone is refused",
		).toBe(true);

		const days = await run({
			rawInput: "days mon,wed,fri",
			agent: { id: "session-a" },
		});

		expect(
			days.kind === "success" && settings.get().days.join(",") === "1,3,5",
			"days are stored in week order",
		).toBe(true);

		const badDays = await run({
			rawInput: "days someday",
			agent: { id: "session-a" },
		});

		expect(badDays.kind === "error", "an unknown weekday is refused").toBe(
			true,
		);
	}
});
test("the block switches", async () => {
	{
		const { run, settings } = await commandFor("blocks");

		const list = await run({ rawInput: "blocks", agent: { id: "session-a" } });

		expect(
			list.kind === "success" &&
				list.text.includes("on  jira-active") &&
				list.text.includes("off coderabbit"),
			`the list names every block with its state — ${list.text}`,
		).toBe(true);

		const on = await run({
			rawInput: "blocks coderabbit on",
			agent: { id: "session-a" },
		});

		expect(
			on.kind === "success" && settings.get().blocks.coderabbit === true,
			"a block is switched on",
		).toBe(true);

		const off = await run({
			rawInput: "blocks jira-active off",
			agent: { id: "session-a" },
		});

		expect(
			off.kind === "success" && settings.get().blocks["jira-active"] === false,
			"and another off",
		).toBe(true);

		const unknown = await run({
			rawInput: "blocks nonsense on",
			agent: { id: "session-a" },
		});

		expect(
			unknown.kind === "error",
			`an unknown block is refused — ${unknown.text}`,
		).toBe(true);
	}
});
test("binding the digest to a session", async () => {
	{
		const { run, service, settings } = await commandFor("binding");

		const on = await run({ rawInput: "on", agent: { id: "session-a" } });

		expect(
			on.kind === "success" && service?.held.length === 1,
			"on binds to the asking session",
		).toBe(true);
		expect(
			on.text.includes("09:00") && on.text.includes("Mon"),
			`and says when it will arrive — ${on.text}`,
		).toBe(true);

		const other = await run({ rawInput: "on", agent: { id: "session-b" } });

		expect(
			other.kind === "success" && service?.held.length === 2,
			"another session gets its own",
		).toBe(true);

		const retimed = await run({
			rawInput: "time 06:30",
			agent: { id: "session-a" },
		});

		expect(
			retimed.kind === "success" &&
				service?.held.length === 2 &&
				service.held.every(
					(entry) =>
						entry.request.weekly?.time === "06:30:00" ||
						entry.request.daily?.time === "06:30:00",
				),
			`a change of time reaches every bound session — ${JSON.stringify(
				service?.held.map(
					(entry) => entry.request.weekly?.time ?? entry.request.daily?.time,
				),
			)}`,
		).toBe(true);

		const off = await run({ rawInput: "off", agent: { id: "session-a" } });

		expect(
			off.kind === "success" && service?.held.length === 1,
			"off releases only this session",
		).toBe(true);
		expect(
			settings.get().time === "06:30",
			"and the settings are untouched",
		).toBe(true);

		const again = await run({ rawInput: "off", agent: { id: "session-a" } });

		expect(
			again.kind === "success" && again.text.includes("No digest"),
			`off with nothing bound says so — ${again.text}`,
		).toBe(true);
	}
});
test("a deployment without the reminder service", async () => {
	{
		const { run } = await commandFor("noservice", false);

		const on = await run({ rawInput: "on", agent: { id: "session-a" } });

		expect(
			on.kind === "error" && on.text.includes("no reminder service"),
			`binding is refused with a reason — ${on.text}`,
		).toBe(true);

		const status = await run({
			rawInput: "status",
			agent: { id: "session-a" },
		});

		expect(
			status.kind === "success" && status.text.includes("no reminder service"),
			`and the status says the same — ${status.text}`,
		).toBe(true);
	}
});
test("an agent that names no session", async () => {
	{
		const { run, service } = await commandFor("nosession");
		const on = await run({ rawInput: "on" });

		expect(on.kind === "error", `cannot be bound — ${on.text}`).toBe(true);
		expect(service?.held.length === 0, "and nothing was created").toBe(true);
	}
});
test("assembling on demand", async () => {
	{
		const { run } = await commandFor("now");
		const now = await run({ rawInput: "now", agent: { id: "session-a" } });

		expect(
			now.kind === "success" && now.text.startsWith("digest digest-command-"),
			`now answers with the collector's text — ${now.text}`,
		).toBe(true);
		expect(now.kind === "success", "and binds nothing").toBe(true);
	}
});
test("a typo is an error, not a status", async () => {
	{
		const { run } = await commandFor("typo");
		const typo = await run({ rawInput: "onn", agent: { id: "session-a" } });

		expect(
			typo.kind === "error" && typo.text.includes("onn"),
			`an unknown action is refused rather than read as "status" — ${typo.text}`,
		).toBe(true);
		expect(
			typo.text.includes(" | on ") && typo.text.includes("time HH:MM"),
			`and the refusal lists what the command does have — ${typo.text}`,
		).toBe(true);
	}
});
test("finding and stopping every bound session", async () => {
	{
		const { run, service } = await commandFor("sessions");

		await run({ rawInput: "on", agent: { id: "session-a" } });
		await run({ rawInput: "on", agent: { id: "session-b" } });

		const status = await run({ rawInput: "", agent: { id: "session-a" } });

		expect(
			status.kind === "success" &&
				status.text.includes("session-a") &&
				status.text.includes("session-b"),
			`a bare /digest names the sessions it is scheduled in — ${status.text}`,
		).toBe(true);
		expect(
			status.text.includes("/digest off all"),
			`and how to stop them all — ${status.text}`,
		).toBe(true);

		const off = await run({ rawInput: "off all", agent: { id: "session-a" } });

		expect(
			off.kind === "success" && service?.held.length === 0,
			`off all stops every session, not just this one — ${off.text}`,
		).toBe(true);

		const again = await run({
			rawInput: "off all",
			agent: { id: "session-a" },
		});

		expect(
			again.kind === "success" && again.text.includes("No digest"),
			`and says so when there was nothing to stop — ${again.text}`,
		).toBe(true);
	}
});
test("the week reads from Monday", async () => {
	{
		const { run } = await commandFor("week");
		const days = await run({
			rawInput: "days mon,sun",
			agent: { id: "session-a" },
		});
		const status = await run({ rawInput: "", agent: { id: "session-a" } });

		expect(
			days.kind === "success" && days.text.includes("Mon, Sun"),
			`Monday leads the week even when Sunday is chosen too — ${days.text}`,
		).toBe(true);
		expect(
			status.kind === "success" && status.text.includes("Mon, Sun"),
			`and the status prints it the same way — ${status.text}`,
		).toBe(true);
	}
});
test("a reminder that cannot be re-timed is not a success", async () => {
	{
		const { run, service, settings } = await commandFor("retime");

		await run({ rawInput: "on", agent: { id: "session-a" } });

		if (service !== undefined)
			service.catalog = async () => {
				throw new Error("the reminder catalog is locked");
			};

		const retimed = await run({
			rawInput: "time 06:30",
			agent: { id: "session-a" },
		});

		expect(
			retimed.kind === "error" && retimed.text.includes("rolled back"),
			`a change that cannot reach the reminders is refused, not reported — ${retimed.text}`,
		).toBe(true);
		expect(
			settings.get().time === "09:00",
			`and the settings keep the time the reminders still use — ${settings.get().time}`,
		).toBe(true);
	}

	await rm(workdir, { recursive: true, force: true });
});
