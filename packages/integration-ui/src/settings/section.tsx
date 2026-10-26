/**
 * The shared settings card.
 *
 * It shows the sign-in state and the connection state, and it is the only place
 * a user has to go to connect: the button starts the OAuth flow in the host,
 * which opens the browser, and this card follows the attempt until it settles.
 *
 * Three kinds of provider share it, and `credentials` says which one this is: a
 * browser flow, a credential the user types, or nothing at all for a server that
 * answers whoever is on the machine. The three are alternatives rather than
 * options, so the type does not let a card carry two of them.
 *
 * The card shows one thing at a time. A signed-in provider reports its state and
 * offers to sign out; the field that replaces its credential appears only when
 * the user asks for it, because a token box beside a working connection reads as
 * an unfinished setup. What the user has to read — the account, the expiry, the
 * failure — is a row of facts rather than a row of chips.
 *
 * Everything a provider says about itself is one field of the spec, so the two
 * can never drift apart between integrations; what the provider adds — the
 * account it works with — arrives as those facts.
 */

import {
	Button,
	Input,
	Modal,
	StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { IntegrationStatus } from "dsh-integration-host/status";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type FactItem, Facts } from "../fact";
import * as styles from "../styles/styles.css";

/** How often to re-read the host while an attempt is running. */
const POLL_MS = 1500;

type ConnectionState = "done" | "ongoing" | "idle";

/** The operations every settings card drives. */
export interface SettingsApi<TStatus extends IntegrationStatus> {
	/** Read the current sign-in and connection state. */
	status(): Promise<TStatus>;
	/** Start a sign-in attempt; a token card has no flow to start. */
	login?(): Promise<TStatus>;
	/** Stop a running browser flow; a token card has nothing to stop. */
	cancel?(): Promise<TStatus>;
	/** Forget the stored credential and withdraw the published tools. */
	logout(): Promise<TStatus>;
	/** Verify the stored credential and re-publish the integration's tools. */
	sync(): Promise<TStatus>;
}

/**
 * A credential the user types, for an integration with no browser flow.
 *
 * Some providers have no page to send the user to: a personal access token, a
 * client id and secret the administrator issued. The card then offers a field
 * instead of a sign-in button, and the same status document says whether what
 * was stored works.
 */
export interface TokenFieldSpec<TStatus extends IntegrationStatus> {
	/** The field's own name, such as "Personal access token". */
	readonly label: string;
	readonly placeholder: string;
	/** Where the user gets one, in one sentence. */
	readonly hint: string;
	/** Where the user gets one, when the provider has a page for it. */
	readonly hintUrl?: string;
	/** The link's text, when it differs from "Open the token page". */
	readonly hintLinkLabel?: string;
	readonly saveLabel: string;
	/** What the button that opens the field says once a credential is stored. */
	readonly replaceLabel: string;
	/** What the button that forgets the stored credential says. */
	readonly clearLabel: string;
	/**
	 * Store one typed credential and verify it.
	 * @returns the status as it now stands, error and all.
	 */
	save(token: string): Promise<TStatus>;
}

/** What every settings card says, whatever it does to connect. */
interface SectionCommon<TStatus extends IntegrationStatus> {
	readonly title: string;
	readonly blurb: string;
	/** What the card says while the first read is in flight. */
	readonly checking: string;
	/** What the card says when the host half does not answer at all. */
	readonly unreachable: string;
	readonly syncLabel: string;
	readonly api: SettingsApi<TStatus>;
	/**
	 * Rows the provider adds under the blurb, such as the account it works with.
	 *
	 * A row without a value renders nothing, so a provider lists every field it
	 * knows about without branching on each one.
	 */
	readonly details?: (status: TStatus) => readonly FactItem[];
}

/** A card whose provider signs in through a browser. */
interface BrowserSection<TStatus extends IntegrationStatus>
	extends SectionCommon<TStatus> {
	readonly credentials: "browser";
	readonly signInLabel: string;
	/** A browser card has no field: the two are alternatives, not options. */
	readonly token?: undefined;
	/** Its provider can start a flow, so its api must offer one. */
	readonly api: SettingsApi<TStatus> & { login(): Promise<TStatus> };
}

/** A card whose provider's credential is typed by the user. */
interface TokenSection<TStatus extends IntegrationStatus>
	extends SectionCommon<TStatus> {
	readonly credentials: "typed";
	readonly token: TokenFieldSpec<TStatus>;
	readonly signInLabel?: undefined;
}

/**
 * A card for a provider that needs no credential at all.
 *
 * A local MCP server answers whoever is on the machine, so there is nothing to
 * type and no page to open: the card reports what the connection is doing and
 * offers the same re-check every other card does.
 */
interface OpenSection<TStatus extends IntegrationStatus>
	extends SectionCommon<TStatus> {
	readonly credentials: "none";
	readonly signInLabel?: undefined;
	readonly token?: undefined;
}

/** Everything one integration's settings card says and does. */
export type SettingsSectionSpec<TStatus extends IntegrationStatus> =
	| BrowserSection<TStatus>
	| TokenSection<TStatus>
	| OpenSection<TStatus>;

/** One instant as a person reads it, with the zone that makes it unambiguous. */
const expiryText = (time: number): string =>
	new Date(time).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short",
	});

/** What a completed action says, so the card confirms it happened. */
const doneText = (
	key: string,
	credentials: "browser" | "typed" | "none",
): string => {
	if (key === "login") return "Sign-in started.";
	if (key === "logout")
		return credentials === "typed" ? "Credential forgotten." : "Signed out.";
	if (key === "save") return "Token saved.";
	if (key === "sync") return "Connection checked.";
	if (key === "cancel") return "Sign-in cancelled.";

	return "Done.";
};

/** Human text for the connection state, for the tooltip and the dot. */
const connectionState = (status: IntegrationStatus | null): ConnectionState => {
	if (status?.inFlight === true) return "ongoing";

	return status?.connected === true ? "done" : "idle";
};

/** The one word the card prints beside its dot. */
const stateText = (
	status: IntegrationStatus,
	credentials: "browser" | "typed" | "none",
): string => {
	if (status.inFlight === true) return "Connecting";
	if (status.error != null && status.connected !== true)
		return "Connection failed";

	if (credentials === "none")
		return status.connected === true ? "Connected" : "Not connected";

	return status.signedIn === true ? "Signed in" : "Not signed in";
};

/**
 * Build the settings section for one integration.
 * @param spec - the integration's copy, its host calls, and what it adds.
 * @returns the component the plugin registers in `integrations.tab`.
 */
export const createSettingsSection = <TStatus extends IntegrationStatus>(
	spec: SettingsSectionSpec<TStatus>,
): (() => ReactNode) => {
	const Section = (): ReactNode => {
		const mounted = useRef(true);

		const [status, setStatus] = useState<TStatus | null>(null);
		const [failure, setFailure] = useState<string | null>(null);
		/** Which action is running, so only the button that was pressed says so. */
		const [pending, setPending] = useState<string | null>(null);
		const [typed, setTyped] = useState("");
		/** Whether the typed field is open on a card that already holds one. */
		const [replacing, setReplacing] = useState(false);
		/** Whether the typed credential is shown instead of masked. */
		const [revealing, setRevealing] = useState(false);
		/** Which destructive action is waiting for confirmation. */
		const [confirming, setConfirming] = useState<"logout" | null>(null);
		/** What the last completed action did, announced to the screen reader. */
		const [flash, setFlash] = useState<string | null>(null);

		const refresh = useCallback(async () => {
			try {
				const next = await spec.api.status();

				if (!mounted.current) return;

				setStatus(next);
				setFailure(null);
			} catch (error) {
				if (!mounted.current) return;

				setStatus(null);
				setFailure(error instanceof Error ? error.message : String(error));
			}
		}, []);

		useEffect(() => {
			mounted.current = true;
			void refresh();

			return () => {
				mounted.current = false;
			};
		}, [refresh]);

		// Follow a running attempt until the host reports it settled.
		useEffect(() => {
			if (status?.inFlight !== true) return;

			const timer = setInterval(refresh, POLL_MS);

			return () => clearInterval(timer);
		}, [status?.inFlight, refresh]);

		useEffect(() => {
			if (flash === null) return;

			const timer = setTimeout(() => setFlash(null), 4000);

			return () => clearTimeout(timer);
		}, [flash]);

		const act = useCallback(
			async (key: string, action: () => Promise<TStatus>, done?: string) => {
				setPending(key);

				try {
					const next = await action();

					if (!mounted.current) return;

					setStatus(next);
					setFailure(null);
					if (done !== undefined) setFlash(done);
				} catch (error) {
					if (!mounted.current) return;

					setFailure(error instanceof Error ? error.message : String(error));
				} finally {
					if (mounted.current) setPending(null);
				}
			},
			[],
		);

		// No status yet: either the first read is still in flight, or the host half
		// did not answer. Returning here is what narrows `status` for the card below.
		const tokenField = spec.token;

		if (status === null) {
			return (
				<section className={styles.section}>
					<div className={styles.card}>
						<div className={styles.head}>
							<span className={styles.title}>{spec.title}</span>
						</div>

						<div className={styles.caption}>
							{failure === null ? spec.checking : spec.unreachable}
						</div>

						{failure === null ? null : (
							<div className={styles.code} role="alert">
								{failure}
							</div>
						)}

						<div className={styles.actions}>
							<Button variant="outline" onClick={refresh}>
								Try again
							</Button>
						</div>
					</div>
				</section>
			);
		}

		const signedIn = status.signedIn === true;
		const waiting = status.inFlight === true;
		const toolCount = status.tools.length;
		// A card for a server that needs no credential has no token to expire, and
		// says so by never showing the line rather than by showing an empty one.
		const expiry =
			signedIn && spec.credentials !== "none" ? status.expiresAt : null;
		// A field belongs on the card when nothing is stored yet, or when the user
		// asked to replace what is.
		const showField = tokenField !== undefined && (!signedIn || replacing);
		const field = spec.token;

		/** The label of one action: the running one says what it is doing. */
		const label = (key: string, text: string): string =>
			pending === key ? "Working…" : text;

		return (
			<section className={styles.section}>
				<div className={styles.card}>
					<div className={styles.head}>
						<span className={styles.title}>{spec.title}</span>

						<span className={styles.state}>
							<StateDot state={connectionState(status)} />

							<span className={styles.stateWord}>
								{stateText(status, spec.credentials)}
							</span>

							{status.connected !== true || toolCount === 0 ? null : (
								<span>{`· ${toolCount} tool${toolCount === 1 ? "" : "s"}`}</span>
							)}
						</span>
					</div>

					<div className={styles.caption}>{spec.blurb}</div>

					<Facts
						items={[
							...(spec.details?.(status) ?? []),
							...(expiry === null
								? []
								: [
										{
											label: "Token",
											value: `valid until ${expiryText(expiry)}`,
										},
									]),
						]}
					/>

					{waiting ? (
						<div className={styles.row}>
							<span className={styles.caption}>
								<StateDot state="ongoing" /> Waiting for you to approve the
								sign-in in your browser…
							</span>

							{spec.api.cancel === undefined ? null : (
								<Button
									variant="ghost"
									disabled={pending !== null}
									onClick={() => {
										const cancel = spec.api.cancel;

										if (cancel !== undefined)
											void act(
												"cancel",
												cancel,
												doneText("cancel", spec.credentials),
											);
									}}
								>
									{label("cancel", "Cancel")}
								</Button>
							)}
						</div>
					) : null}

					{status.notice === null ? null : (
						<div className={styles.row}>
							<span className={styles.caption}>{status.notice.message}</span>

							{status.notice.url === undefined ? null : (
								<a
									className={styles.link}
									href={status.notice.url}
									target="_blank"
									rel="noreferrer"
								>
									Open the sign-in page
								</a>
							)}
						</div>
					)}

					{status.error != null ? (
						<div className={styles.row} role="alert">
							<span className={styles.error}>{status.error}</span>
						</div>
					) : null}

					{flash === null ? null : (
						<div className={styles.flash} role="status" aria-live="polite">
							{flash}
						</div>
					)}

					{showField && field !== undefined ? (
						<>
							<div className={styles.fieldRow}>
								<Input
									type={revealing ? "text" : "password"}
									value={typed}
									placeholder={field.placeholder}
									aria-label={field.label}
									disabled={pending !== null}
									onChange={(event) => {
										setTyped(event.target.value);
									}}
								/>

								<Button
									variant="ghost"
									disabled={pending !== null || typed === ""}
									onClick={() => setRevealing((shown) => !shown)}
								>
									{revealing ? "Hide" : "Show"}
								</Button>
							</div>

							<div className={styles.caption}>
								{field.hint}

								{field.hintUrl === undefined ? null : (
									<>
										{" "}
										<a
											className={styles.link}
											href={field.hintUrl}
											target="_blank"
											rel="noreferrer"
										>
											{field.hintLinkLabel ?? "Open the token page"}
										</a>
									</>
								)}
							</div>
						</>
					) : null}

					<div className={styles.actions}>
						{spec.credentials === "browser" ? (
							signedIn ? (
								<Button
									variant="outline"
									disabled={pending !== null}
									onClick={() => setConfirming("logout")}
								>
									{label("logout", "Sign out")}
								</Button>
							) : (
								<Button
									variant="primary"
									disabled={pending !== null || waiting}
									onClick={() =>
										void act(
											"login",
											spec.api.login,
											doneText("login", spec.credentials),
										)
									}
								>
									{label("login", waiting ? "Waiting…" : spec.signInLabel)}
								</Button>
							)
						) : null}

						{spec.credentials === "typed" && field !== undefined ? (
							<>
								{showField ? (
									<>
										<Button
											variant="primary"
											disabled={pending !== null || typed.trim() === ""}
											onClick={() => {
												void act("save", async () => {
													const next = await field.save(typed);

													setTyped("");
													setReplacing(false);

													return next;
												});
											}}
										>
											{label("save", field.saveLabel)}
										</Button>

										{signedIn ? (
											<Button
												variant="ghost"
												disabled={pending !== null}
												onClick={() => {
													setTyped("");
													setReplacing(false);
												}}
											>
												Cancel
											</Button>
										) : null}
									</>
								) : (
									<Button
										variant="outline"
										disabled={pending !== null}
										onClick={() => {
											setReplacing(true);
										}}
									>
										{field.replaceLabel}
									</Button>
								)}

								{signedIn ? (
									<Button
										variant="ghost"
										disabled={pending !== null}
										onClick={() => setConfirming("logout")}
									>
										{label("logout", field.clearLabel)}
									</Button>
								) : null}
							</>
						) : null}

						<Button
							variant="ghost"
							disabled={pending !== null || waiting}
							onClick={() => void act("sync", spec.api.sync)}
						>
							{label("sync", spec.syncLabel)}
						</Button>
					</div>
				</div>

				<Modal
					open={confirming !== null}
					onClose={() => setConfirming(null)}
					closeLabel="Close"
					title={
						spec.credentials === "typed"
							? `Forget the ${spec.title} credential?`
							: `Sign out of ${spec.title}?`
					}
					description={
						spec.credentials === "typed"
							? "The stored token is removed and the integration’s tools stop working until another one is saved."
							: "The stored credential is removed and the integration’s tools stop working until you sign in again."
					}
					footer={
						<>
							<Button
								variant="ghost"
								disabled={pending !== null}
								onClick={() => setConfirming(null)}
							>
								Cancel
							</Button>

							<Button
								variant="primary"
								disabled={pending !== null}
								onClick={() => {
									setConfirming(null);
									void act(
										"logout",
										spec.api.logout,
										doneText("logout", spec.credentials),
									);
								}}
							>
								{spec.credentials === "typed"
									? (spec.token?.clearLabel ?? "Forget token")
									: "Sign out"}
							</Button>
						</>
					}
				/>
			</section>
		);
	};

	return Section;
};
