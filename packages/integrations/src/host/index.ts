/**
 * dsh-integrations — the Host half.
 *
 * The bundle holds no tools: its whole job is the browser half, which owns the
 * one Settings page the integration plugins contribute their cards to. This
 * module exists so the package holds a Loader row for the Client module system
 * to serve that browser half from.
 */

export const name = "dsh-integrations";

export function apply(): void {}
