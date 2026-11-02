# dsh-integration-host

The host-half shell that the integration plugins of
**[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)** share:
normalizing the endpoint patch, holding the sign-in state, answering a settings
route, and running a slash command.

Part of DeepSeek Harness Plugins by [@k0ndrateff](https://github.com/k0ndrateff) —
Jira, Confluence, Sentry, GitLab and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus project
checks built on top of them.

**This is a library, not a plugin.** It exists so a provider plugin writes only
what is its own; nothing appears in the app by installing it, and it is already
bundled into every plugin that uses it.

## Entries

| Entry | What it is |
|---|---|
| `dsh-integration-host` | all of the above, as node code |
| `dsh-integration-host/status` | the status document a browser half reads |

The separate entries exist because a browser half must not pull node code into its
program: it reads a contract, which is client-safe on its own.

Used by the Atlassian, Sentry, GitLab, Figma and devkit plugins.
