# dsh-correlation-plugin

One chain across the integrations you have connected, inside DeepSeek Harness: an
error, the commit behind it, the merge request that commit belongs to, and the
ticket it names.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them. Everything is
in the [market index](https://k0ndrateff.github.io/dsh-plugins/market.json) and
listed in the [collection README](https://github.com/k0ndrateff/dsh-plugins#packages).

## What you get

- The `correlate` tool: name an integration and one of its own identifiers — a
  Sentry short id or issue link, a commit sha, a merge request as `group/project!12`,
  or a tracker key such as `DEV-5977` — and it walks from there. It reads only.
- A card under the answer that shows every hop in order, and says where the chain
  stopped: "no installed integration resolves this", "GitLab refused the request
  (403)" and "nothing found" are three different lines.

It is a meta plugin: it owns no connection. Each integration answers about the
reference it was asked about and names the next ones, through a registry in
`dsh-integration-host`, so no provider knows another's identifiers.
