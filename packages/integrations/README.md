# dsh-integrations-plugin

One **Integrations** page in DeepSeek Harness Settings, where every integration's
sign-in and connection card appears — instead of one navigation entry per
integration.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them. Everything is
in the [market index](https://k0ndrateff.github.io/dsh-plugins/market.json) and
listed in the [collection README](https://github.com/k0ndrateff/dsh-plugins#packages).

It owns nothing else: it declares the page and the tab slot, and an integration
registers its card into it. Without this bundle the integrations still work — their
cards simply have no page to appear on.
