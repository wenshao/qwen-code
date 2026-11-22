#!/usr/bin/env node
// Single-point mutants of the idle-suspension path, applied to the PR head
// worktree and restored byte-for-byte. Every `find` must occur exactly once.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ARM = process.env.ARM ?? '/root/git/qwen-code-verify/tmp/pr18056-head';
const PRIS = process.env.PRISTINE ?? '/root/git/qwen-code-verify/tmp/pr18056-verify-20261122-1225/pristine';
const SESSION = 'packages/cli/src/serve/hosted-harness-session.ts';
const STATE = 'packages/cli/src/serve/hosted-session-suspension.ts';

const MUTANTS = {
  M1_admitted_reset: {
    file: SESSION,
    find: "    if (req.method !== 'GET' && req.path !== '/heartbeat')\n      noteActivity(req.params['id']);",
    replace:
      "    if (false && req.method !== 'GET' && req.path !== '/heartbeat')\n      noteActivity(req.params['id']);",
  },
  M2_no_rearm: {
    file: SESSION,
    find: '    recordSuspensionActivity(suspension, Date.now());\n    suspension.rearm?.();\n',
    replace: '    recordSuspensionActivity(suspension, Date.now());\n',
  },
  M3_no_activity_stamp: {
    file: SESSION,
    find: '    recordSuspensionActivity(suspension, Date.now());\n    suspension.rearm?.();\n',
    replace: '    suspension.rearm?.();\n',
  },
  M4_jitter_zero: {
    file: STATE,
    find: 'const JITTER_FRACTION = 0.1;',
    replace: 'const JITTER_FRACTION = 0;',
  },
  M5_no_disarm_on_arm: {
    file: STATE,
    find: '  disarmIdleSuspension(suspension);\n  if (suspension.gate !== \'open\') return;\n',
    replace: "  if (suspension.gate !== 'open') return;\n",
  },
  M6_no_freshness_guard: {
    file: SESSION,
    find: '          suspension.lastActivity > attemptStart ||\n',
    replace: '',
  },
  M7_reads_reset_too: {
    file: SESSION,
    find: "    if (req.method !== 'GET' && req.path !== '/heartbeat')\n      noteActivity(req.params['id']);",
    replace: "    if (req.path !== '/heartbeat')\n      noteActivity(req.params['id']);",
  },
  M8_no_timer: {
    file: SESSION,
    find:
      '    suspension.rearm = () =>\n      armIdleSuspension(suspension, { idleMs: idleSuspendMs, onTimeout });\n',
    replace: '    suspension.rearm = () => {};\n',
  },
};

function sha(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const [, , action, id] = process.argv;

if (action === 'snapshot') {
  for (const rel of [SESSION, STATE]) {
    const src = path.join(ARM, rel);
    const dst = path.join(PRIS, path.basename(rel));
    copyFileSync(src, dst);
    console.log(`${rel} ${sha(src)}`);
  }
} else if (action === 'apply') {
  const m = MUTANTS[id];
  if (!m) throw new Error(`unknown mutant ${id}`);
  for (const rel of [SESSION, STATE]) {
    const src = path.join(PRIS, path.basename(rel));
    if (!existsSync(src)) throw new Error(`no pristine copy for ${rel}`);
    copyFileSync(src, path.join(ARM, rel));
  }
  const target = path.join(ARM, m.file);
  let text = readFileSync(target, 'utf8');
  const count = text.split(m.find).length - 1;
  if (count !== 1) throw new Error(`${id}: find matched ${count} times`);
  text = text.replace(m.find, m.replace);
  writeFileSync(target, text);
  console.log(`applied ${id} to ${m.file} (${sha(target)})`);
} else if (action === 'restore') {
  for (const rel of [SESSION, STATE]) {
    const src = path.join(PRIS, path.basename(rel));
    copyFileSync(src, path.join(ARM, rel));
    console.log(`restored ${rel} ${sha(path.join(ARM, rel))}`);
  }
} else if (action === 'list') {
  console.log(Object.keys(MUTANTS).join('\n'));
} else {
  throw new Error('usage: mutants.mjs snapshot|apply <id>|restore|list');
}
