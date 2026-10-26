# dsh-gitlab-plugin

Merge requests, review threads and pipelines inside DeepSeek Harness, over GitLab's
REST API with a personal access token.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them. Everything is
in the [market index](https://k0ndrateff.github.io/dsh-plugins/market.json) and
listed in the [collection README](https://github.com/k0ndrateff/dsh-plugins#packages).

Why REST and a token rather than GitLab's MCP server: that server is switched off
for a whole top-level group unless an Owner turns it on, and the tokens it issues
carry the single scope `mcp`, which no REST call accepts. A token you already have
works everywhere; it is kept in the harness credential store under
`dsh-gitlab/token`. Reads need `read_api`; the writes below need `api`.

## What you get

- `gitlab_list_merge_requests`, `gitlab_get_merge_request`, `gitlab_get_job_log`
  and `gitlab_read`: what the agent reads GitLab with. The list takes a scope, a
  project, a group, a search, labels or an author/reviewer; the one merge request
  tool returns its description and metadata and, on request, its diff, its review
  discussions and its newest pipeline with jobs; the job tool returns the end of
  a failed job's trace; `gitlab_read` answers any other REST GET — issues,
  commits, branches, repository files, users, search. Reads use the token stored
  in the harness, so the agent never runs `glab` or looks for a token on disk.
- `gitlab_present`: merge requests waiting for your review, your own, a search, one
  merge request's review findings, or its failed jobs, drawn as a card.
- A merge request panel with four sections — **Overview**, **Diff**,
  **Discussions** (filtered to unresolved or to findings, with reply and resolve)
  and **Pipeline** (jobs, and a failed job's trace on demand).
- `gitlab_review`: comment, reply in a thread, resolve or reopen one, approve or
  unapprove. Each of those changes somebody else's merge request, so the tool
  answers with the exact text it would post until the call carries `confirm`; the
  panel shows that draft with a Send button.
- `/gitlab status|login|logout|sync`.

## Configuration

```yaml
- id: gitlab
  config:
    endpoint: https://gitlab.com
    debug: false
```

`endpoint` is the instance root; calls are made under its `/api/v4`.
