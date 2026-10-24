/**
 * Build the host half of the plugin.
 *
 * Everything the build does — both bundles, the externals, the workspace
 * libraries resolved from source — belongs to `dsh-plugin-build`; this file
 * only says where the package is.
 */

import { buildPlugin } from "dsh-plugin-build";

await buildPlugin(import.meta.url);
