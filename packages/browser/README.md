# dsh-browser-plugin

A real browser for the agent, one per session, on your machine.

While an agent works on a UI it has to check its own work: open the page it just
changed, see what is on it, click the thing it added, and read what the browser
reports. Without a browser that decision is made anew every time — sometimes
`agent-browser` through `bash`, sometimes something else, sometimes a note that
there is nothing to check with.

This plugin gives that loop one road. The tools drive the
[`agent-browser`](https://agent-browser.dev) CLI, which runs a real headless
Chrome over CDP, and every call is pinned to this conversation's own browser:
two agents working at once cannot end up driving one page.

## Requirements

- **`agent-browser`** on `PATH`:

  ```sh
  npm install -g agent-browser && agent-browser install
  ```

- **Chrome or Chromium** on the machine, which `agent-browser install` fetches.
  `/browser status` says what is missing.

The plugin does not ship a browser engine and does not wrap Playwright.

## Tools

| Tool | What it is for |
|---|---|
| `browser_open` | Open a URL in this session's browser; answers with the title and address |
| `browser_snapshot` | The accessibility tree as text, with an `@eN` reference per element — what to click |
| `browser_act` | `click`, `fill`, `press`, `select`, `hover`, `scroll`, `wait` — by reference or selector |
| `browser_read` | The page text, the console, or the errors the page threw |
| `browser_run` | Any other `agent-browser` command, for the long tail: tabs, network, cookies, audits |

`/browser status` reports whether the CLI and Chrome are usable, and
`/browser close` closes this session's browser.

## Configuration

Every field is optional, and a profile patch sets them on the row:

```yaml
- id: browser
  name: dsh-browser-plugin
  config:
    executable: agent-browser
    timeoutMs: 60000
    maxOutputBytes: 32768
    headed: false
    allowedDomains: []
```

- **`executable`** — the CLI to run, by name on `PATH` or by absolute path.
- **`timeoutMs`** — how long one command may take before it is stopped.
- **`maxOutputBytes`** — how much of one answer the model may read; anything
  longer is cut at a line boundary and says so.
- **`headed`** — show the browser window instead of running it headless.
- **`allowedDomains`** — comma-joined domain patterns the CLI itself enforces;
  the browser then also refuses CDP attach, saved profiles and state replay.

## What it does on your machine

- **One browser per session.** The session is named after the harness session,
  so the same conversation always lands on the same browser, and the shared
  `default` session — used by every other `agent-browser` caller on the machine
  — is never touched. A `bash` call that names the same session reaches the same
  browser.
- **Headless by default.** Nothing steals focus; `headed` is a configuration
  choice.
- **The browser runs outside the harness's file sandbox.** Chrome cannot start
  inside one — it dies with `Failed to initialize sandbox` before it can write
  its own profile — so the plugin starts it through the ordinary subprocess
  seam, with an argument list rather than a shell line, and never lets a URL or
  a selector be re-interpreted by a shell.
- **Nothing but the answer reaches the model.** Frames and command activity stay
  in the UI; the model reads text, references and the output it asked for.

## Not here yet

The live viewport — watching the same browser in the harness's side panel, and
taking it over by hand — is the next milestone; the design, the measurements and
the remaining plan are in
[`docs/browser.md`](../../docs/browser.md).

## Layout

```
src/host/     the plugin: config, session naming, the CLI runner, the tools, /browser
src/shared/   the tool names both halves agree on
test/         offline suites on a fake CLI, and one live dry-run
```
