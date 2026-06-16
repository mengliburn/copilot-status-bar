# copilot-status-bar

A rich status line for [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/use-copilot-agents/use-copilot-cli) that shows, in a single line:

- **Context-window usage** — colored progress bar scaled to 80% of the model limit (green → yellow → orange → red 💀)
- **Current in-progress task** — pulled from the session's `todos` table (if `sqlite3` is on `PATH`)
- **Working directory** — basename of the current dir
- **Premium request count** — from `cost.total_premium_requests`
- **AI Credits (AIC)** — actual GitHub AI Credit usage for the session, read directly from the Copilot payload (`ai_used.formatted` / `ai_used.total_nano_aiu`); this is metered cost, not a token-based estimate
- **Lines added / removed** — running deltas from `cost.total_lines_added` / `total_lines_removed`
- **Remote indicator** — when controlling the session from GitHub web / mobile

Example output:

![copilot-status-bar example](./statusbar.png)

```
deploy-api │ copilot-status-bar  ██████░░░░ 58%  │ 12 req │ 12.8 AIC │ +124 -37
```

## Install

### As a plugin (recommended)

```bash
copilot
> /plugin marketplace add softienerd/copilot-status-bar
> /plugin install copilot-status-bar
```

Then run the bundled installer to wire the status line into `~/.copilot/settings.json`:

**macOS / Linux:**

```bash
bash ~/.copilot/installed-plugins/_direct/softienerd--copilot-status-bar/scripts/install.sh
```

**Windows (PowerShell):**

```powershell
pwsh -NoProfile -File "$HOME\.copilot\installed-plugins\_direct\softienerd--copilot-status-bar\scripts\install.ps1"
```

### Manual install

**macOS / Linux:**

```bash
git clone https://github.com/softienerd/copilot-status-bar.git
cd copilot-status-bar
bash scripts/install.sh
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/softienerd/copilot-status-bar.git
cd copilot-status-bar
pwsh -NoProfile -File scripts\install.ps1
```

The installer:

1. Copies `statusline/cop-statusline.js` to `~/.copilot/hooks/cop-statusline.js`
2. Adds (or updates) the `statusLine` block in `~/.copilot/settings.json`:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "~/.copilot/hooks/cop-statusline.js",
       "padding": 0
     }
   }
   ```

   On **Windows**, the installer instead writes an explicit Node invocation with
   an absolute path, because Copilot CLI runs `statusLine.command` through
   `cmd.exe` — a bare `.js` path is launched by Windows Script Host (not Node, so
   it produces no output), and `~` is not expanded by `cmd.exe`:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node \"C:/Users/<you>/.copilot/hooks/cop-statusline.js\"",
       "padding": 0
     }
   }
   ```

3. Backs up the prior settings file to `settings.json.bak`.

Restart `copilot` to see the new status line.

## Requirements

- **Node.js** ≥ 18 (the script is a single-file Node program with no dependencies)
- **`sqlite3` CLI** (optional) — used to surface the active in-progress todo from the session database. The status line works fine without it; the task segment is simply omitted.

## How it works

Copilot CLI invokes the configured `statusLine.command` after every turn and pipes a JSON status payload to its stdin. `cop-statusline.js` parses that payload and writes a single ANSI-formatted line to stdout. All errors are swallowed silently — the status line should never break the UI.

Key fields consumed:

| Field | Use |
|---|---|
| `workspace.current_dir`, `cwd` | Directory segment |
| `session_id` | Locate `~/.copilot/session-state/<id>/session.db` to read active todo |
| `context_window.current_context_used_percentage` | Context bar |
| `context_window.remaining_percentage` | Context bar fallback |
| `ai_used.formatted`, `ai_used.total_nano_aiu` | AI Credits (AIC) used |
| `cost.total_premium_requests` | Premium request counter |
| `cost.total_lines_added`, `total_lines_removed` | Code-change deltas |
| `remote.connected`, `remote.indicator` | Remote indicator |

## AI Credits (AIC)

The `AIC` segment shows cumulative **GitHub AI Credit** consumption for the
session, taken straight from the Copilot status payload — it is the actual
metered figure, not an estimate. The script prefers the CLI-provided
`ai_used.formatted` string and falls back to deriving credits from
`ai_used.total_nano_aiu` (1 AI Credit = 1,000,000,000 nano-AIU). The segment is
omitted when no credits have been spent yet (e.g. at session start).

## Uninstall

1. Remove the `statusLine` block from `~/.copilot/settings.json`
2. `rm ~/.copilot/hooks/cop-statusline.js`
3. (If installed as a plugin) `> /plugin uninstall copilot-status-bar` inside `copilot`

## License

MIT — see [LICENSE](./LICENSE).
