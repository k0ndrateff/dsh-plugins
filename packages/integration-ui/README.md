# dsh-integration-ui

The browser-half shell that the integration plugins of
**[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)** share: the
side-panel body that loads, fails, retries and writes one thing at a time, the
result card under the answer, the terse tool row, the settings card, and the
stylesheet they are drawn with.

Part of DeepSeek Harness Plugins by [@k0ndrateff](https://github.com/k0ndrateff) —
Jira, Confluence, Sentry, GitLab and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them.

**This is a library, not a plugin.** It exists so a provider plugin supplies only
its payload, its drawing rules and its own tab kind; nothing appears in the app by
installing it, and it is already bundled into every plugin that uses it.

`dsh-integration-ui/styles` is the shared stylesheet and its theme contract; a
plugin's own `styles.css.ts` re-exports it, so its components import every class —
shared and its own — from one place. vanilla-extract compiles each `*.css.ts` with
its own esbuild run and forwards no `alias`, which is why the build hands its
workspace resolver into `esbuildOptions.plugins`.

A plugin still registers each seat itself, under its own tab kind and its own tool
names: a kind is what `openTab` names and what the Sidebar keys a panel body by.
