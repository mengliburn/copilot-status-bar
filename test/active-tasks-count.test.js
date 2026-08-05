#!/usr/bin/env node
// Regression tests for the active-tasks segment.
//
// The status bar counts open todos in the Copilot session database:
//   status IN ('pending','in_progress')
// The segment is always rendered, including when the db is missing or the
// count is zero. No test framework or dependencies required:
//   node test/active-tasks-count.test.js

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'statusbar', 'copilot-status-bar.js');
const SCRATCH = path.join(__dirname, 'scratch-active-tasks-' + process.pid);

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log('  ok   - ' + name);
  } else {
    failures++;
    console.log('  FAIL - ' + name);
  }
}

function hasSqlite3() {
  try {
    execFileSync('sqlite3', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (_) {
    return false;
  }
}

function render(home, sessionId) {
  const payload = JSON.stringify({
    session_id: sessionId,
    workspace: { current_dir: path.join(__dirname, '..') },
    context_window: { current_context_used_percentage: 20 },
  });
  return execFileSync('node', [SCRIPT], {
    input: payload,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      COPILOT_STATUS_BAR_NO_PERSIST: '1',
    },
  });
}

function createDb(home, sessionId, rows) {
  const sessionDir = path.join(home, '.copilot', 'session-state', sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const db = path.join(sessionDir, 'session.db');
  const values = rows
    .map((status, i) => `('todo ${i + 1}','${status}','2026-01-01T00:00:0${i}Z')`)
    .join(',');
  execFileSync('sqlite3', [
    db,
    `CREATE TABLE todos (title TEXT, status TEXT, updated_at TEXT); INSERT INTO todos VALUES ${values};`
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

try {
  fs.mkdirSync(SCRATCH, { recursive: true });

  const missingHome = path.join(SCRATCH, 'missing-home');
  fs.mkdirSync(missingHome, { recursive: true });
  const missingDbOutput = render(missingHome, 'missing-db');
  check('missing db -> 0 tasks shown', /📋 0 tasks\b/.test(missingDbOutput));
  check('task count uses cyan activity color', /\x1b\[36m📋 0 tasks\x1b\[0m/.test(missingDbOutput));

  if (hasSqlite3()) {
    const zeroHome = path.join(SCRATCH, 'zero-home');
    createDb(zeroHome, 'zero-active', ['done', 'blocked']);
    check('db with no open todos -> 0 tasks shown', /📋 0 tasks\b/.test(render(zeroHome, 'zero-active')));

    const oneHome = path.join(SCRATCH, 'one-home');
    createDb(oneHome, 'one-active', ['in_progress', 'done']);
    const oneOut = render(oneHome, 'one-active');
    check('one active todo -> singular task label', /📋 1 task\b/.test(oneOut));
    // The combined single-sqlite3 read must still surface the in-progress title.
    check('one active todo -> in-progress title rendered', oneOut.includes('todo 1'));

    const manyHome = path.join(SCRATCH, 'many-home');
    createDb(manyHome, 'many-active', ['pending', 'in_progress', 'done', 'blocked']);
    const manyOut = render(manyHome, 'many-active');
    check('pending plus in-progress todos -> plural tasks label', /📋 2 tasks\b/.test(manyOut));
    // Title comes from the in-progress row (todo 2), not the pending one.
    check('title reflects in-progress row alongside plural count', manyOut.includes('todo 2'));
  } else {
    console.log('  skip - sqlite3 unavailable; nonzero active task checks skipped');
  }
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll active-tasks-count tests passed');
