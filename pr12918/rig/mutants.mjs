// Mutation matrix for PR #12918: one-line faithful mutants of the production
// change, each run against the PR's own focused test files.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WT = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/80e87867-940e-4bb7-881e-94ab308f1310/scratchpad/wt-head';
const P = 'packages/cli/src/acp-integration/session-approval-mode-persistence.ts';
const A = 'packages/cli/src/acp-integration/acpAgent.ts';
const S = 'packages/cli/src/acp-integration/session/Session.ts';
const C = 'packages/core/src/config/config.ts';
const R = 'packages/core/src/services/chatRecordingService.ts';
const T = 'packages/core/src/services/session-transcript-reader.ts';
const B = 'packages/acp-bridge/src/session-control-plane.ts';

const cliTests = (...f) => ({ pkg: 'packages/cli', files: f });
const coreTests = (...f) => ({ pkg: 'packages/core', files: f });
const bridgeTests = (...f) => ({ pkg: 'packages/acp-bridge', files: f });

const M = [
  { id: 'M1', desc: 'restore ignores bare/safe guard', file: P,
    from: 'if (!recorded || config.getBareMode() || config.isSafeMode()) return;', to: 'if (!recorded) return;',
    tests: [cliTests('src/acp-integration/session-approval-mode-persistence.test.ts', 'src/acp-integration/acpAgent.test.ts')] },
  { id: 'M2', desc: 'reload baseline = restored mode (not file-derived)', file: A,
    from: 'options.fileDerivedApprovalMode ?? config.getApprovalMode(),', to: 'config.getApprovalMode(),',
    tests: [cliTests('src/acp-integration/acpAgent.test.ts')] },
  { id: 'M3', desc: 'no anchor before first ordinary prompt', file: S,
    from: '} else if (!isRestoreAskUserQuestion) {\n              void recordDaemonSessionApprovalModeFromConfig(this.config);', to: '} else if (!isRestoreAskUserQuestion) {\n              void 0;',
    tests: [cliTests('src/acp-integration/session/Session.test.ts')] },
  { id: 'M4', desc: 'rewind does not re-append approval state', file: R,
    from: "      if (this.currentSessionApprovalMode) {\n        this.appendRecord({", to: "      if (false as boolean) {\n        this.appendRecord({",
    tests: [coreTests('src/services/chatRecordingService.test.ts', 'src/services/session-transcript-reader.test.ts', 'src/services/sessionService.test.ts')] },
  { id: 'M5', desc: 'reader accepts invalid approval records', file: T,
    from: '        if (isValidSessionApprovalModePayload(record.systemPayload)) {\n          sessionApprovalMode = normalizeSessionApprovalModePayload(', to: '        if (record.systemPayload) {\n          sessionApprovalMode = normalizeSessionApprovalModePayload(',
    tests: [coreTests('src/services/session-transcript-reader.test.ts', 'src/services/sessionService.test.ts')] },
  { id: 'M6', desc: 'Plan execution-mode change inside Plan not published', file: C,
    from: '      previousExecutionMode !== executionMode\n    ) {\n      this.notifyApprovalModeChangeListeners();', to: '      previousExecutionMode !== executionMode\n    ) {\n      void 0;',
    tests: [coreTests('src/config/config.test.ts'), cliTests('src/acp-integration/session/Session.test.ts')] },
  { id: 'M7', desc: 'restore exit from startup Plan queues manual-exit notice', file: C,
    from: 'options?.fromApprovedPlanExit || options?.fromSessionRestore', to: 'options?.fromApprovedPlanExit',
    tests: [coreTests('src/config/config.test.ts'), cliTests('src/acp-integration/session-approval-mode-persistence.test.ts')] },
  { id: 'M8', desc: 'derived configs publish mode changes', file: C,
    from: '  private notifyApprovalModeChangeListeners(): void {\n    if (isDerivedConfig(this)) return;', to: '  private notifyApprovalModeChangeListeners(): void {',
    tests: [coreTests('src/config/config.test.ts')] },
  { id: 'M9', desc: 'dispose keeps approval listener', file: S,
    from: '    this.unsubscribeApprovalModeChange?.();\n    this.unsubscribeApprovalModeChange = undefined;', to: '    this.unsubscribeApprovalModeChange = undefined;',
    tests: [cliTests('src/acp-integration/session/Session.test.ts')] },
  { id: 'M10', desc: 'bridge restoreState not synced on mode change', file: B,
    from: '    syncRestoreStateApprovalMode(entry, payload.next, entry.planExecutionMode);', to: '',
    tests: [bridgeTests('src/bridge.test.ts')] },
  { id: 'M11', desc: 'failed write keeps dedupe cache (no retry)', file: R,
    from: '        // A newer mode may already be queued, so only invalidate deduplication.\n        this.currentSessionApprovalMode = undefined;', to: '',
    tests: [coreTests('src/services/chatRecordingService.test.ts')] },
  { id: 'M12', desc: 'Plan restore drops the predecessor', file: P,
    from: '  const prePlanMode = recorded.prePlanMode ?? ApprovalMode.DEFAULT;\n  try {\n    config.setApprovalMode(prePlanMode, { fromSessionRestore: true });', to: '  const prePlanMode = recorded.prePlanMode ?? ApprovalMode.DEFAULT;\n  try {\n    void prePlanMode;',
    tests: [cliTests('src/acp-integration/session-approval-mode-persistence.test.ts')] },
  { id: 'M13', desc: 'Session rewind does not pass live approval state', file: S,
    from: '        survivingSnapshots,\n        {\n          mode: approvalMode,', to: '        survivingSnapshots,\n        undefined && {\n          mode: approvalMode,',
    tests: [cliTests('src/acp-integration/session/Session.test.ts')] },
  { id: 'M14', desc: 'restore applies untrusted-rejected mode without fallback (drop try/catch on non-Plan)', file: P,
    from: '  if (recorded.mode !== ApprovalMode.PLAN) {\n    try {\n      config.setApprovalMode(recorded.mode, { fromSessionRestore: true });\n    } catch (error) {\n      warnRestoreFailure(config, recorded, error);\n    }\n    return;\n  }', to: '  if (recorded.mode !== ApprovalMode.PLAN) {\n    config.setApprovalMode(recorded.mode, { fromSessionRestore: true });\n    return;\n  }',
    tests: [cliTests('src/acp-integration/session-approval-mode-persistence.test.ts')] },
];

const only = process.argv.slice(2);
const results = [];
for (const m of M) {
  if (only.length && !only.includes(m.id)) continue;
  const abs = path.join(WT, m.file);
  const orig = fs.readFileSync(abs, 'utf8');
  const count = orig.split(m.from).length - 1;
  if (count !== 1) {
    results.push({ id: m.id, desc: m.desc, status: `PATTERN_MISS(${count})` });
    console.log(m.id, 'PATTERN_MISS', count);
    continue;
  }
  fs.writeFileSync(abs, orig.replace(m.from, m.to));
  const failures = [];
  let killed = false;
  const t0 = Date.now();
  try {
    for (const t of m.tests) {
      const r = spawnSync('npx', ['vitest', 'run', ...t.files], { cwd: path.join(WT, t.pkg), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      const outp = (r.stdout || '') + (r.stderr || '');
      const summary = outp.match(/^\s+Tests\s+.*$/m)?.[0]?.trim();
      const failed = [...outp.matchAll(/^\s*(?:×|FAIL)\s+(.+)$/gm)].map((x) => x[1].trim()).slice(0, 4);
      if (r.status !== 0) {
        killed = true;
        failures.push({ pkg: t.pkg, summary, failed });
        break;
      }
    }
  } finally {
    fs.writeFileSync(abs, orig);
  }
  const res = { id: m.id, desc: m.desc, status: killed ? 'KILLED' : 'SURVIVED', secs: Math.round((Date.now() - t0) / 1000), failures };
  results.push(res);
  console.log(JSON.stringify(res));
}
const clean = execFileSync('git', ['status', '--porcelain', '--', 'packages'], { cwd: WT, encoding: 'utf8' });
console.log('worktree clean after run:', clean.trim() === '' ? 'yes' : clean);
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), `mutants-${only.join('-') || 'all'}.json`), JSON.stringify(results, null, 2));
