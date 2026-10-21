/**
 * Build both halves of the plugin.
 *
 * Everything the build does — the two bundles, the inlined stylesheet, the
 * workspace libraries resolved from source — belongs to `dsh-plugin-build`. What
 * stays here is the one thing that is this package's: where it is.
 */

import { buildPlugin } from "dsh-plugin-build";

await buildPlugin(import.meta.url);
