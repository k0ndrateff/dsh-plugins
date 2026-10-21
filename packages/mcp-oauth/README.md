# dsh-mcp-oauth

OAuth for MCP servers, and the authenticated bridge. DeepSeek Harness has
neither, so this library carries both; a plugin supplies a provider profile and a
credential-record key, and nothing else about OAuth.

- RFC 9728 protected-resource discovery and RFC 8414 authorization-server metadata
- RFC 7591 dynamic client registration, with the client-authentication method the
  server's own answer decides
- PKCE S256 over a loopback redirect, with the next free port chosen per attempt
- token lifetime across processes, refreshed under a cross-process lock
- a credential record per `scope + instance`, so two accounts of one provider live
  side by side
- a bridge that connects over MCP with a token that keeps changing, and publishes
  whatever tools the server offers as ordinary harness tools
- profiles with no OAuth facts at all, for a server on the same machine

The host half is node code; another package takes only `import type` from it.
`dsh-mcp-oauth/tool-name` is the client-safe entry, for the one rule both halves
need — how a published tool is named.

Used by `dsh-atlassian-plugin` and `dsh-sentry-plugin`.
