# dsh-digest-plugin

One read-only daily digest inside DeepSeek Harness, assembled from whichever
integrations are installed — Jira issues in flight and overdue, work assigned but
not started, merge requests waiting for your review, new Sentry errors, and review
comments.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them. Everything is
in the [market index](https://k0ndrateff.github.io/dsh-plugins/market.json) and
listed in the [collection README](https://github.com/k0ndrateff/dsh-plugins#packages).

This plugin owns no provider and no credential, and it never writes to an external
system. It asks the installed integrations for their work through a registry, and a
block that fails is that block's `unavailable` line rather than a failed digest.

## What you get

- The `digest` tool, which takes no arguments: what a digest contains is saved
  configuration, because a digest that changed shape every morning would be the one
  thing it must not be.
- A **Daily digest** section in Settings — the blocks, the days, the local time,
  the zone and the row cap, plus a button that assembles one on the spot.
- `/digest now|on|off|time|timezone|days|blocks`. `on` binds a reminder to the
  session it is typed in, because that is how the harness's scheduler stores one.
- Nothing in it is a model call: the collector reads the providers.

Settings live in `$DSH_HOME/digest/settings.json` and are read forgivingly — a
hand-edited typo falls back to its default.
