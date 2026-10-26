# dsh-workflow-plugin

## 0.2.1

### Patch Changes

- Updated dependencies
  - dsh-gitlab-plugin@0.3.0

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
  - dsh-atlassian-plugin@0.4.0
  - dsh-sentry-plugin@0.2.0
  - dsh-gitlab-plugin@0.2.0
  - dsh-figma-plugin@0.2.0
  - dsh-digest-plugin@0.2.0
  - dsh-devkit-plugin@0.2.0
  - dsh-browser-plugin@0.2.0
  - dsh-correlation-plugin@0.2.0
  - dsh-integrations-plugin@0.2.0

## 0.1.5

### Patch Changes

- Updated title and description of the plugin.

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
  - dsh-atlassian-plugin@0.3.4
  - dsh-correlation-plugin@0.1.4
  - dsh-devkit-plugin@0.1.4
  - dsh-digest-plugin@0.1.4
  - dsh-figma-plugin@0.1.4
  - dsh-gitlab-plugin@0.1.4
  - dsh-integrations-plugin@0.1.4
  - dsh-sentry-plugin@0.1.4

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
  - dsh-atlassian-plugin@0.3.3
  - dsh-correlation-plugin@0.1.3
  - dsh-devkit-plugin@0.1.3
  - dsh-digest-plugin@0.1.3
  - dsh-figma-plugin@0.1.3
  - dsh-gitlab-plugin@0.1.3
  - dsh-integrations-plugin@0.1.3
  - dsh-sentry-plugin@0.1.3

## 0.1.2

### Patch Changes

- Minor documentation updates.
- Updated dependencies
  - dsh-atlassian-plugin@0.3.2
  - dsh-correlation-plugin@0.1.2
  - dsh-devkit-plugin@0.1.2
  - dsh-digest-plugin@0.1.2
  - dsh-figma-plugin@0.1.2
  - dsh-gitlab-plugin@0.1.2
  - dsh-integrations-plugin@0.1.2
  - dsh-sentry-plugin@0.1.2

## 0.1.1

### Patch Changes

- Initial release and publish.
- Updated dependencies
  - dsh-atlassian-plugin@0.3.1
  - dsh-correlation-plugin@0.1.1
  - dsh-devkit-plugin@0.1.1
  - dsh-digest-plugin@0.1.1
  - dsh-figma-plugin@0.1.1
  - dsh-gitlab-plugin@0.1.1
  - dsh-integrations-plugin@0.1.1
  - dsh-sentry-plugin@0.1.1
