# dsh-atlassian-plugin

Jira and Confluence for DeepSeek Harness, over Atlassian's remote MCP server,
signed in through a browser OAuth flow.

- The server's tools as ordinary harness tools — `mcp__atlassian__searchJiraIssuesUsingJql`,
  `getJiraIssue`, `createJiraIssue`, `searchConfluenceUsingCql`, `getConfluencePage` —
  with the normal permission, approval and cancellation pipeline.
- `atlassian_present` shows one issue, a shortlist or a set of Confluence pages as
  a card under the answer.
- Clicking a row opens the issue in the harness's own right panel, where its status
  can be moved through the transitions the workflow offers and it can be handed to
  somebody else.
- `/atlassian status|login|logout|sync`, and one tab on the Settings
  **Integrations** page.

Configuration, overriding the row the bundle's patch inserts:

```yaml
- id: atlassian
  config:
    endpoint: https://mcp.atlassian.com/v1/mcp
    redirectPort: 8143
    debug: false
```

`redirectPort` is the first loopback port tried for the OAuth callback. `debug`
logs the raw payload of every tool result.
