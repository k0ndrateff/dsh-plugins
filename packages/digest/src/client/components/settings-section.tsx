/**
 * The digest settings card.
 *
 * It owns *what* a digest contains and *when* it should be read; it cannot own
 * *where*, because a reminder belongs to a session and a settings page has
 * none. So the card says so, and names the one command that does: `/digest on`
 * in the session that should receive it.
 *
 * The card is drawn from the host's own answer rather than from a list kept
 * here: a provider that is installed adds its block, one that is removed takes
 * it away, and neither needs the card to know their names.
 *
 * A settings page is read and edited, not driven: what the controls show while
 * the user is deciding is a draft, and the host hears about it only when the
 * user saves. A field the draft moved away from what is stored says so, so
 * closing the page without saving is never a surprise, and a value the host
 * would refuse — a zone that names nothing, a time that is not one — blocks the
 * save instead of failing it.
 */

import {
	Button,
	Checkbox,
	Input,
	SegmentedControl,
	StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	DAY_LABELS,
	DIGEST_LIMITS,
	type DigestBlockView,
	type DigestReport,
	type DigestSection,
	type DigestSettings,
	type DigestSettingsView,
	isDigestTime,
	isTimeZone,
} from "../../shared/digest";
import { digestHostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/** One block of the preview, drawn the way the card draws it. */
const Preview = ({ section }: { section: DigestSection }) => (
	<div className={styles.block}>
		<div className={styles.blockHead}>
			<span className={styles.blockTitle}>{section.title}</span>
			<span className={styles.blockProvider}>{section.provider}</span>
		</div>

		{section.unavailable === undefined ? null : (
			<p className={styles.blockNote}>{section.unavailable}</p>
		)}

		{section.unavailable !== undefined || section.items.length > 0 ? null : (
			<p className={styles.blockNote}>Nothing to report.</p>
		)}

		{section.items.map((item) => (
			<div className={styles.row} key={item.id}>
				{item.url === undefined ? (
					<span className={styles.rowTitle}>{item.title}</span>
				) : (
					<a
						className={styles.link}
						href={item.url}
						target="_blank"
						rel="noreferrer"
					>
						{item.title}
					</a>
				)}

				{item.meta === undefined ? null : (
					<span className={styles.rowMeta}>{item.meta}</span>
				)}
			</div>
		))}
	</div>
);

/** One staged field: its name, its control, and what the control means. */
const Field = ({
	label,
	hint,
	changed = false,
	children,
}: {
	label: string;
	hint?: string;
	changed?: boolean;
	children: ReactNode;
}) => (
	<div className={styles.field}>
		<div className={styles.fieldHead}>
			<span className={styles.fieldLabel}>{label}</span>

			{changed ? <span className={styles.fieldChanged}>Changed</span> : null}
		</div>

		{children}

		{hint === undefined ? null : <span className={styles.caption}>{hint}</span>}
	</div>
);

/** Whether one block's switch is on in a set of settings. */
const isOn = (block: DigestBlockView, settings: DigestSettings): boolean =>
	settings.blocks[block.id] ?? block.on;

/** Whether two day selections name the same weekdays. */
const sameDays = (left: readonly number[], right: readonly number[]): boolean =>
	left.length === right.length && left.every((day) => right.includes(day));

/** The digest settings card. */
export const DigestSettingsSection = (): ReactNode => {
	const mounted = useRef(true);
	const [view, setView] = useState<DigestSettingsView | null>(null);
	/** What the host holds, which is what the draft is compared against. */
	const [stored, setStored] = useState<DigestSettings | null>(null);
	/** What the user has edited, written only on save. */
	const [draft, setDraft] = useState<DigestSettings | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [pending, setPending] = useState<"save" | "now" | null>(null);
	const [report, setReport] = useState<DigestReport | null>(null);

	useEffect(() => {
		mounted.current = true;

		void digestHostApi
			.read()
			.then((next) => {
				if (!mounted.current) return;

				setView(next);
				setStored(next.settings);
				setDraft(next.settings);
				setFailure(null);
			})
			.catch((error: unknown) => {
				if (!mounted.current) return;

				setFailure(error instanceof Error ? error.message : String(error));
			});

		return () => {
			mounted.current = false;
		};
	}, []);

	const edit = useCallback((patch: Partial<DigestSettings>): void => {
		setDraft((current) =>
			current === null ? current : { ...current, ...patch },
		);
	}, []);

	const save = useCallback(async (): Promise<void> => {
		const wanted = draft;
		if (wanted === null) return;

		setPending("save");

		try {
			const next = await digestHostApi.save({
				time: wanted.time,
				timeZone: wanted.timeZone,
				limit: wanted.limit,
				days: [...wanted.days],
				blocks: { ...wanted.blocks },
			});

			if (!mounted.current) return;

			setView(next);
			setStored(next.settings);
			setDraft(next.settings);
			setFailure(null);
		} catch (error) {
			if (!mounted.current) return;

			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			if (mounted.current) setPending(null);
		}
	}, [draft]);

	const showNow = useCallback(async (): Promise<void> => {
		setPending("now");

		try {
			const next = await digestHostApi.now();

			if (!mounted.current) return;

			setReport(next);
			setFailure(null);
		} catch (error) {
			if (!mounted.current) return;

			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			if (mounted.current) setPending(null);
		}
	}, []);

	if (view === null || stored === null || draft === null) {
		return (
			<section className={styles.section}>
				<div className={styles.card}>
					<div className={styles.head}>
						<span className={styles.title}>Daily digest</span>
					</div>

					<div className={styles.caption}>
						{failure === null
							? "Reading the digest settings…"
							: "The digest host half is not reachable."}
					</div>

					{failure === null ? null : (
						<div className={styles.code}>{failure}</div>
					)}
				</div>
			</section>
		);
	}

	const on = view.blocks.filter((block) => isOn(block, draft)).length;
	const busy = pending !== null;
	const timeOk = isDigestTime(draft.time);
	const zoneOk = isTimeZone(draft.timeZone);
	const daysOk = draft.days.length > 0;
	const changed = {
		time: draft.time !== stored.time,
		timeZone: draft.timeZone !== stored.timeZone,
		limit: draft.limit !== stored.limit,
		days: !sameDays(draft.days, stored.days),
		blocks: view.blocks.some(
			(block) => isOn(block, draft) !== isOn(block, stored),
		),
	};
	const dirty = Object.values(changed).some((moved) => moved);

	return (
		<section className={styles.section}>
			<div className={styles.card}>
				<div className={styles.head}>
					<span className={styles.title}>Daily digest</span>

					<span className={styles.state}>
						<StateDot state={on === 0 ? "idle" : "done"} />

						<span className={styles.stateWord}>
							{`${on} of ${view.blocks.length} blocks`}
						</span>

						{view.providers.length === 0 ? null : (
							<span>{`· ${view.providers.join(", ")}`}</span>
						)}
					</span>
				</div>

				<div className={styles.caption}>
					One read-only summary of the work waiting for you. It never writes to
					Jira, GitLab or Sentry.
				</div>

				<Field
					label="Time"
					changed={changed.time}
					hint="Local wall-clock time, in the zone below."
				>
					<Input
						type="time"
						aria-label="Digest time"
						value={draft.time}
						disabled={busy}
						onChange={(event) => {
							edit({ time: event.target.value });
						}}
					/>

					{timeOk ? null : (
						<span className={styles.error}>
							A time reads as HH:MM, midnight through 23:59.
						</span>
					)}
				</Field>

				<Field
					label="Time zone"
					changed={changed.timeZone}
					hint="An IANA name, such as Europe/Moscow."
				>
					<Input
						aria-label="Digest time zone"
						value={draft.timeZone}
						placeholder="Europe/Moscow"
						disabled={busy}
						onChange={(event) => {
							edit({ timeZone: event.target.value });
						}}
					/>

					{zoneOk ? null : (
						<span className={styles.error}>No zone is named that.</span>
					)}
				</Field>

				<Field label="Rows per block" changed={changed.limit}>
					<SegmentedControl
						id="digest-limit"
						label="Rows per block"
						value={String(draft.limit)}
						options={DIGEST_LIMITS.map((limit) => ({
							value: String(limit),
							label: String(limit),
						}))}
						disabled={busy}
						onChange={(value) => {
							edit({ limit: Number(value) });
						}}
					/>
				</Field>

				<Field label="Days" changed={changed.days}>
					<div className={styles.days}>
						{DAY_LABELS.map((label, day) => (
							<Checkbox
								key={label}
								label={label}
								checked={draft.days.includes(day)}
								disabled={busy}
								onChange={(checked) => {
									edit({
										days: checked
											? [...draft.days, day].sort((left, right) => left - right)
											: draft.days.filter((value) => value !== day),
									});
								}}
							/>
						))}
					</div>

					{daysOk ? null : (
						<span className={styles.error}>
							Pick at least one day; an empty week never arrives.
						</span>
					)}
				</Field>

				<div className={styles.block}>
					<div className={styles.blockHead}>
						<span className={styles.blockTitle}>Blocks</span>

						{changed.blocks ? (
							<span className={styles.fieldChanged}>Changed</span>
						) : null}
					</div>

					{view.blocks.length === 0 ? (
						<p className={styles.blockNote}>
							No integration is offering digest blocks yet. Connect Jira, GitLab
							or Sentry on the Integrations page, and their blocks appear here.
						</p>
					) : (
						view.blocks.map((block) => (
							<Checkbox
								key={block.id}
								label={`${block.title} (${block.provider})`}
								checked={isOn(block, draft)}
								disabled={busy}
								onChange={(checked) => {
									edit({ blocks: { ...draft.blocks, [block.id]: checked } });
								}}
							/>
						))
					)}
				</div>

				<div className={styles.caption}>
					{view.canSchedule
						? `Run /digest on in the session that should receive it${view.scheduled === 0 ? "" : ` — ${view.scheduled} session${view.scheduled === 1 ? "" : "s"} already do`}.`
						: "This harness composes no reminder service, so the digest can only be shown on demand."}
				</div>

				{failure === null ? null : (
					<div className={styles.error}>{failure}</div>
				)}

				<div className={styles.footer}>
					<Button
						variant="primary"
						disabled={busy || !dirty || !timeOk || !zoneOk || !daysOk}
						onClick={() => void save()}
					>
						{pending === "save" ? "Saving…" : "Save"}
					</Button>

					{dirty ? (
						<Button
							variant="ghost"
							disabled={busy}
							onClick={() => {
								setDraft(stored);
							}}
						>
							Discard
						</Button>
					) : null}

					<Button
						variant="outline"
						disabled={busy}
						onClick={() => void showNow()}
					>
						{pending === "now" ? "Working…" : "Show now"}
					</Button>
				</div>
			</div>

			{report === null ? null : (
				<div className={styles.card}>
					<div className={styles.head}>
						<span className={styles.title}>{report.title}</span>

						<span className={styles.caption}>
							{new Date(report.generatedAt).toLocaleString()}
						</span>
					</div>

					{report.sections.length === 0 ? (
						<div className={styles.caption}>
							Nothing is switched on yet, or no integration is connected.
						</div>
					) : (
						report.sections.map((section) => (
							<Preview key={section.block} section={section} />
						))
					)}
				</div>
			)}
		</section>
	);
};
