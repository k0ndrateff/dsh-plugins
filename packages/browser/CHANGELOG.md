# dsh-browser-plugin

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
