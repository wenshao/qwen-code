// VERIFICATION RIG ONLY (PR #13129): does a managed command Hook's recipe env reach world-readable /proc/<pid>/cmdline?
import { HookRunner } from '/work/packages/core/dist/src/hooks/hookRunner.js';
import { HookEventName, HookType } from '/work/packages/core/dist/src/hooks/types.js';
import { execFileSync } from 'node:child_process';
const SECRET = 'RIG-ARGV-SECRET-4411';
const runner = new HookRunner();
const started = Date.now();
const done = runner.executeHook(
  { type: HookType.Command, command: 'sleep 3; echo "{}"', timeout: 20000, env: { RIG_SECRET: SECRET } },
  HookEventName.Notification,
  { session_id: 's', transcript_path: '/tmp/t', cwd: '/tmp', hook_event_name: 'Notification', timestamp: new Date().toISOString(), message: 'm', notification_type: 'x' },
  undefined,
  { waitForProcessTree: true, cgroupRoot: '/sys/fs/cgroup/hooks', environment: { PATH: '/usr/bin:/bin', HOME: '/tmp' } },
);
await new Promise((r) => setTimeout(r, 1200));
// an unprivileged, different-uid local process
const launcher = execFileSync("sh", ["-c", "for p in /proc/[0-9]*; do if tr \"\\0\" \" \" < $p/cmdline 2>/dev/null | grep -q cgroup.procs; then echo ${p#/proc/}; fi; done"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const pid = launcher.find((p) => Number(p) !== process.pid);
const owner = execFileSync("stat", ["-c", "%U", `/proc/${pid}`], { encoding: "utf8" }).trim();
const nobodyCmdline = execFileSync("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", "cat", `/proc/${pid}/cmdline`]).toString("latin1").split("\0").filter((a) => a.includes("RIG_SECRET"));
let nobodyEnviron;
try { nobodyEnviron = execFileSync("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", "cat", `/proc/${pid}/environ`], { stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch (e) { nobodyEnviron = "denied: " + String(e.stderr).trim(); }
const result = await done;
console.log(JSON.stringify({ launcherPid: pid, launcherOwner: owner, readAsNobody_cmdlineArgsWithSecret: nobodyCmdline.map((a) => a.slice(a.indexOf("RIG_SECRET") - 2, a.indexOf("RIG_SECRET") + 40)), readAsNobody_environ: nobodyEnviron.slice(0, 80), hook: { success: result.success, drained: result.processTreeDrained, ms: Date.now() - started } }, null, 1));
