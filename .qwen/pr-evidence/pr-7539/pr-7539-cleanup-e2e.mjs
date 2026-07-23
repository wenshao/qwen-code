/**
 * E2E test: Verify orphaned managed npm update artifact cleanup on macOS.
 *
 * This script exercises the REAL cleanup logic (no mocks) by:
 * 1. Creating a managed-update launcher root with various artifacts
 * 2. Spawning a short-lived child process to get a real dead PID
 * 3. Calling prepareManagedNpmUpdate to trigger cleanup
 * 4. Verifying stale artifacts are removed and live/unknown artifacts are retained
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const worktree = '/Users/wenshao/git/qwen-code/.qwen/worktrees/swift-owl-589abd';

// Import the built module
const { prepareManagedNpmUpdate } = await import(
  path.join(worktree, 'packages/cli/dist/src/utils/managed-npm-update.js')
);

// --- Setup ---
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-e2e-cleanup-'));
console.log(`\n📁 Test root: ${tmpRoot}\n`);

// Create a fake base installation
const globalRoot = path.join(tmpRoot, 'global');
const packageRoot = path.join(globalRoot, 'node_modules', '@qwen-code', 'qwen-code');
fs.mkdirSync(packageRoot, { recursive: true });
fs.writeFileSync(
  path.join(packageRoot, 'package.json'),
  JSON.stringify({ name: '@qwen-code/qwen-code', version: '1.0.0' }),
);
const bootstrap = path.join(packageRoot, 'cli-entry.js');
fs.writeFileSync(bootstrap, 'global launcher');

// Get a REAL dead PID by spawning a process that exits immediately
const deadPidResult = spawnSync('node', ['-e', 'process.exit(0)']);
// The child PID is not directly available from spawnSync, so we use a trick:
// spawn a background process, capture its PID, wait for it to die
const deadPid = (() => {
  const result = execFileSync('node', [
    '-e',
    `
    const { spawn } = require('child_process');
    const child = spawn('node', ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    console.log(child.pid);
    `,
  ], { encoding: 'utf8' }).trim();
  // Wait a bit for the child to actually exit
  spawnSync('sleep', ['0.5']);
  return result;
})();

console.log(`💀 Dead PID: ${deadPid}`);
console.log(`🟢 Live PID: ${process.pid} (current process)\n`);

// Verify the dead PID is actually dead
try {
  process.kill(Number(deadPid), 0);
  console.error(`❌ PID ${deadPid} is still alive! Test invalid.`);
  process.exit(1);
} catch (e) {
  if (e.code !== 'ESRCH') {
    console.error(`❌ Unexpected error checking PID ${deadPid}: ${e.code}`);
    process.exit(1);
  }
  console.log(`✅ Confirmed PID ${deadPid} is dead (ESRCH)\n`);
}

// Prepare the update root and create the launcher structure
const updateRoot = path.join(tmpRoot, 'updates');
const resolvedBootstrap = fs.realpathSync(bootstrap);
const launcherHash = createHash('sha256').update(resolvedBootstrap).digest('hex').slice(0, 16);
const launcherRoot = path.join(updateRoot, launcherHash);
const versionsDir = path.join(launcherRoot, 'versions');
fs.mkdirSync(versionsDir, { recursive: true });

// --- Create test artifacts ---

// 1. Stale staging directory (dead PID) - SHOULD BE REMOVED
const staleStagingDir = fs.mkdtempSync(path.join(versionsDir, `.2.1.0-${deadPid}-`));
fs.writeFileSync(path.join(staleStagingDir, 'stale-file.txt'), 'stale content');
console.log(`🔴 Created stale staging dir: ${path.basename(staleStagingDir)}`);

// 2. Stale temp active-pointer file (dead PID) - SHOULD BE REMOVED
const staleActiveFile = path.join(launcherRoot, `active.json.${deadPid}`);
fs.writeFileSync(staleActiveFile, JSON.stringify({ version: '2.1.0' }));
console.log(`🔴 Created stale active file: active.json.${deadPid}`);

// 3. Live staging directory (current PID) - SHOULD BE RETAINED
const liveStagingDir = fs.mkdtempSync(path.join(versionsDir, `.2.2.0-${process.pid}-`));
fs.writeFileSync(path.join(liveStagingDir, 'live-file.txt'), 'live content');
console.log(`🟢 Created live staging dir: ${path.basename(liveStagingDir)}`);

// 4. Live temp active-pointer file (current PID) - SHOULD BE RETAINED
const liveActiveFile = path.join(launcherRoot, `active.json.${process.pid}`);
fs.writeFileSync(liveActiveFile, JSON.stringify({ version: '2.2.0' }));
console.log(`🟢 Created live active file: active.json.${process.pid}`);

// 5. Immutable version payload - SHOULD BE RETAINED
const versionDir = path.join(versionsDir, '1.0.0');
fs.mkdirSync(versionDir, { recursive: true });
fs.writeFileSync(path.join(versionDir, 'payload.js'), 'immutable payload');
console.log(`🟢 Created immutable version dir: 1.0.0`);

// 6. Unknown/unrelated directory - SHOULD BE RETAINED
const unknownDir = path.join(versionsDir, 'unrelated-stuff');
fs.mkdirSync(unknownDir);
fs.writeFileSync(path.join(unknownDir, 'data.txt'), 'unrelated');
console.log(`🟢 Created unknown dir: unrelated-stuff`);

// 7. Non-semver staging-shaped directory (dead PID) - SHOULD BE RETAINED
const nonSemverDir = path.join(versionsDir, `.not-semver-${deadPid}-abc123`);
fs.mkdirSync(nonSemverDir);
console.log(`🟢 Created non-semver dir: .not-semver-${deadPid}-abc123`);

// 8. Staging-shaped symlink (dead PID) - SHOULD BE RETAINED
const stagingSymlink = path.join(versionsDir, `.2.3.0-${deadPid}-abcdef`);
fs.symlinkSync(versionDir, stagingSymlink, 'dir');
console.log(`🟢 Created staging symlink: .2.3.0-${deadPid}-abcdef`);

console.log(`\n📂 Before cleanup - versions dir contents:`);
for (const entry of fs.readdirSync(versionsDir)) {
  const stat = fs.lstatSync(path.join(versionsDir, entry));
  const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : 'file';
  console.log(`   ${type.padEnd(8)} ${entry}`);
}
console.log(`\n📂 Before cleanup - launcher root contents:`);
for (const entry of fs.readdirSync(launcherRoot)) {
  const stat = fs.lstatSync(path.join(launcherRoot, entry));
  const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : 'file';
  console.log(`   ${type.padEnd(8)} ${entry}`);
}

// --- Trigger cleanup via prepareManagedNpmUpdate ---
console.log(`\n⚙️  Calling prepareManagedNpmUpdate('3.0.0') to trigger cleanup...\n`);

// Set required env vars
process.env.NPM_CONFIG_GLOBALCONFIG = path.join(tmpRoot, 'npmrc');
fs.writeFileSync(process.env.NPM_CONFIG_GLOBALCONFIG, '');

const update = prepareManagedNpmUpdate('3.0.0', bootstrap, updateRoot);

// --- Verify results ---
console.log(`📂 After cleanup - versions dir contents:`);
for (const entry of fs.readdirSync(versionsDir)) {
  const stat = fs.lstatSync(path.join(versionsDir, entry));
  const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : 'file';
  console.log(`   ${type.padEnd(8)} ${entry}`);
}
console.log(`\n📂 After cleanup - launcher root contents:`);
for (const entry of fs.readdirSync(launcherRoot)) {
  const stat = fs.lstatSync(path.join(launcherRoot, entry));
  const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : 'file';
  console.log(`   ${type.padEnd(8)} ${entry}`);
}

console.log('\n--- Verification ---\n');

let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${description}`);
    failed++;
  }
}

check('Stale staging dir (dead PID) removed', !fs.existsSync(staleStagingDir));
check('Stale active file (dead PID) removed', !fs.existsSync(staleActiveFile));
check('Live staging dir (current PID) retained', fs.existsSync(liveStagingDir));
check('Live active file (current PID) retained', fs.existsSync(liveActiveFile));
check('Immutable version payload retained', fs.existsSync(versionDir));
check('Unknown directory retained', fs.existsSync(unknownDir));
check('Non-semver staging dir retained', fs.existsSync(nonSemverDir));
check('Staging-shaped symlink retained', fs.existsSync(stagingSymlink));
check('New staging dir created for 3.0.0', fs.existsSync(update.stagingDir));

console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} checks`);

// Cleanup
fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n🧹 Cleaned up test root`);

if (failed > 0) {
  console.log('\n❌ E2E TEST FAILED');
  process.exit(1);
} else {
  console.log('\n✅ E2E TEST PASSED');
}
