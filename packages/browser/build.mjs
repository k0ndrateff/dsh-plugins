/**
 * Build the host half of the plugin.
 *
 * Everything the build does — the bundle, the externals, the workspace libraries
 * resolved from source — belongs to `dsh-plugin-build`. This package has no
 * `src/client` yet, and the builder builds a host-only package as one half.
 */

import { buildPlugin } from "dsh-plugin-build";

await buildPlugin(import.meta.url);
