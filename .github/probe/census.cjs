// Probe: report leftover Hosted temp dirs and packaged serve processes.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const tmp = os.tmpdir();
const left = fs.readdirSync(tmp).filter((n) => /^hosted-(no-tool|store)-/.test(n));
let procs = '';
try {
  procs =
    process.platform === 'win32'
      ? execSync(
          'powershell -NoProfile -Command "Get-CimInstance Win32_Process | ForEach-Object { \\"$($_.ProcessId) $($_.CommandLine)\\" }"',
        ).toString()
      : execSync('ps -axo pid,command').toString();
} catch (error) {
  procs = String(error);
}
const serve = procs
  .split(/\r?\n/)
  .filter((l) => /dist[\\/]cli\.js.*serve|hosted-harness/.test(l) && !/census\.cjs/.test(l));
console.log(
  'PROBE_JSON ' +
    JSON.stringify({ label: process.argv[2], os: process.platform, tmp, leftoverTempDirs: left, leftoverServeProcs: serve }),
);
