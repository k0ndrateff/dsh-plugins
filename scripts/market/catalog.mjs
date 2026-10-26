/**
 * What the market index says about each plugin, beyond what a package carries.
 *
 * A package's own `package.json` and `locale/en.json` already give a reader its
 * name, its description and its icon. What they do not give is how a *market*
 * should file it: which category it belongs under, which labels describe how it
 * connects, and which words somebody would search for. That is editorial, it
 * belongs in one place rather than spread across thirteen manifests, and it is
 * this file.
 *
 * Categories, labels and keywords are declared here rather than per plugin,
 * because the index format validates them: a plugin may only name an id the
 * index declares, which is what keeps "mcp" from becoming "MCP" in one entry and
 * "mcp-server" in another.
 */

/** The index's own heading and its declaration tables. */
export const INDEX = {
	title: "DeepSeek Harness plugins",
	description:
		"Integrations, a daily digest and cross-provider correlation for DeepSeek Harness.",
	metadata: {
		categories: {
			integration: { title: "Integration" },
			workflow: { title: "Workflow" },
			developer: { title: "Developer" },
			setup: { title: "Setup" },
		},
		labels: {
			mcp: { title: "Talks MCP" },
			rest: { title: "Talks REST" },
			oauth: { title: "Browser sign-in" },
			token: { title: "Paste a token" },
			"no-credential": { title: "No credential" },
			"read-only": { title: "Reads only" },
			"runs-commands": { title: "Runs project commands" },
			writes: { title: "Can write" },
		},
	},
};

/**
 * How each plugin is filed, in the order the index lists them.
 *
 * The order is deliberate: the integrations a user comes for first, then the two
 * things built on top of them, then the page their settings appear on, the
 * project checks, and the bundle that mounts everything.
 */
export const PLUGINS = {
	"dsh-atlassian-plugin": {
		category: "integration",
		labels: ["mcp", "oauth", "writes"],
		keywords: ["jira", "confluence", "issues", "wiki", "sprint", "atlassian"],
	},
	"dsh-sentry-plugin": {
		category: "integration",
		labels: ["mcp", "oauth", "writes"],
		keywords: ["sentry", "errors", "stack trace", "releases", "issues"],
	},
	"dsh-gitlab-plugin": {
		category: "integration",
		labels: ["rest", "token", "writes"],
		keywords: [
			"gitlab",
			"merge request",
			"code review",
			"pipelines",
			"jobs",
			"diff",
		],
	},
	"dsh-figma-plugin": {
		category: "integration",
		labels: ["mcp", "no-credential", "read-only"],
		keywords: [
			"figma",
			"design",
			"frame",
			"tokens",
			"variables",
			"code connect",
		],
	},
	"dsh-digest-plugin": {
		category: "workflow",
		labels: ["read-only"],
		keywords: ["digest", "daily", "summary", "schedule", "morning"],
	},
	"dsh-correlation-plugin": {
		category: "workflow",
		labels: ["read-only"],
		keywords: [
			"correlation",
			"chain",
			"commit",
			"merge request",
			"ticket",
			"root cause",
		],
	},
	"dsh-integrations-plugin": {
		category: "setup",
		labels: [],
		keywords: ["settings", "integrations", "connections", "sign in"],
	},
	"dsh-devkit-plugin": {
		category: "developer",
		labels: ["read-only", "runs-commands"],
		keywords: ["checks", "lint", "typecheck", "tests", "build", "recipes"],
	},
	"dsh-browser-plugin": {
		category: "developer",
		labels: ["no-credential", "writes"],
		keywords: [
			"browser",
			"chrome",
			"headless",
			"page",
			"ui",
			"screenshot",
			"playwright",
			"verify",
		],
	},
	"dsh-workflow-plugin": {
		category: "setup",
		labels: [],
		keywords: ["all", "everything", "bundle", "meta"],
	},
};

/** Where the index is served from, which every relative reference resolves against. */
export const INDEX_URL = "https://k0ndrateff.github.io/dsh-plugins/market.json";
