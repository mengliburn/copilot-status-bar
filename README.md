# copilot-status-bar

A rich status line for [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/use-copilot-agents/use-copilot-cli) that shows, in a single line:

- **Context-window usage** — colored progress bar scaled to 80% of the model limit (green → yellow → orange → red 💀)
- **Current in-progress task** — pulled from the session's `todos` table (if `sqlite3` is on `PATH`)
- **Working directory** — basename of the current dir
- **Premium request count** — from `cost.total_premium_requests`
- **Estimated $ cost** — token usage × Anthropic / OpenAI list prices for the currently selected model (relative budget signal; Copilot itself is subscription-based)
- **Lines added / removed** — running deltas from `cost.total_lines_added` / `total_lines_removed`
- **Remote indicator** — when controlling the session from GitHub web / mobile

Example output:

```
deploy-api │ copilot-status-bar  ██████░░░░ 58%  │ 12 req │ $0.043 │ +124 -37
```

## Install

### As a plugin (recommended)

```bash
copilot
> /plugin marketplace add softienerd/copilot-status-bar
> /plugin install copilot-status-bar
```

Then run the bundled installer to wire the status line into `~/.copilot/settings.json`:

```bash
bash ~/.copilot/installed-plugins/_direct/softienerd--copilot-status-bar/scripts/install.sh
```

### Manual install

```bash
git clone https://github.com/softienerd/copilot-status-bar.git
cd copilot-status-bar
bash scripts/install.sh
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
| `context_window.total_input_tokens` etc. | Cost estimate |
| `model.id` | Pricing lookup |
| `cost.total_premium_requests` | Premium request counter |
| `cost.total_lines_added`, `total_lines_removed` | Code-change deltas |
| `remote.connected`, `remote.indicator` | Remote indicator |

## Cost estimate caveats

Copilot CLI is subscription-based, so the displayed `$` figure is **not** a bill. It estimates what the same token usage *would* cost at Anthropic / OpenAI list prices for the currently selected model, as a relative budget signal across sessions. Cumulative tokens are summed across all models used in the session, but the rate of the currently selected model is applied to all of them.

Pricing tables are taken from:

- <https://www.anthropic.com/pricing>
- <https://openai.com/api/pricing/>

Adjust `PRICING` in `statusline/cop-statusline.js` if either changes.

## Uninstall

1. Remove the `statusLine` block from `~/.copilot/settings.json`
2. `rm ~/.copilot/hooks/cop-statusline.js`
3. (If installed as a plugin) `> /plugin uninstall copilot-status-bar` inside `copilot`

## License

MIT — see [LICENSE](./LICENSE).
