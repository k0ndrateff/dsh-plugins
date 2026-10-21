# dsh-plugin-build

The build that every plugin of
**[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)** runs, so
that a plugin's own `build.mjs` is two lines.

Part of DeepSeek Harness Plugins by [@k0ndrateff](https://github.com/k0ndrateff) —
Jira, Confluence, Sentry, GitLab and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them.

**This is a library, not a plugin**, and it works from a checkout of the collection:
it resolves the sibling libraries from source, so a build never depends on build
order. It is not a general-purpose bundler.

```js
import { buildPlugin } from "dsh-plugin-build";

await buildPlugin(import.meta.url);
```

It builds the host half as an ESM bundle for Cordis and the browser half as the
classic script the Web Client's module loader expects, compiles the plugin's
vanilla-extract stylesheet and inlines it as `__DSH_STYLES__`, and leaves the
harness packages it shares with the running installation external. A package with
no `src/client` is built host-only.

Built from the package with `bun run build`, or `bun run watch`.
