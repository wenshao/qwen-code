// Shared Windows process-accounting helper for the PR 11643 probes.
import { execFileSync } from 'node:child_process';

const PS_SCRIPT = `@(Get-CimInstance Win32_Process -Filter "Name='conhost.exe' or Name='OpenConsole.exe'") |
  Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize |
  ConvertTo-Json -Compress -Depth 3`;

/** Every conhost.exe / OpenConsole.exe on the box, with parent + RSS. */
export function listHosts() {
  // POSIX has no ConPTY host to count; the harness still runs there for the
  // emulated-win32 lane, where only the query/scrollback assertions matter.
  if (process.platform !== 'win32') return [];
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Hosts parented to this node process — the ones a PTY spawn created. */
export function ourHosts(pid = process.pid) {
  return listHosts().filter((p) => p.ParentProcessId === pid);
}

export function summarize(hosts) {
  const headless = hosts.filter(
    (h) => h.Name === 'conhost.exe' && /--headless/i.test(h.CommandLine ?? ''),
  );
  const openConsole = hosts.filter((h) => h.Name === 'OpenConsole.exe');
  const bytes = hosts.reduce((n, h) => n + (h.WorkingSetSize ?? 0), 0);
  return {
    total: hosts.length,
    conhostHeadless: headless.length,
    openConsole: openConsole.length,
    workingSetMB: +(bytes / 1024 / 1024).toFixed(1),
    pids: hosts.map((h) => `${h.Name}:${h.ProcessId}`),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
