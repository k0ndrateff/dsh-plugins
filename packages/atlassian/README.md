# dsh-atlassian-plugin

Jira and Confluence inside DeepSeek Harness, over Atlassian's remote MCP server,
signed in through a browser.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them. Everything is
in the [market index](https://k0ndrateff.github.io/dsh-plugins/market.json) and
listed in the [collection README](https://github.com/k0ndrateff/dsh-plugins#packages).

## What you get

- The server's tools as ordinary harness tools — `mcp__atlassian__searchJiraIssuesUsingJql`,
  `getJiraIssue`, `createJiraIssue`, `searchConfluenceUsingCql`, `getConfluencePage` —
  with the normal permission, approval and cancellation pipeline.
- `atlassian_present`: one issue, a shortlist, or Confluence pages as a card under
  the agent's answer.
- A panel for the whole issue: description, comments, its transitions, and a
  different assignee.
- `/atlassian status|login|logout|sync`, and one tab on the Settings
  **Integrations** page.

## Configuration

The bundle inserts one row; override it in the profile's `cordis.patch.yml`:

```yaml
- id: atlassian
  config:
    endpoint: https://mcp.atlassian.com/v1/mcp
    redirectPort: 8143
    debug: false
```

`redirectPort` is the first loopback port tried for the OAuth callback; the next
free port is used if it is taken. `debug` logs the raw payload of every tool result.
