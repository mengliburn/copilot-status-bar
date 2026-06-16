#!/usr/bin/env node
// copilot-status-bar — rich status line for GitHub Copilot CLI.
// Reads the Copilot status JSON payload on stdin and writes a single
// ANSI-formatted status line to stdout. Designed to be wired up via
// settings.json -> statusLine.command.
//
// Layout: [remote] [task │] directory │ context bar │ premium req │ AIC │ +added/-removed

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
  process.stderr.write('[copilot-status-bar] cache dir: ' + (err && err.message || err) + '\n');
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
    let contextUsedPct = null;   // real usage %, clamped 0–100
    let contextBarPct = null;    // value shown on the bar (scaled to 80%)
    if (usedPct != null) {
      const rawUsed = Math.max(0, Math.min(100, Math.round(usedPct)));
      const used = Math.min(100, Math.round((rawUsed / 80) * 100));
      contextUsedPct = rawUsed;
      contextBarPct = used;
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

    // ── AI Credits (AIC) consumed this session ─────────────────────────
    // Copilot CLI reports cumulative GitHub AI Credit usage directly in the
    // status payload under `ai_used`, so this is the *actual* metered cost —
    // not a token-based estimate. 1 AI Credit = 1e9 nano-AIU. Prefer the
    // preformatted string the CLI provides; fall back to computing from
    // `total_nano_aiu` if only the raw value is present.
    const NANO_PER_AIC = 1e9;
    const aiUsed = data.ai_used || {};
    let aicText = null;
    if (typeof aiUsed.formatted === 'string' && aiUsed.formatted.trim() !== '') {
      aicText = aiUsed.formatted.trim();
    } else if (typeof aiUsed.total_nano_aiu === 'number' && Number.isFinite(aiUsed.total_nano_aiu)) {
      const credits = Math.max(0, aiUsed.total_nano_aiu) / NANO_PER_AIC;
      aicText = credits >= 10 ? credits.toFixed(1).replace(/\.0$/, '')
              : credits >= 1  ? credits.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
              :                 credits.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    }
    // Always show the AIC segment — including at session start when usage is
    // still 0 — so the credit meter is consistently visible. Fall back to '0'
    // when the payload carries no ai_used value yet.
    if (aicText === null) aicText = '0';
    usage += ` \u2502 \x1b[36m${aicText} AIC\x1b[0m`;

    // Numeric AIC for machine consumers: prefer the raw nano value, else parse
    // whatever text we are displaying.
    let aicCredits = null;
    if (typeof aiUsed.total_nano_aiu === 'number' && Number.isFinite(aiUsed.total_nano_aiu)) {
      aicCredits = Math.max(0, aiUsed.total_nano_aiu) / NANO_PER_AIC;
    } else {
      const parsed = parseFloat(aicText);
      if (Number.isFinite(parsed)) aicCredits = parsed;
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

    // ── Status persistence for third-party tools ────────────────────────
    // On by default: each turn we atomically write a JSON snapshot of the
    // latest status to ~/.copilot/cache — normalized fields, the raw Copilot
    // payload, and a timestamp. To avoid concurrent sessions clobbering each
    // other, each session writes its own `statusline-<session_id>.json`, plus a
    // shared `statusline-latest.json` (last-writer-wins convenience pointer).
    // Set COP_STATUSLINE_NO_PERSIST (to any value other than 0/false/no/off) to
    // disable. Failures never affect the UI.
    const noPersist = /^(?!\s*(0|false|no|off)\s*$).+/i.test(
      process.env.COP_STATUSLINE_NO_PERSIST || ''
    );
    if (!noPersist) {
      try {
        const snapshot = {
          timestamp: new Date().toISOString(),
          session_id: session || null,
          fields: {
            dir,
            dir_name: path.basename(dir),
            task: task || null,
            context_used_percentage: contextUsedPct,
            context_bar_percentage: contextBarPct,
            aic_text: aicText,
            aic_credits: aicCredits,
            premium_requests: typeof premium === 'number' ? premium : null,
            lines_added: added,
            lines_removed: removed,
            remote: {
              connected: !!data.remote?.connected,
              indicator: data.remote?.indicator || null,
            },
          },
          raw: data,
        };
        const json = JSON.stringify(snapshot, null, 2);
        // Sanitize the session id so it can't escape the cache dir.
        const safeId = session ? String(session).replace(/[^A-Za-z0-9._-]/g, '_') : '';
        const targets = [path.join(SAFE_CACHE_DIR, 'statusline-latest.json')];
        if (safeId) targets.push(path.join(SAFE_CACHE_DIR, `statusline-${safeId}.json`));
        for (const outFile of targets) {
          const tmp = outFile + '.tmp-' + process.pid;
          fs.writeFileSync(tmp, json, { mode: 0o600 });
          fs.renameSync(tmp, outFile);
        }
      } catch (_) { /* persistence is best-effort — never break the UI */ }
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
