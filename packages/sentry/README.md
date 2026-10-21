# dsh-sentry-plugin

Sentry errors inside DeepSeek Harness, over `mcp.sentry.dev/mcp` and a browser
OAuth flow.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them. Everything is
in the [market index](https://k0ndrateff.github.io/dsh-plugins/market.json) and
listed in the [collection README](https://github.com/k0ndrateff/dsh-plugins#packages).

## What you get

- The server's tools as ordinary harness tools — `mcp__sentry__search_issues`,
  `get_sentry_resource`, `update_issue`, and the long tail through
  `search_sentry_tools` and `execute_sentry_tool`.
- `sentry_present`: a search or a list of issue ids with status, assignee, event
  and user counts. When it is about one issue, the suspect commit rides along.
- A panel for the whole issue: the exception, its full stack trace, the code
  location and the tags, with **Resolve**, **Ignore**, **Reopen** and **Assign**.
- `/sentry status|login|logout|sync`.

Sentry answers its issue tools with Markdown written for a person, so the panel
reads that document rather than a JSON payload.

## Configuration

```yaml
- id: sentry
  config:
    endpoint: https://mcp.sentry.dev/mcp
    redirectPort: 8144
    debug: false
```
