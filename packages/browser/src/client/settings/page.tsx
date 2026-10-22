/**
 * The browser's settings page: one staged form over the plugin's own Config.
 *
 * The fields are the plugin's configuration and nothing else — the harness owns
 * where a write lands, and the form stages until Save, so what is on screen is
 * exactly what would be stored. Each control is one leaf of the schema: the
 * live view's own scale, the CLI's own switches, and the one policy this plugin
 * passes through to the CLI.
 */

import {
	Button,
	Checkbox,
	type SettingsFieldState,
	SettingsForm,
	SettingsFormModel,
	SettingsValueField,
	settingsNumberField,
	settingsTextField,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import * as styles from "../styles/styles.css";
import { settingsListField, settingsSwitchField } from "./fields";

/**
 * The Loader entry this page configures, as the settings document names it.
 *
 * Two spellings, because both are real: a row a bundle patch inserts arrives in
 * an include group and keeps that group in its id, while a row written straight
 * into the profile patch is addressed by its own. The page asks the host which
 * one is served rather than guessing, and spells them here because the client
 * half must not depend on a host package.
 */
export const SETTINGS_NAMESPACES = ["include:browser", "browser"] as const;

/** The copy the page and its form frame render. */
const COPY = {
	unavailable:
		"This browser plugin is not loaded, so it has no settings to show right now.",
	readOnly: "This deployment stores settings read-only.",
	saveFailed:
		"The deployment did not accept these values; they were left for you to correct.",
	save: "Save",
	saving: "Saving…",
	overridden: "Overridden",
	reset: "Reset to default",
	invalid: "Not a value this setting accepts",
	executable: "Executable",
	executableHint:
		"The agent-browser CLI to run: a name on PATH or an absolute path.",
	timeoutMs: "Command timeout (ms)",
	timeoutMsHint: "How long one command may take before it is stopped.",
	maxOutputBytes: "Answer limit (bytes)",
	maxOutputBytesHint:
		"How much of one answer the model may read; the rest is cut at a line boundary.",
	headed: "Show the window",
	headedHint:
		"Run a visible browser instead of headless. Takes effect when this session's browser next starts.",
	chromeProfile: "Chrome profile",
	chromeProfileHint:
		"Reuse a real Chrome profile by name or path so the browser starts signed in. Empty means a throwaway profile.",
	allowedDomains: "Allowed domains",
	allowedDomainsHint:
		"Comma-separated patterns the CLI itself allows, such as example.com or *.example.com. Empty means no restriction.",
	streamQuality: "Frame quality",
	streamQualityHint:
		"JPEG quality of the live view, 1 to 100. 60 is about 31 KB a frame at 1280 wide.",
	streamMaxWidth: "Frame width (px)",
	streamMaxWidthHint: "The widest frame the live view encodes.",
	streamMaxHeight: "Frame height (px)",
	streamMaxHeightHint: "The tallest frame the live view encodes.",
	streamMaxFps: "Frames per second",
	streamMaxFpsHint:
		"The most frames per second one open panel asks the screencast for.",
} as const;

/** What the page reads: the form's shell plus every staged field. */
export interface BrowserSettingsSnapshot {
	readonly available: boolean;
	readonly writable: boolean;
	readonly dirty: boolean;
	readonly invalid: boolean;
	readonly saving: boolean;
	readonly failed: boolean;
	readonly executable: SettingsFieldState;
	readonly timeoutMs: SettingsFieldState;
	readonly maxOutputBytes: SettingsFieldState;
	readonly headed: SettingsFieldState;
	readonly chromeProfile: SettingsFieldState;
	readonly allowedDomains: SettingsFieldState;
	readonly streamQuality: SettingsFieldState;
	readonly streamMaxWidth: SettingsFieldState;
	readonly streamMaxHeight: SettingsFieldState;
	readonly streamMaxFps: SettingsFieldState;
}

/** The field names, in the order the page draws them. */
const FIELDS = [
	"executable",
	"timeoutMs",
	"maxOutputBytes",
	"headed",
	"chromeProfile",
	"allowedDomains",
	"streamQuality",
	"streamMaxWidth",
	"streamMaxHeight",
	"streamMaxFps",
] as const;

type Field = (typeof FIELDS)[number];

/** The label and the sentence under each control. */
const LABELS: Readonly<
	Record<Field, { readonly label: string; readonly hint: string }>
> = {
	executable: { label: COPY.executable, hint: COPY.executableHint },
	timeoutMs: { label: COPY.timeoutMs, hint: COPY.timeoutMsHint },
	maxOutputBytes: { label: COPY.maxOutputBytes, hint: COPY.maxOutputBytesHint },
	headed: { label: COPY.headed, hint: COPY.headedHint },
	chromeProfile: { label: COPY.chromeProfile, hint: COPY.chromeProfileHint },
	allowedDomains: {
		label: COPY.allowedDomains,
		hint: COPY.allowedDomainsHint,
	},
	streamQuality: { label: COPY.streamQuality, hint: COPY.streamQualityHint },
	streamMaxWidth: { label: COPY.streamMaxWidth, hint: COPY.streamMaxWidthHint },
	streamMaxHeight: {
		label: COPY.streamMaxHeight,
		hint: COPY.streamMaxHeightHint,
	},
	streamMaxFps: { label: COPY.streamMaxFps, hint: COPY.streamMaxFpsHint },
};

/** Bridges the plugin's settings namespace onto the page's staged form. */
export class BrowserSettingsForm {
	private readonly form: SettingsFormModel<unknown>;
	private readonly store: ReturnType<SettingsFormModel<unknown>["bind"]>;

	/** @param scope - the settings scope for this plugin's Loader entry. */
	constructor(scope: ConstructorParameters<typeof SettingsFormModel>[0]) {
		this.form = new SettingsFormModel(scope, [
			settingsTextField("executable"),
			settingsNumberField("timeoutMs"),
			settingsNumberField("maxOutputBytes"),
			settingsSwitchField("headed"),
			settingsTextField("chromeProfile"),
			settingsListField("allowedDomains"),
			settingsNumberField("streamQuality"),
			settingsNumberField("streamMaxWidth"),
			settingsNumberField("streamMaxHeight"),
			settingsNumberField("streamMaxFps"),
		]);
		this.store = this.form.bind(() => this.projection());
	}

	/**
	 * Build the face the page's slot registration injects.
	 * @returns the page's snapshot store and its form actions.
	 */
	inject() {
		return { hooks: { browserSettings: this.store }, ...this.form.actions() };
	}

	/** Release the form's subscription to accepted values. */
	dispose(): void {
		this.form.dispose();
	}

	private projection(): BrowserSettingsSnapshot {
		const fields = Object.fromEntries(
			FIELDS.map((name) => [name, this.form.field(name)]),
		) as Record<Field, SettingsFieldState>;

		return { ...this.form.shell(), ...fields };
	}
}

/** The face this page's slot registration injects. */
interface BrowserSettingsProps extends PropsRuntime<"settings.plugins.tab"> {
	readonly useBrowserSettings: <T>(
		select: (snapshot: BrowserSettingsSnapshot) => T,
	) => T;
	readonly save: () => void;
	readonly discard: () => void;
	readonly edit: (field: string, text: string) => void;
	readonly resetField: (field: string) => void;
}

/** One control: a two-valued switch, or a staged value field. */
const FieldControl = ({
	name,
	state,
	props,
}: {
	readonly name: Field;
	readonly state: BrowserSettingsSnapshot;
	readonly props: BrowserSettingsProps;
}): ReactNode => {
	const { label, hint } = LABELS[name];
	const field = state[name];
	const reset = (): void => props.resetField(name);
	const edit = (text: string): void => props.edit(name, text);

	if (name === "headed")
		return (
			<div className={styles.configRow}>
				<Checkbox
					checked={field.text === "true"}
					label={label}
					disabled={!state.writable}
					onChange={(next) => edit(next ? "true" : "false")}
				/>

				{field.overridden ? (
					<Button size="sm" variant="ghost" onClick={reset}>
						{COPY.reset}
					</Button>
				) : null}

				<span className={styles.configHint}>{hint}</span>
			</div>
		);

	return (
		<SettingsValueField
			id={`plugin-config-browser-${name}`}
			label={label}
			hint={hint}
			text={field.text}
			overridden={field.overridden}
			invalid={field.invalid}
			overriddenLabel={COPY.overridden}
			resetLabel={COPY.reset}
			invalidLabel={COPY.invalid}
			disabled={!state.writable}
			numeric={
				name !== "executable" &&
				name !== "chromeProfile" &&
				name !== "allowedDomains"
			}
			onEdit={edit}
			onReset={reset}
		/>
	);
};

/** The page: one form, ten controls, and the save the form frame owns. */
export const BrowserSettingsPage = (
	props: PropsRuntime<"settings.plugins.tab">,
): ReactNode => {
	// The slot is declared without an inject face, so the props this page is
	// handed — its own snapshot store and the form's actions — are spelled here
	// rather than inferred from the registration.
	const page = props as unknown as BrowserSettingsProps;
	const state = page.useBrowserSettings((snapshot) => snapshot);

	return (
		<SettingsForm
			labels={{
				unavailable: COPY.unavailable,
				readOnly: COPY.readOnly,
				saveFailed: COPY.saveFailed,
				save: COPY.save,
				saving: COPY.saving,
			}}
			state={state}
			onSave={page.save}
			onDiscard={page.discard}
		>
			{FIELDS.map((name) => (
				<FieldControl key={name} name={name} state={state} props={page} />
			))}
		</SettingsForm>
	);
};
