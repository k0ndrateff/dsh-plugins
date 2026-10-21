# dsh-workflow-plugin

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
