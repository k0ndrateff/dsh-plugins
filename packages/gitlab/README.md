# dsh-gitlab-plugin

Merge requests, review threads and pipelines for DeepSeek Harness, over GitLab's
REST API with a personal access token.

Not MCP, and that is a measured fact rather than a preference: GitLab's MCP
endpoint is switched off for a whole top-level group unless an Owner turns it on,
and the tokens it issues carry the single scope `mcp`, which no REST call accepts.
The token is kept in the harness credential store under `dsh-gitlab/token`.

- `gitlab_present` shows merge requests waiting for your review, your own, a
  search, one merge request's review findings, or its failed jobs.
- The merge request panel has four sections: **Overview**, **Diff**,
  **Discussions** (filtered to unresolved or to findings, with reply and resolve)
  and **Pipeline** (jobs, and a failed job's trace on demand).
- `gitlab_review` comments, replies in a thread, resolves or reopens one, and
  approves or unapproves. Each of those changes somebody else's merge request, so
  the tool answers with the exact text it would post until the call carries
  `confirm`; the panel shows that draft with a Send button.
- `/gitlab status|login|logout|sync`.

```yaml
- id: gitlab
  config:
    endpoint: https://gitlab.com
    debug: false
```

Reads need `read_api`; the writes need `api`.
