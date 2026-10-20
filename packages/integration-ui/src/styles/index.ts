/**
 * The shared stylesheet and its theme contract, as one entry.
 *
 * A plugin's own `styles.css.ts` re-exports this module, so its components
 * import every class — shared and provider-specific — from one place, and the
 * CSS-collection pass that bundles the plugin's stylesheet pulls these rules in
 * with them.
 */

export * from "./styles.css";
export { theme } from "./theme.css";
