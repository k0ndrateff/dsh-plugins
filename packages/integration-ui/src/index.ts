/**
 * The browser-half shell every integration plugin shares.
 *
 * A plugin's browser half owns what is its provider's — the panel document, the
 * card payload, the tool summary, the settings copy — while this library owns
 * the shell around them: one side-panel body that loads, fails, retries and
 * writes, one turn-tail card, the terse tool row, the settings section, and the
 * stylesheet they are all drawn with.
 *
 * The plugin still registers each seat itself, under its own tab kind and its
 * own tool names, because a kind is what `openTab` names and what the Sidebar's
 * registry keys a body by.
 */

export {
	createPresentationType,
	type PresentationSpec,
	type PresentationTurnData,
	type PresentationTurnOwner,
	type PresentationTurnState,
	type PresentationType,
	type PresentedCard,
} from "./card/definition";
export { createPresentationTail } from "./card/tail";
export type {
	CardProvider,
	PresentationLayout,
	PresentationLayoutInput,
} from "./card/types";
export { Chip, type FactItem, Facts } from "./fact";
export { createHostRequest, type HostRequest } from "./host-api";
export { createPanelBody } from "./panel/body";
export {
	createPanelDefinition,
	type PanelTypeSpec,
} from "./panel/definition";
export {
	createLazyPanelOpener,
	createPanelOpener,
	type PanelOpener,
	wantsBrowser,
} from "./panel/open";
export { createPanelTitle } from "./panel/title";
export type {
	PanelActions,
	PanelProvider,
	PanelViewProps,
	PanelWrite,
} from "./panel/types";
export {
	createSettingsSection,
	type SettingsApi,
	type SettingsSectionSpec,
	type TokenFieldSpec,
} from "./settings/section";
export {
	type IntegrationsTabSpec,
	registerIntegrationsTab,
} from "./settings/tab";
export { installStyles } from "./styles/runtime";
export {
	blockArgs,
	createToolRow,
	type ToolRowBlock,
	type ToolRowProps,
	type ToolRowSpec,
} from "./tool/row";
