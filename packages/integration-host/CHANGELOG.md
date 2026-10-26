# dsh-integration-host

## 0.4.1

### Patch Changes

- Fixed settings rendering bug.

## 0.4.0

### Minor Changes

- UX/AX improvements.

### Patch Changes

- Fix the UX/AX audit: human errors and states, install fallback for single
  bundles, OAuth cancellation and callback copy, GitLab reply/approval context and
  limits, Figma connection copy and zoom, browser states/retry/screenshot/close,
  digest preview and atomic save, correlation branches/caps, checks severity and
  line-aware actions, and model-facing output budgets. English UI stays an explicit
  decision; tool names are unchanged.
- Updated dependencies
- Updated dependencies
  - dsh-mcp-oauth@0.3.0

## 0.3.0

### Minor Changes

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
- Updated dependencies [8cd5a95]
- Updated dependencies
  - dsh-mcp-oauth@0.2.0

## 0.1.4

### Patch Changes

- Updated README
- 89d4beb: Readmes and descriptions that stand on their own.
  
  A package page on npm has to explain itself to somebody who has never heard of the
  other twelve. Each README now opens with what the package is, says which collection
  it belongs to and links it, and then describes what it adds; the four libraries say
  plainly that they are libraries, so nobody installs one expecting a plugin.
  `dsh-workflow-plugin` lists the eight packages it mounts and what each gives you,
  which is the question its page was failing to answer.
  
  Descriptions were brought in line at the same time. GitLab's still promised OAuth
  and the MCP server — it has been a personal access token over REST since the
  transport changed — and three packages described themselves in terms of "this
  repository".
- Updated dependencies
- Updated dependencies [89d4beb]
  - dsh-mcp-oauth@0.1.4

## 0.1.3

### Patch Changes

- Fixed installation issue due to broken dependencies declaration.
- 03cfa13: Publish manifests a registry can install.
  
  `changeset publish` runs `npm publish`, and npm — unlike `bun pm pack` — uploads
  the `workspace:` protocol as it stands. Every 0.1.1 and 0.1.2 package carries it,
  which made `dsh-workflow-plugin` impossible to install and `dsh-integration-host`
  and `dsh-integration-ui` unusable as dependencies. Internal dependencies now name
  real ranges, and `bun run market --check` refuses the protocol coming back.
- Updated dependencies
- Updated dependencies [03cfa13]
  - dsh-mcp-oauth@0.1.3

## 0.1.2

### Patch Changes

- Minor documentation updates.
- Updated dependencies
  - dsh-mcp-oauth@0.1.2

## 0.1.1

### Patch Changes

- Initial release and publish.
- Updated dependencies
  - dsh-mcp-oauth@0.1.1
