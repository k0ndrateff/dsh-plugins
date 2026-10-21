# dsh-integrations-plugin

The one Settings page every integration's connection card appears on.

It owns nothing else. It declares the page and the `integrations.tab` slot, and an
integration registers its card into it through `dsh-integration-ui`. Without this
bundle the integrations still work — their cards simply have no page to appear on.
