#!/usr/bin/env node
// copilot-status-bar — rich status line for GitHub Copilot CLI.
// Reads the Copilot status JSON payload on stdin and writes a single
// ANSI-formatted status line to stdout. Designed to be wired up via
// settings.json -> statusLine.command.
//
// Layout: [remote] [task │] directory │ context bar │ premium req │ $cost │ +added/-removed

const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = os.homedir();
const SAFE_CACHE_DIR = path.join(homeDir, '.copilot', 'cache');

function ensureDirSecure(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  } else {
    const mode = fs.statSync(dir).mode & 0o777;
    if (mode & 0o077) fs.chmodSync(dir, 0o700);
  }
}

try {
  ensureDirSecure(SAFE_CACHE_DIR);
} catch (err) {
  process.stderr.write('[cop-statusline] cache dir: ' + (err && err.message || err) + '\n');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const dir = data.workspace?.current_dir || data.cwd || process.cwd();
    const session = data.session_id || '';

    // ── Context window bar (scaled to 80% of model limit) ───────────────
    // Prefer current_context_used_percentage (live tokens / displayed limit),
    // fall back to remaining_percentage from cumulative tokens.
    let usedPct = null;
    if (typeof data.context_window?.current_context_used_percentage === 'number') {
      usedPct = data.context_window.current_context_used_percentage;
    } else if (typeof data.context_window?.remaining_percentage === 'number') {
      usedPct = 100 - data.context_window.remaining_percentage;
    }

    let ctx = '';
    if (usedPct != null) {
      const rawUsed = Math.max(0, Math.min(100, Math.round(usedPct)));
      const used = Math.min(100, Math.round((rawUsed / 80) * 100));
      const filled = Math.floor(used / 10);
      const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
      if (used < 63) {
        ctx = ` \x1b[32m${bar} ${used}%\x1b[0m`;
      } else if (used < 81) {
        ctx = ` \x1b[33m${bar} ${used}%\x1b[0m`;
      } else if (used < 95) {
        ctx = ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
      } else {
        ctx = ` \x1b[1;31m\uD83D\uDC80 ${bar} ${used}%\x1b[0m`;
      }
    }

    // ── Current task from Copilot session.db todos ──────────────────────
    let task = '';
    if (session) {
      const dbPath = path.join(homeDir, '.copilot', 'session-state', session, 'session.db');
      if (fs.existsSync(dbPath)) {
        try {
          // No sqlite3 module in stdlib — shell out via sqlite3 CLI if available.
          const { execFileSync } = require('child_process');
          const out = execFileSync('sqlite3', [
            dbPath,
            "SELECT title FROM todos WHERE status='in_progress' ORDER BY updated_at DESC LIMIT 1;"
          ], { encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          if (out) task = out;
        } catch (_) { /* sqlite3 missing or db locked — skip */ }
      }
    }

    // ── Cost / activity (Copilot's premium request + line counts) ───────
    let usage = '';
    const premium = data.cost?.total_premium_requests;
    if (typeof premium === 'number' && premium > 0) {
      usage += ` \u2502 \x1b[1;37m${premium} req\x1b[0m`;
    }

    // ── Estimated $ cost at Anthropic list prices ──────────────────────
    // Copilot is subscription-based, so this is "what these tokens WOULD
    // cost at Anthropic API list price" — useful as a relative budget
    // signal. Caveat: cumulative tokens are summed across all models used
    // this session; we apply the *currently selected* model's rate.
    // Per-MTok rates from https://www.anthropic.com/pricing
    const PRICING = {
      // [input, output, cacheRead, cacheWrite]  in $/MTok
      'claude-opus':       [15.00, 75.00, 1.50, 18.75],
      'claude-sonnet':     [ 3.00, 15.00, 0.30,  3.75],
      'claude-haiku':      [ 1.00,  5.00, 0.10,  1.25],
      // GPT pricing for completeness (per OpenAI list)
      'gpt-5':             [ 1.25, 10.00, 0.13,  0.00],
      'gpt-5-mini':        [ 0.25,  2.00, 0.03,  0.00],
    };
    function rateFor(modelId) {
      if (!modelId) return null;
      const id = String(modelId).toLowerCase();
      // Opus 1M context tier: 2x rates above 200k input tokens — approximate.
      const oneMillion = id.includes('opus') && id.includes('1m');
      const rates = id.includes('opus') ? PRICING['claude-opus']
                  : id.includes('sonnet') ? PRICING['claude-sonnet']
                  : id.includes('haiku') ? PRICING['claude-haiku']
                  : id.includes('gpt-5-mini') || id.includes('gpt-5.4-mini') ? PRICING['gpt-5-mini']
                  : id.includes('gpt-5') ? PRICING['gpt-5']
                  : null;
      if (!rates) return null;
      return oneMillion ? rates.map(r => r * 2) : rates;
    }

    const cw = data.context_window || {};
    const rates = rateFor(data.model?.id);
    if (rates) {
      const inTok    = cw.total_input_tokens       || 0;
      const outTok   = cw.total_output_tokens      || 0;
      const cacheR   = cw.total_cache_read_tokens  || 0;
      const cacheW   = cw.total_cache_write_tokens || 0;
      // Anthropic billing model:
      //   billed_input = (inTok - cacheR - cacheW) at standard input rate
      //   cacheW at cache-write rate (5-min ephemeral)
      //   cacheR at cache-read rate
      //   outTok at output rate
      const standardInput = Math.max(0, inTok - cacheR - cacheW);
      const cost =
        (standardInput / 1e6) * rates[0] +
        (outTok        / 1e6) * rates[1] +
        (cacheR        / 1e6) * rates[2] +
        (cacheW        / 1e6) * rates[3];
      if (cost > 0) {
        const fmt = cost >= 10 ? cost.toFixed(2)
                  : cost >= 1  ? cost.toFixed(2)
                  : cost >= 0.01 ? cost.toFixed(3)
                  : cost.toFixed(4);
        usage += ` \u2502 \x1b[36m$${fmt}\x1b[0m`;
      }
    }

    const added = data.cost?.total_lines_added || 0;
    const removed = data.cost?.total_lines_removed || 0;
    if (added || removed) {
      usage += ` \u2502 \x1b[32m+${added}\x1b[0m \x1b[31m-${removed}\x1b[0m`;
    }

    // ── Remote indicator ────────────────────────────────────────────────
    let remote = '';
    if (data.remote?.connected) {
      remote = ` \x1b[36m${data.remote.indicator || '\u2601'}\x1b[0m`;
    }

    // ── Output ──────────────────────────────────────────────────────────
    const dirname = path.basename(dir);
    const taskSegment = task ? `\x1b[1m${task}\x1b[0m \u2502 ` : '';
    const remotePrefix = remote ? `${remote.trim()} ` : '';
    process.stdout.write(
      `${remotePrefix}${taskSegment}\x1b[2m${dirname}\x1b[0m${ctx}${usage}`
    );
  } catch (e) {
    // Swallow errors silently — never break the UI.
  }
});
