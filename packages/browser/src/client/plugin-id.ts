/**
 * The identity the Plugins page knows this bundle's configuration by.
 *
 * The page opens a row's configuration from a row it read out of the installed
 * bundle, and the `plugins.row.config` slot is keyed by exactly those two facts:
 * `<package name>#<row id>`. The package name keeps two bundles that both call
 * a row `browser` apart, and the row id is the one `cordis.patch.yml` inserts.
 * Both belong to the published bundle, so this client half spells them once
 * here rather than rebuilding the key at the registration site.
 */

/** The npm package this bundle is installed as. */
export const PLUGIN_NAME = "dsh-browser-plugin";

/** The row id this bundle's patch inserts. */
export const ROW_ID = "browser";

/** The key this bundle's row configuration registers under. */
export const ROW_CONFIG_KEY = `${PLUGIN_NAME}#${ROW_ID}`;
