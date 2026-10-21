# dsh-devkit-plugin

A project's own lint, typecheck, test and build commands as one tool inside DeepSeek
Harness, so the agent names a recipe instead of filling the conversation with shell
output.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them. Everything is
in the [market index](https://k0ndrateff.github.io/dsh-plugins/market.json) and
listed in the [collection README](https://github.com/k0ndrateff/dsh-plugins#packages).

The recipes belong to the project, not to the agent: they live in `dsh-checks.json`
at the project root, and the tool never accepts a command line.

```json
{
  "checks": {
    "typecheck": { "run": "bun run typecheck", "parse": "tsc" },
    "test":      { "run": "bun test",         "parse": "vitest" }
  }
}
```

## What you get

- `checks` runs every recipe in config order; `checks test` runs one. An unknown
  name comes back with the ones the project has.
- One terse line per call, then a card under the answer carrying every check with
  its counts, its duration and its failures. A failure row is a `file:line` that
  opens that file in the harness's own panel.
- Parsers: `tsc`, `biome` (JSON or pretty reporter), `eslint`, `vitest`, `jest`,
  `pytest`, and `generic` — the exit code plus the tail of the output.
- `/checks` lists the recipes; `/checks init` prints a draft read from
  `package.json` without writing a file.

Nothing is written to the project, and each recipe runs through the harness's own
shell seam, so the same sandbox and environment rules as `bash` apply. A recipe may
set its own `timeoutMs`; the default is ten minutes.
