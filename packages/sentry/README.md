# dsh-sentry-plugin

Sentry errors for DeepSeek Harness, over `mcp.sentry.dev/mcp` and the same OAuth
library the Atlassian plugin uses.

- The server's tools as ordinary harness tools — `mcp__sentry__search_issues`,
  `get_sentry_resource`, `update_issue`, and the long tail through
  `search_sentry_tools` and `execute_sentry_tool`.
- `sentry_present` shows a search or a list of issue ids with status, assignee,
  event and user counts; when it is about one issue, the suspect commit rides
  along.
- Clicking a row opens the whole issue in the right panel — the exception, the full
  stack trace, the code location, the tags — with **Resolve**, **Ignore**,
  **Reopen** and **Assign**.
- `/sentry status|login|logout|sync`.

Sentry answers its issue tools with Markdown written for a person, so the panel
reads that document rather than a JSON payload; the readers are pinned by captures
from the live server.

```yaml
- id: sentry
  config:
    endpoint: https://mcp.sentry.dev/mcp
    redirectPort: 8144
    debug: false
```
