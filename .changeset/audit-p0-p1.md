---
"dsh-mcp-oauth": patch
"dsh-integration-host": patch
"dsh-integration-ui": patch
"dsh-atlassian-plugin": patch
"dsh-sentry-plugin": patch
"dsh-gitlab-plugin": patch
"dsh-figma-plugin": patch
"dsh-digest-plugin": patch
"dsh-devkit-plugin": patch
"dsh-browser-plugin": patch
"dsh-workflow-plugin": patch
---

Fix the P0/P1 findings from the 23.10.2026 audit: the write-route client
guard, digest clock/settings storage, the browser settings injection, OAuth
token and endpoint checks, empty search results, Atlassian MCP result parsing,
GitLab diff/pagination/auth, Figma bridge lifetime, browser isolation and
input, and a CI that runs the offline checks.
