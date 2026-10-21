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
 */

import {
	Button,
	Checkbox,
	Input,
	StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	DAY_LABELS,
	DIGEST_LIMITS,
	type DigestReport,
	type DigestSection,
	type DigestSettings,
	type DigestSettingsView,
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

/** The digest settings card. */
export const DigestSettingsSection = (): ReactNode => {
	const mounted = useRef(true);
	const [view, setView] = useState<DigestSettingsView | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [report, setReport] = useState<DigestReport | null>(null);
	const [zone, setZone] = useState("");

	useEffect(() => {
		mounted.current = true;

		void digestHostApi
			.read()
			.then((next) => {
				if (!mounted.current) return;

				setView(next);
				setZone(next.settings.timeZone);
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

	const save = useCallback(async (patch: Partial<DigestSettings>) => {
		setBusy(true);

		try {
			const next = await digestHostApi.save(patch);

			if (!mounted.current) return;

			setView(next);
			setZone(next.settings.timeZone);
			setFailure(null);
		} catch (error) {
			if (!mounted.current) return;

			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			if (mounted.current) setBusy(false);
		}
	}, []);

	const showNow = useCallback(async () => {
		setBusy(true);

		try {
			const next = await digestHostApi.now();

			if (!mounted.current) return;

			setReport(next);
			setFailure(null);
		} catch (error) {
			if (!mounted.current) return;

			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			if (mounted.current) setBusy(false);
		}
	}, []);

	if (view === null) {
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

	const settings = view.settings;
	const on = view.blocks.filter((block) => block.on).length;

	return (
		<section className={styles.section}>
			<div className={styles.card}>
				<div className={styles.head}>
					<span className={styles.title}>Daily digest</span>

					<span className={styles.badges}>
						<StateDot state={on === 0 ? "idle" : "done"} />

						{view.providers.length === 0 ? (
							<span className={styles.caption}>No integrations connected</span>
						) : (
							<span className={styles.caption}>
								{`${on} of ${view.blocks.length} blocks · ${view.providers.join(", ")}`}
							</span>
						)}
					</span>
				</div>

				<div className={styles.caption}>
					One read-only summary of the work waiting for you. It never writes to
					Jira, GitLab or Sentry.
				</div>

				<div className={styles.row}>
					<span>Time</span>

					<Input
						type="time"
						aria-label="Digest time"
						value={settings.time}
						onChange={(event) => void save({ time: event.target.value })}
					/>
				</div>

				<div className={styles.row}>
					<span>Time zone</span>

					<Input
						aria-label="Digest time zone"
						value={zone}
						placeholder="Europe/Moscow"
						onChange={(event) => setZone(event.target.value)}
						onBlur={() => {
							if (zone !== settings.timeZone) void save({ timeZone: zone });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && zone !== settings.timeZone)
								void save({ timeZone: zone });
						}}
					/>
				</div>

				<div className={styles.row}>
					<span>Rows per block</span>

					<span className={styles.badges}>
						{DIGEST_LIMITS.map((limit) => (
							<Button
								key={limit}
								size="sm"
								variant={limit === settings.limit ? "primary" : "outline"}
								disabled={busy}
								onClick={() => void save({ limit })}
							>
								{String(limit)}
							</Button>
						))}
					</span>
				</div>

				<div className={styles.block}>
					<div className={styles.blockHead}>
						<span className={styles.blockTitle}>Days</span>
					</div>

					<div className={styles.days}>
						{DAY_LABELS.map((label, day) => (
							<Checkbox
								key={label}
								label={label}
								checked={settings.days.includes(day)}
								disabled={busy}
								onChange={(checked) =>
									void save({
										days: checked
											? [...settings.days, day].sort(
													(left, right) => left - right,
												)
											: settings.days.filter((value) => value !== day),
									})
								}
							/>
						))}
					</div>
				</div>

				<div className={styles.block}>
					<div className={styles.blockHead}>
						<span className={styles.blockTitle}>Blocks</span>
					</div>

					{view.blocks.length === 0 ? (
						<p className={styles.blockNote}>
							No integration is offering digest blocks yet. Connect Jira, GitLab
							or Sentry in their own sections above.
						</p>
					) : (
						view.blocks.map((block) => (
							<Checkbox
								key={block.id}
								label={`${block.title} (${block.provider})`}
								checked={block.on}
								disabled={busy}
								onChange={(checked) =>
									void save({ blocks: { [block.id]: checked } })
								}
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

				<div className={styles.actions}>
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => void showNow()}
					>
						{busy ? "Working…" : "Show now"}
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
