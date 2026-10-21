# dsh-devkit-plugin

A project's own lint, typecheck, test and build commands as one tool for DeepSeek
Harness.

Recipes live in `dsh-checks.json` at the project root, so the repository owns the
command and the agent only names it:

```json
{
  "checks": {
    "typecheck": { "run": "bun run typecheck", "parse": "tsc" },
    "test":      { "run": "bun test",         "parse": "vitest" }
  }
}
```

- `checks` runs every recipe in config order; `checks test` runs one. A command
  line is never accepted — that is what `bash` is for — and an unknown name comes
  back with the ones the project has.
- One terse line per call, then a card under the answer carrying every check with
  its counts, its duration and its failures. A failure row is a `file:line` that
  opens that file in the harness's own panel.
- Parsers: `tsc`, `biome` (JSON or pretty reporter), `eslint`, `vitest`, `jest`,
  `pytest`, and `generic` — the exit code plus the tail of the output.
- `/checks` lists the recipes; `/checks init` prints a draft read from
  `package.json` without writing a file.

Nothing is written to the project, and each recipe runs through the harness's own
shell seam, so the same sandbox and environment rules as `bash` apply. A recipe
may set its own `timeoutMs`; the default is ten minutes.
