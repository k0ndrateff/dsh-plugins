# dsh-digest-plugin

One read-only daily digest for DeepSeek Harness, assembled from whatever
integrations are installed.

It owns no provider and no credential, and it never writes to an external system.
The seam is a registry: `dsh-integration-host` declares what a digest source is,
this plugin provides `ctx.digestSources`, and Atlassian, Sentry and GitLab each
offer their blocks through a scoped `ctx.inject`. A deployment without this plugin
simply never calls them.

- Jira issues in flight and overdue, work assigned but not started, merge requests
  waiting for your review, your own, new Sentry errors, and CodeRabbit's review
  notes (off by default).
- `digest` takes no arguments: what a digest contains is saved configuration, and a
  digest that changed shape every morning would be the one thing it must not be.
- The **Daily digest** section in Settings chooses the blocks, the days, the local
  time, the zone and the row cap, and can assemble one on the spot.
- `/digest now|on|off|time|timezone|days|blocks`. A reminder belongs to the session
  `on` was typed in, because that is how the harness's scheduler stores it.
- One block failing is that block's `unavailable` line, not a failed digest.

Nothing in it is a model call. Settings live in `$DSH_HOME/digest/settings.json`
and are read forgivingly: a hand-edited typo falls back to its default.
