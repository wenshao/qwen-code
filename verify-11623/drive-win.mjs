// Real-Windows E2E for PR #11623: drives the BUILT core HookRunner on a real
// windows-latest runner, with a shim taskkill.exe that forwards to the real
// System32 taskkill and can inject ERROR_ACCESS_DENIED.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const CORE_DIST = process.env.CORE_DIST;
const SCENARIO = process.env.SCENARIO;
// Node itself must start with the real %SystemRoot% (its CSPRNG init aborts
// otherwise), so the shim is swapped in only while hookRunner.js is being
// loaded: WINDOWS_TASKKILL is a module-load-time constant. Restoring it before
// anything is spawned keeps every child process on the real System32.
const REAL_SYSTEMROOT = process.env.SystemRoot;
const FAKE_SYSTEMROOT = process.env.FAKE_WIN_ROOT;
process.env.SystemRoot = FAKE_SYSTEMROOT;
const { HookRunner } = await import(pathToFileURL(join(CORE_DIST, 'src/hooks/hookRunner.js')).href);
const { HookEventName, HookType } = await import(pathToFileURL(join(CORE_DIST, 'src/hooks/types.js')).href);
process.env.SystemRoot = REAL_SYSTEMROOT;

// Keep the real SystemRoot for helper processes: only the core under test is
// pointed at the shim.
const psEnv = { ...process.env };
const ps = (cmd) => {
  try {
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', env: psEnv }).trim();
  } catch { return ''; }
};
const snapshot = () => {
  const raw = ps(`Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress`);
  try {
    const rows = JSON.parse(raw);
    return new Map((Array.isArray(rows) ? rows : [rows]).map((r) => [r.ProcessId, r]));
  } catch { return new Map(); }
};
const childrenOf = (snap, pid, name) =>
  [...snap.values()].filter((r) => r.ParentProcessId === pid && (!name || r.Name.toLowerCase() === name)).map((r) => r.ProcessId);
const label = (snap, pid) => (snap.get(pid)?.Name ?? '(gone)');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

log(`platform seen by built core : ${process.platform}   *** REAL WINDOWS ***`);
log(`os                          : ${ps('(Get-CimInstance Win32_OperatingSystem).Caption')}`);
log(`node                        : ${process.version}`);
log(`ComSpec                     : ${process.env.ComSpec}`);
log(`taskkill resolved by core   : ${FAKE_SYSTEMROOT}\\System32\\taskkill.exe`);
log(`                              (shim: logs + forwards to C:\\Windows\\System32\\taskkill.exe)`);
log(`scenario                    : ${SCENARIO}`);
log(`hook event                  : StopFailure  (survives parent exit)`);

const runner = new HookRunner();
const controller = new AbortController();
const hookConfig = {
  type: HookType.Command,
  command: `start /b ping -n 600 127.0.0.1 > nul & ping -n 600 127.0.0.1 > nul`,
  timeout: 180000,
};
const input = { session_id: 'e2e-11623', transcript_path: 'NUL', cwd: process.cwd(), hook_event_name: HookEventName.StopFailure };

const t0 = Date.now();
const resultPromise = runner.executeHook(hookConfig, HookEventName.StopFailure, input, controller.signal);
let settledAt = 0;
resultPromise.then(() => { settledAt = Date.now(); });

let snap = new Map(), supervisor, shell, pings = [];
while (Date.now() - t0 < 60000) {
  snap = snapshot();
  supervisor = childrenOf(snap, process.pid, 'node.exe')[0];
  shell = supervisor ? childrenOf(snap, supervisor, 'cmd.exe')[0] : undefined;
  pings = shell ? childrenOf(snap, shell).filter((p) => label(snap, p).toLowerCase() !== 'conhost.exe') : [];
  if (pings.length >= 2) break;
  await wait(250);
}
log(`\nhook process tree is live after ${Date.now() - t0}ms:`);
log(`  qwen parent (this driver)  pid ${process.pid}  [${label(snap, process.pid)}]`);
log(`  \\- detached supervisor     pid ${supervisor}  [${label(snap, supervisor)}]`);
log(`     \\- hook shell           pid ${shell}  [${label(snap, shell)}]   <- the leftover cmd.exe of #11303`);
for (const p of pings) log(`        \\- hook child          pid ${p}  [${label(snap, p)}]`);

if (SCENARIO === 'supervisor-gone') {
  ps(`Stop-Process -Id ${supervisor} -Force`);
  await wait(500);
  log(`\n[injected fault] detached supervisor ${supervisor} force-killed before cancel -> now ${label(snapshot(), supervisor)}`);
} else if (SCENARIO === 'deny-all') {
  log(`\n[injected fault] shim taskkill.exe answers ERROR_ACCESS_DENIED for EVERY pid (locked-down System32 / AV interception)`);
} else if (SCENARIO === 'denied') {
  log(`\n[injected fault] shim taskkill.exe answers ERROR_ACCESS_DENIED for the supervisor (node.exe); every other pid reaches the real taskkill`);
} else {
  log(`\n[injected fault] none - the shim forwards every call to the real taskkill.exe (happy path)`);
}

log(`\n--- cancel: AbortController.abort() ---`);
const abortAt = Date.now();
controller.abort();
const result = await resultPromise;
log(`executeHook resolved        : success=${result.success}  error="${result.error?.message}"`);
if (settledAt && settledAt < abortAt) {
  log(`settled BEFORE the cancel (${abortAt - settledAt}ms earlier) -> the abort handler is already detached, the reap never runs`);
}

await wait(2500);
const after = snapshot();
const survivors = [shell, ...pings].filter((p) => after.has(p));
log(`\nafter cancellation:`);
log(`  hook shell  ${shell} (cmd.exe)  : ${after.has(shell) ? 'STILL RUNNING' : 'reaped'}`);
for (const p of pings) log(`  hook child  ${p} (${label(snap, p)}) : ${after.has(p) ? 'STILL RUNNING' : 'reaped'}`);
log(`\nVERDICT : ${survivors.length ? `LEAKED (${survivors.length} orphaned process(es): ${survivors.join(', ')})` : 'REAPED (no orphaned hook processes)'}`);
log(`\n--- shim taskkill.exe invocation log ---`);
log(ps(`if (Test-Path "$env:TASKKILL_LOG") { Get-Content "$env:TASKKILL_LOG" } else { '(taskkill was never invoked)' }`) || '(taskkill was never invoked)');
for (const p of survivors) ps(`Stop-Process -Id ${p} -Force`);
process.exit(0);
