#!/usr/bin/env node
// Regression tests for the active-subagents segment.
//
// The status bar counts subagents that are currently running by tracking
// `subagent.started` / `subagent.completed` events in the session
// `events.jsonl` transcript (matched by `toolCallId`). Crucially it must NOT
// key off the `task` tool call: for a *background* subagent the `task` tool
// call completes immediately while the subagent keeps running, so keying off
// the tool call would drop background agents from the count.
//
// These tests run the real status-bar script as a subprocess, feeding it a
// synthetic status payload on stdin that points at a temp transcript, and
// assert on the rendered output. No test framework or dependencies required:
//   node test/subagent-count.test.js

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'statusbar', 'copilot-status-bar.js');
const SCRATCH = path.join(__dirname, 'scratch-subagent-count-' + process.pid);
let renderCount = 0;
process.on('exit', () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log('  ok   - ' + name);
  } else {
    failures++;
    console.log('  FAIL - ' + name);
  }
}

function ev(type, data) {
  return JSON.stringify({ type, data });
}

// Render the status bar for a given set of transcript lines, returning stdout.
function render(lines) {
  const dir = path.join(SCRATCH, 'case-' + (++renderCount));
  fs.mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, 'events.jsonl');
  fs.writeFileSync(transcript, lines.join('\n') + '\n');
  const payload = JSON.stringify({
    session_id: 'test',
    transcript_path: dir,
    workspace: { current_dir: path.join(__dirname, '..') },
    context_window: { current_context_used_percentage: 20 },
  });
  return execFileSync('node', [SCRIPT], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, COPILOT_STATUS_BAR_NO_PERSIST: '1' },
  });
}

// 1. Background subagent: task tool completes immediately, but the subagent
//    is still running (no subagent.completed) -> must be counted.
check('background subagent still running is counted', /🤖 1 agent\b/.test(render([
  ev('tool.execution_start', { toolCallId: 't1', toolName: 'task', arguments: { name: 'bg' } }),
  ev('subagent.started', { toolCallId: 's1', agentName: 'general-purpose' }),
  ev('tool.execution_complete', { toolCallId: 't1', success: true }), // task call returns early
])));

// 2. Two started, one completed -> shows 1 (plural boundary check too).
check('one of two subagents still running -> 1 agent', /🤖 1 agent\b/.test(render([
  ev('subagent.started', { toolCallId: 's1' }),
  ev('subagent.started', { toolCallId: 's2' }),
  ev('subagent.completed', { toolCallId: 's1', durationMs: 100 }),
])));

// 3. Two running -> plural "agents".
check('two running subagents -> plural label', /🤖 2 agents\b/.test(render([
  ev('subagent.started', { toolCallId: 's1' }),
  ev('subagent.started', { toolCallId: 's2' }),
])));

// 4. All completed -> segment shows `0 agents` (never hidden).
check('all subagents completed -> 0 agents shown', /🤖 0 agents\b/.test(render([
  ev('subagent.started', { toolCallId: 's1' }),
  ev('subagent.completed', { toolCallId: 's1' }),
])));

// 5. No subagents at all -> segment shows `0 agents` (never hidden).
check('no subagents -> 0 agents shown', /🤖 0 agents\b/.test(render([
  ev('tool.execution_start', { toolCallId: 'b1', toolName: 'bash' }),
])));

// 6. Malformed / partial lines are skipped without breaking output.
check('malformed lines are tolerated', /🤖 1 agent\b/.test(render([
  '{ this is not json',
  ev('subagent.started', { toolCallId: 's1' }),
  '',
])));

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll subagent-count tests passed');
