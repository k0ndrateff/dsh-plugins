# dsh-figma-plugin

A frame, its variables and its Code Connect mapping for DeepSeek Harness, from the
**Dev Mode MCP server** the Figma desktop app serves while it runs.

There is no sign-in and no token: that server answers whoever is on the machine,
so the plugin stores no credential and its settings card reports the connection
instead of asking for one.

- The server's tools as ordinary harness tools — `mcp__figma__get_design_context`,
  `get_variable_defs`, `get_screenshot`, …
- `figma_present` names a node, a Figma link, or nothing for whatever is selected
  in the desktop app. The model reads that node's structure, variables and Code
  Connect mapping **as text**; the person sees the frame itself. A screenshot costs
  far more context than the numbers beside it, so it never enters the answer.
- The panel opens on the node by itself when a live call settles, with three
  sections: **Frame**, **Tokens** and **Code Connect**. The picture comes from the
  plugin's own `/dsh-figma/screenshot` route rather than through the document.
- `/figma status|login|logout|sync`.

```yaml
- id: figma
  config:
    endpoint: http://127.0.0.1:3845/mcp
    debug: false
```
