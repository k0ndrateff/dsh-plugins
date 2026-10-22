# dsh-browser-plugin

A real browser for the agent, one per session, on your machine — and the same
browser, live, in the harness's side panel.

While an agent works on a UI it has to check its own work: open the page it just
changed, see what is on it, click the thing it added, and read what the browser
reports. Without a browser that decision is made anew every time — sometimes
`agent-browser` through `bash`, sometimes something else, sometimes a note that
there is nothing to check with.

This plugin gives that loop one road. The tools drive the
[`agent-browser`](https://agent-browser.dev) CLI, which runs a real headless
Chrome over CDP; every call is pinned to this conversation's own browser, so two
agents working at once cannot end up driving one page; and the side panel draws
that same browser's viewport while the agent works, with the commands it runs
beside it.

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
| `browser_open` | Open a URL in this session's browser; answers with the title and address, and opens the panel on it |
| `browser_snapshot` | The accessibility tree as text, with an `@eN` reference per element — what to click |
| `browser_act` | `click`, `fill`, `press`, `select`, `hover`, `scroll`, `wait` — by reference or selector |
| `browser_read` | The page text, the console, or the errors the page threw |
| `browser_run` | Any other `agent-browser` command, for the long tail: tabs, network, cookies, audits |

`/browser status` reports whether the CLI and Chrome are usable, and
`/browser close` closes this session's browser.

## Settings

Settings → Plugins → **Browser** edits this plugin's configuration and writes it
into the profile patch: the executable, the command timeout and the answer
limit, a visible window instead of headless, a real Chrome profile to reuse, the
CLI's own domain allowlist, and the live view's quality, size and frame rate.
Nothing is written until Save, and clearing a field returns it to the default.

A browser that is already running keeps the frame shape it started with; the
rest applies to the next one. Editing the profile also works by hand — the page
writes the same `config:` block a patch would.

## The panel

`browser_open` opens a **Browser** tab in the right Sidebar, on the browser that
call just used. The tab shows:

- the page's title and address, as the browser reports them;
- the viewport as it changes, at a size meant for a panel rather than a monitor;
- what has happened to the page — each command the agent ran, how long it took,
  and your own clicks and keys in the same list;
- **back**, **forward** and **reload**, a **page size** picker (desktop, laptop,
  phone), **Open in a new tab**, and **Close browser**.

The picture is also a way in: clicking it clicks the page, the wheel scrolls it,
and typing goes to whatever field is focused. While the picture has focus its keys
belong to the page; `Escape` gives focus back. Nothing is sent while the panel is
hidden.

And the agent is told. The next browser tool result it gets starts with what you
did since its last call — a click, a key, a navigation, a new page size — plus a
warning that the refs it took earlier may be stale. Two people driving one page
is fine as long as both know.

The design and what is measured are in
[`docs/browser.md`](../../docs/browser.md).

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
    chromeProfile: ""
    allowedDomains: []
    streamQuality: 60
    streamMaxWidth: 1280
    streamMaxHeight: 800
    streamMaxFps: 8
```

- **`executable`** — the CLI to run, by name on `PATH` or by absolute path.
- **`timeoutMs`** — how long one command may take before it is stopped.
- **`maxOutputBytes`** — how much of one answer the model may read; anything
  longer is cut at a line boundary and says so.
- **`headed`** — show the browser window instead of running it headless.
- **`allowedDomains`** — comma-joined domain patterns the CLI itself enforces;
  the browser then also refuses CDP attach, saved profiles and state replay.
- **`chromeProfile`** — reuse a real Chrome profile, by name or path, so the
  browser starts signed in. Empty (the default) means the plugin's own throwaway
  profile.
- **`streamQuality`**, **`streamMaxWidth`**, **`streamMaxHeight`** — the live
  view's own scale. The defaults are the page's own size at quality 60, about
  31 KB a frame: sharp at the width the panel draws it, and paid for only while
  the page is moving.
- **`streamMaxFps`** — the most frames per second one open panel asks for.

The CLI reads these once, when a session's daemon starts, so a change takes
effect after that session's browser has been closed and opened again.

## What it does on your machine

- **One browser per session.** The session is named after the harness session, so
  the same conversation always lands on the same browser, and the shared
  `default` session — used by every other `agent-browser` caller on the machine —
  is never touched. A `bash` call that names the same session reaches the same
  browser.
- **Headless by default.** Nothing steals focus; `headed` is a configuration
  choice.
- **The browser runs outside the harness's file sandbox.** Chrome cannot start
  inside one — it dies with `Failed to initialize sandbox` before it can write
  its own profile — so the plugin starts it through the ordinary subprocess seam,
  with an argument list rather than a shell line, and never lets a URL or a
  selector be re-interpreted by a shell.
- **The panel reaches its host by an ordinary request.** The Desktop application
  serves the page from `dsh-app://`, where a `WebSocket` cannot be constructed at
  all, so the panel polls a route and draws one `<img>` — the same way every other
  panel in this suite talks to its host. Those routes, like every other `/dsh-*`
  route, are reachable by any local process: that debt is the harness's, and it
  is tracked in the roadmap.
- **Nothing but the answer reaches the model.** Frames and the command feed stay
  in the panel; the model reads text, references and the output it asked for.
- **Nothing is watched unless it is there.** Opening the panel starts no browser;
  the connection to a session's screencast opens only after a tool call has
  proved that session has one, and closes a few seconds after the last panel
  closes.

## Layout

```
src/host/     the plugin: config, session naming, the CLI runner, the tools,
              /browser, the panel's routes, the live view's hub and its socket
src/client/   the panel: the tab type, the poll, the input, the body and its styles
src/shared/   what both halves agree on: paths, the page kind, the messages
test/         offline suites on a fake CLI and a scripted screencast, one live dry-run
```
