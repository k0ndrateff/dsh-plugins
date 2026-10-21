# dsh-plugin-build

The build every plugin in this repository runs. A plugin's `build.mjs` is two
lines:

```js
import { buildPlugin } from "dsh-plugin-build";

await buildPlugin(import.meta.url);
```

It builds the host half as an ESM bundle for Cordis and the browser half as the
classic script the Web Client's module loader expects, compiles the plugin's
vanilla-extract stylesheet and inlines it as `__DSH_STYLES__`, and resolves the
sibling workspace libraries from source, so a build never depends on build order.
A package with no `src/client` is built host-only.

Two of its own checks read this repository instead: a package importing a `dsh-*`
specifier the build cannot alias, and a plugin that went back to a stylesheet
placeholder of its own, both fail before a build runs.

Built from the package with `bun run build`, or `bun run watch`.
