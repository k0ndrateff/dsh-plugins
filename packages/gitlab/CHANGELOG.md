# dsh-gitlab-plugin

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

## 0.1.3

### Patch Changes

- Fixed installation issue due to broken dependencies declaration.
- 03cfa13: Publish manifests a registry can install.
  
  `changeset publish` runs `npm publish`, and npm — unlike `bun pm pack` — uploads
  the `workspace:` protocol as it stands. Every 0.1.1 and 0.1.2 package carries it,
  which made `dsh-workflow-plugin` impossible to install and `dsh-integration-host`
  and `dsh-integration-ui` unusable as dependencies. Internal dependencies now name
  real ranges, and `bun run market --check` refuses the protocol coming back.

## 0.1.2

### Patch Changes

- Minor documentation updates.

## 0.1.1

### Patch Changes

- Initial release and publish.
