---
"dsh-atlassian-plugin": patch
"dsh-correlation-plugin": patch
"dsh-devkit-plugin": patch
"dsh-digest-plugin": patch
"dsh-figma-plugin": patch
"dsh-gitlab-plugin": patch
"dsh-integration-host": patch
"dsh-integration-ui": patch
"dsh-integrations-plugin": patch
"dsh-mcp-oauth": patch
"dsh-plugin-build": patch
"dsh-sentry-plugin": patch
"dsh-workflow-plugin": patch
---

Publish manifests a registry can install.

`changeset publish` runs `npm publish`, and npm — unlike `bun pm pack` — uploads
the `workspace:` protocol as it stands. Every 0.1.1 and 0.1.2 package carries it,
which made `dsh-workflow-plugin` impossible to install and `dsh-integration-host`
and `dsh-integration-ui` unusable as dependencies. Internal dependencies now name
real ranges, and `bun run market --check` refuses the protocol coming back.
