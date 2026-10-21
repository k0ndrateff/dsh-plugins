# dsh-integration-host

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
