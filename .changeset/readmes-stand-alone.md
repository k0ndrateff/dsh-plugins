---
"dsh-atlassian-plugin": patch
"dsh-correlation-plugin": patch
"dsh-devkit-plugin": patch
"dsh-digest-plugin": patch
"dsh-figma-plugin": patch
"dsh-gitlab-plugin": patch
"dsh-integration-host": patch
"dsh-integration-ui": patch
"dsh-integrations-plugin": patch
"dsh-mcp-oauth": patch
"dsh-plugin-build": patch
"dsh-sentry-plugin": patch
"dsh-workflow-plugin": patch
---

Readmes and descriptions that stand on their own.

A package page on npm has to explain itself to somebody who has never heard of the
other twelve. Each README now opens with what the package is, says which collection
it belongs to and links it, and then describes what it adds; the four libraries say
plainly that they are libraries, so nobody installs one expecting a plugin.
`dsh-workflow-plugin` lists the eight packages it mounts and what each gives you,
which is the question its page was failing to answer.

Descriptions were brought in line at the same time. GitLab's still promised OAuth
and the MCP server — it has been a personal access token over REST since the
transport changed — and three packages described themselves in terms of "this
repository".
