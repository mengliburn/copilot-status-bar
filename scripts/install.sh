#!/usr/bin/env bash
# Install copilot-status-bar as your Copilot CLI status bar.
#
# - Copies statusbar/copilot-status-bar.js into ~/.copilot/hooks/
# - Patches ~/.copilot/settings.json to point statusLine at the script
#
# Re-runnable: it backs up settings.json to settings.json.bak before editing
# and is a no-op if the script is already wired up.

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_SRC="${PLUGIN_DIR}/statusbar/copilot-status-bar.js"
HOOKS_DIR="${HOME}/.copilot/hooks"
SETTINGS="${HOME}/.copilot/settings.json"
DEST="${HOOKS_DIR}/copilot-status-bar.js"

if [ ! -f "${SCRIPT_SRC}" ]; then
  echo "error: ${SCRIPT_SRC} not found" >&2
  exit 1
fi

mkdir -p "${HOOKS_DIR}"
install -m 0755 "${SCRIPT_SRC}" "${DEST}"
echo "installed ${DEST}"

if [ ! -f "${SETTINGS}" ]; then
  cat > "${SETTINGS}" <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "~/.copilot/hooks/copilot-status-bar.js",
    "padding": 0
  }
}
EOF
  echo "created ${SETTINGS} with statusLine configured"
  exit 0
fi

if command -v node >/dev/null 2>&1; then
  cp "${SETTINGS}" "${SETTINGS}.bak"
  node - "${SETTINGS}" <<'JS'
const fs = require('fs');
const file = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.statusLine = {
  type: 'command',
  command: '~/.copilot/hooks/copilot-status-bar.js',
  padding: 0,
};
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log('patched ' + file + ' (backup at ' + file + '.bak)');
JS
else
  echo "warning: node not found — please add this block to ${SETTINGS} manually:" >&2
  cat >&2 <<EOF
  "statusLine": {
    "type": "command",
    "command": "~/.copilot/hooks/copilot-status-bar.js",
    "padding": 0
  }
EOF
fi

echo "done. restart 'copilot' to see the new status bar."
