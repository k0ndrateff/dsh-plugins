# dsh-browser-plugin

## 0.3.0

### Minor Changes

- UX/AX improvements.

### Patch Changes

- Fix the UX/AX audit: human errors and states, install fallback for single
  bundles, OAuth cancellation and callback copy, GitLab reply/approval context and
  limits, Figma connection copy and zoom, browser states/retry/screenshot/close,
  digest preview and atomic save, correlation branches/caps, checks severity and
  line-aware actions, and model-facing output budgets. English UI stays an explicit
  decision; tool names are unchanged.

## 0.2.2

### Patch Changes

- Close the P2 UX and reliability findings: human GitLab state/status labels, a
  readable Sentry assignee menu, the Atlassian site on its settings card, a
  schedule-aware digest title, a cached lazy panel opener, a bounded browser chip
  poll, long-session fingerprints, a truthful `browser_read` count, the browser
  namespace, Figma numeric entities, and the removal of unused Atlassian meta text
  and the GitLab MCP client dependency.

## 0.2.1

### Patch Changes

- Add `dsh-integration-host/shape`, a small declarative reader for the JSON the
  two halves exchange, and use it for every card and panel validator instead of
  per-package `asString`/`isRecord` helpers. Optional fields stay absent, lists
  drop malformed items, and Jira-style booleans and defaults keep their old
  meaning.

## 0.2.0

### Minor Changes

- Fixed many bugs and security issues.

### Patch Changes

- 8cd5a95: Fix the P0/P1 findings from the 23.10.2026 audit: the write-route client
  guard, digest clock/settings storage, the browser settings injection, OAuth
  token and endpoint checks, empty search results, Atlassian MCP result parsing,
  GitLab diff/pagination/auth, Figma bridge lifetime, browser isolation and
  input, and a CI that runs the offline checks.

## 0.1.3

### Patch Changes

- Added interactivity and fixed some bugs.

## 0.1.2

### Patch Changes

- Fixed browser panel issues.

## 0.1.1

### Patch Changes

- Added host and client with sidebar browser panel.
