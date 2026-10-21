# dsh-figma-plugin

A design frame, its variables and its Code Connect mapping inside DeepSeek Harness,
read from the **Dev Mode MCP server** the Figma desktop app serves while it runs.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them. Everything is
in the [market index](https://k0ndrateff.github.io/dsh-plugins/market.json) and
listed in the [collection README](https://github.com/k0ndrateff/dsh-plugins#packages).

There is no sign-in and no token: that server answers whoever is on the machine, so
the plugin stores no credential and its settings card reports the connection
instead of asking for one. The desktop app has to be running.

## What you get

- The server's tools as ordinary harness tools — `mcp__figma__get_design_context`,
  `get_variable_defs`, `get_screenshot`, …
- `figma_present`: name a node, a Figma link, or nothing for whatever is selected in
  the desktop app. The model reads that node's structure, variables and Code Connect
  mapping **as text**; the person sees the frame itself. A screenshot costs far more
  context than the numbers beside it, so it never enters the answer.
- A panel that opens on the node by itself when a live call settles, with
  **Frame**, **Tokens** and **Code Connect** sections. The picture comes from the
  plugin's own `/dsh-figma/screenshot` route rather than through the document.
- `/figma status|login|logout|sync`.

## Configuration

```yaml
- id: figma
  config:
    endpoint: http://127.0.0.1:3845/mcp
    debug: false
```
