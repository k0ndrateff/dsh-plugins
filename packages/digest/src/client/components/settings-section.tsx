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
 * save instead of failing it. "Show now" previews the same draft, because a
 * preview of the saved settings is a preview of the wrong thing.
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
	digestStamp,
	digestTitle,
	emptyDigestNote,
	isDigestTime,
	isTimeZone,
	WEEK_ORDER,
} from "../../shared/digest";
import { digestHostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/** The id the save-state line carries, so the button can point at it. */
const SAVE_STATE_ID = "digest-save-state";

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

		{section.truncated === true && section.total !== undefined ? (
			<p className={styles.blockNote}>
				{`Showing ${section.items.length} of at least ${section.total} rows — raise Rows per block to see more.`}
			</p>
		) : null}
	</div>
);

/** One staged field: its name, its control, and what the control means. */
const Field = ({
	label,
	hint,
	changed = false,
	error,
	children,
}: {
	label: string;
	hint?: string;
	changed?: boolean;
	/** The field's validation failure, announced and linked to its control. */
	error?: { readonly id: string; readonly text: string };
	children: ReactNode;
}) => (
	<div className={styles.field}>
		<div className={styles.fieldHead}>
			<span className={styles.fieldLabel}>{label}</span>

			{changed ? <span className={styles.fieldChanged}>Changed</span> : null}
		</div>

		{children}

		{hint === undefined ? null : <span className={styles.caption}>{hint}</span>}

		{error === undefined ? null : (
			<span className={styles.error} id={error.id} role="alert">
				{error.text}
			</span>
		)}
	</div>
);

/** Whether one block's switch is on in a set of settings. */
const isOn = (block: DigestBlockView, settings: DigestSettings): boolean =>
	settings.blocks[block.id] ?? block.on;

/** Whether two day selections name the same weekdays. */
const sameDays = (left: readonly number[], right: readonly number[]): boolean =>
	left.length === right.length && left.every((day) => right.includes(day));

/** Whether two saved switch maps say the same thing. */
const sameBlocks = (
	left: Readonly<Record<string, boolean>>,
	right: Readonly<Record<string, boolean>>,
): boolean => {
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

	return [...keys].every((key) => left[key] === right[key]);
};

/** Whether two configurations are the same document. */
const sameSettings = (left: DigestSettings, right: DigestSettings): boolean =>
	left.time === right.time &&
	left.timeZone === right.timeZone &&
	left.limit === right.limit &&
	sameDays(left.days, right.days) &&
	sameBlocks(left.blocks, right.blocks);

/** The digest settings card. */
export const DigestSettingsSection = (): ReactNode => {
	const mounted = useRef(true);
	const [view, setView] = useState<DigestSettingsView | null>(null);
	/** What the host holds, which is what the draft is compared against. */
	const [stored, setStored] = useState<DigestSettings | null>(null);
	/** What the user has edited, written only on save. */
	const [draft, setDraft] = useState<DigestSettings | null>(null);
	/** Why the last read or save failed, in the host's or the browser's words. */
	const [failure, setFailure] = useState<string | null>(null);
	/** Whether the failure was the very first read, so the card is still empty. */
	const [unread, setUnread] = useState(false);
	const [pending, setPending] = useState<"save" | "now" | null>(null);
	const [report, setReport] = useState<DigestReport | null>(null);
	/** What just happened, announced through the save-state line. */
	const [notice, setNotice] = useState<string | null>(null);

	const load = useCallback(async (): Promise<void> => {
		setFailure(null);

		try {
			const next = await digestHostApi.read();

			if (!mounted.current) return;

			setView(next);
			setStored(next.settings);
			setDraft(next.settings);
			setUnread(false);
		} catch (error) {
			if (!mounted.current) return;

			setUnread(true);
			setFailure(error instanceof Error ? error.message : String(error));
		}
	}, []);

	useEffect(() => {
		mounted.current = true;

		void load();

		return () => {
			mounted.current = false;
		};
	}, [load]);

	const edit = useCallback((patch: Partial<DigestSettings>): void => {
		setNotice(null);
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
			setNotice("Saved.");
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
			const next = await digestHostApi.now(
				draft === null || stored === null || sameSettings(draft, stored)
					? undefined
					: draft,
			);

			if (!mounted.current) return;

			setReport(next);
			setFailure(null);
		} catch (error) {
			if (!mounted.current) return;

			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			if (mounted.current) setPending(null);
		}
	}, [draft, stored]);

	if (view === null || stored === null || draft === null) {
		return (
			<section className={styles.section}>
				<div className={styles.card}>
					<div className={styles.head}>
						<span className={styles.title}>Digest</span>
					</div>

					{unread ? null : (
						<div className={styles.caption}>Reading the digest settings…</div>
					)}

					{unread ? (
						<>
							<div className={styles.caption} role="alert">
								The digest settings could not be read. The digest plugin may not
								be running, or its host half may still be starting up.
							</div>

							<Button variant="outline" onClick={() => void load()}>
								Try again
							</Button>

							{failure === null ? null : (
								<details>
									<summary className={styles.caption}>Technical detail</summary>
									<div className={styles.code}>{failure}</div>
								</details>
							)}
						</>
					) : null}
				</div>
			</section>
		);
	}

	const onBlocks = view.blocks.filter((block) => isOn(block, draft)).length;
	const busy = pending !== null;
	const timeError = isDigestTime(draft.time)
		? undefined
		: "A time reads as HH:MM, midnight through 23:59.";
	const zoneError = isTimeZone(draft.timeZone)
		? undefined
		: "No zone is named that.";
	const daysError =
		draft.days.length > 0
			? undefined
			: "Pick at least one day; an empty week never arrives.";
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
	const invalid =
		timeError !== undefined ||
		zoneError !== undefined ||
		daysError !== undefined;
	/** Why the Save button is in the state it is, said rather than implied. */
	const saveState =
		notice ??
		(invalid
			? "Fix the highlighted field before saving."
			: dirty
				? "Unsaved changes — Save to apply them."
				: "Everything is saved.");

	return (
		<section className={styles.section}>
			<div className={styles.card}>
				<div className={styles.head}>
					<span className={styles.title}>{digestTitle(draft.days)}</span>

					<span className={styles.state}>
						<StateDot state={onBlocks === 0 ? "idle" : "done"} />

						<span className={styles.stateWord}>
							{`${onBlocks} of ${view.blocks.length} blocks`}
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
					error={
						timeError === undefined
							? undefined
							: { id: "digest-time-error", text: timeError }
					}
				>
					<Input
						type="time"
						aria-label="Digest time"
						aria-invalid={timeError !== undefined}
						aria-describedby={
							timeError === undefined ? undefined : "digest-time-error"
						}
						value={draft.time}
						disabled={busy}
						onChange={(event) => {
							edit({ time: event.target.value });
						}}
					/>
				</Field>

				<Field
					label="Time zone"
					changed={changed.timeZone}
					hint="An IANA name, such as Europe/Moscow."
					error={
						zoneError === undefined
							? undefined
							: { id: "digest-zone-error", text: zoneError }
					}
				>
					<Input
						aria-label="Digest time zone"
						aria-invalid={zoneError !== undefined}
						aria-describedby={
							zoneError === undefined ? undefined : "digest-zone-error"
						}
						value={draft.timeZone}
						placeholder="Europe/Moscow"
						disabled={busy}
						onChange={(event) => {
							edit({ timeZone: event.target.value });
						}}
					/>
				</Field>

				<Field
					label="Rows per block"
					changed={changed.limit}
					hint="The most rows one block shows. A block with more says how many it left out."
				>
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

				<Field
					label="Days"
					changed={changed.days}
					error={
						daysError === undefined
							? undefined
							: { id: "digest-days-error", text: daysError }
					}
				>
					<fieldset
						className={styles.days}
						aria-label="Delivery days"
						aria-describedby={
							daysError === undefined ? undefined : "digest-days-error"
						}
					>
						{WEEK_ORDER.map((day) => (
							<Checkbox
								key={DAY_LABELS[day]}
								label={DAY_LABELS[day] ?? String(day)}
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
					</fieldset>
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
					{!view.canSchedule
						? "This harness composes no reminder service, so the digest can only be shown on demand."
						: view.remindersError === undefined
							? `Run /digest on in the session that should receive it${view.scheduled === 0 ? "" : ` — ${view.scheduled} session${view.scheduled === 1 ? "" : "s"} already do`}.`
							: `How many sessions receive the digest is unknown: the reminder catalog could not be read (${view.remindersError}).`}
				</div>

				{failure === null ? null : (
					<div className={styles.error} role="alert">
						{failure}
					</div>
				)}

				<div className={styles.footer}>
					<Button
						variant="primary"
						disabled={busy || !dirty || invalid}
						aria-describedby={SAVE_STATE_ID}
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
								setNotice(null);
							}}
						>
							Discard
						</Button>
					) : null}

					<Button
						variant="outline"
						disabled={busy || invalid}
						aria-describedby={SAVE_STATE_ID}
						onClick={() => void showNow()}
					>
						{pending === "now" ? "Working…" : "Show now"}
					</Button>

					<span
						className={styles.caption}
						id={SAVE_STATE_ID}
						role="status"
						aria-live="polite"
					>
						{saveState}
					</span>
				</div>
			</div>

			{report === null ? null : (
				<div className={styles.card}>
					<div className={styles.head}>
						<span className={styles.title}>{report.title}</span>

						<span className={styles.caption}>
							{`Assembled ${digestStamp(report.generatedAt, report.timeZone)}`}
						</span>
					</div>

					<div className={styles.caption}>
						{dirty
							? "Preview of your unsaved changes — Save to schedule them this way."
							: "Preview of the saved settings."}
					</div>

					{report.sections.length === 0 ? (
						<div className={styles.caption}>
							{report.offered === undefined
								? "Nothing was reported for this digest."
								: emptyDigestNote(report.offered)}
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
