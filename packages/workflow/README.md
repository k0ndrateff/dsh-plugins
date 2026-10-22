# dsh-workflow-plugin

Every plugin of the collection in one install: Jira and Confluence, Sentry, GitLab,
Figma, a daily digest across them, a correlation that follows an error to the
commit, the merge request and the ticket behind it, the Integrations settings page,
and the project-checks tool, and a real browser for UI checks — all inside DeepSeek Harness.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them. Everything is
in the [market index](https://k0ndrateff.github.io/dsh-plugins/market.json) and
listed in the [collection README](https://github.com/k0ndrateff/dsh-plugins#packages).

## What it installs

| Package | What it gives you |
|---|---|
| `dsh-atlassian-plugin` | Jira and Confluence tools, cards, and the issue panel |
| `dsh-sentry-plugin` | Sentry errors, their panel, and resolve / ignore / assign |
| `dsh-gitlab-plugin` | Merge requests, review threads and pipelines |
| `dsh-figma-plugin` | A frame, its tokens and Code Connect, from the local Dev Mode server |
| `dsh-digest-plugin` | One read-only daily digest of the above |
| `dsh-correlation-plugin` | Error → commit → merge request → ticket |
| `dsh-integrations-plugin` | The one Settings page the connection cards appear on |
| `dsh-devkit-plugin` | The project's own lint, typecheck, test and build recipes |
| `dsh-browser-plugin` | A real Chrome the agent drives to check UI work, live in the side panel |

The package contains no code itself: it depends on those nine and its patch mounts
a row for each, and their own defaults fill in the configuration their own patches
would have written. A profile with this bundle alone therefore behaves exactly like
one with all nine.

Install it **instead of** the individual plugins, not beside them — two profile
layers inserting a row with the same id is a duplicate the loader refuses. To drop
one of them, override its row in the profile patch:

```yaml
- id: figma
  disabled: true
```
