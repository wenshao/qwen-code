# Execute the three /review suggestions (R1-1..R1-3, review 5374744598) as in-place mutants on the head2
# checkout: back up the file, apply one replacement, run the named test file, restore, verify the hash.
import hashlib, json, os, shutil, subprocess, sys
CLI = '/root/verify/pr13119/head2/packages/cli'
OUT = '/root/verify/pr13119/r2/review-mutants'; os.makedirs(OUT, exist_ok=True)
WWB = 'src/utils/write-with-backup.ts'; SW = 'src/config/settingsWatcher.ts'; LSA = 'src/config/loadedSettingsAdapter.test.ts'
GUARD = """    try {
      if (recoveryRetained) {
        fs.unlinkSync(tempPath);
      } else {
        fs.rmSync(workingDirectory, { recursive: true, force: true });
      }
    } catch {
      // Cleanup must not obscure the write failure or remove a recovery copy.
    }"""
UNGUARDED = """    if (recoveryRetained) {
      fs.unlinkSync(tempPath);
    } else {
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }"""
CLEAN = "  try {\n    fs.rmSync(workingDirectory, { recursive: true, force: true });\n  } catch {\n    // Publication already succeeded; leftover artifacts do not invalidate it.\n  }"
RETARGET = [("expect(fs.existsSync(userFile + '.orig')).toBe(false);", "expect(fs.readdirSync(userHome)).toEqual(existingFile ? ['settings.json'] : []);"),
            ("expect(fs.existsSync(workspaceFile + '.orig')).toBe(false);", "expect(fs.readdirSync(path.join(workspace, '.qwen'))).toEqual(['settings.json']);")]
CASES = [
  ('R1-1a_watcher_basename_startsWith', 'src/config/settingsWatcher.test.ts', [(SW, [("if (path.basename(changedPath) !== targetBasename) return;", "if (!path.basename(changedPath).startsWith(targetBasename)) return;")])]),
  ('R1-1b_watcher_any_unlinkDir_demotes', 'src/config/settingsWatcher.test.ts', [(SW, [("if (event === 'unlinkDir' && changedPath === dir) {", "if (event === 'unlinkDir') {")])]),
  ('R1-2_failure_cleanup_unguarded', 'src/utils/write-with-backup.test.ts', [(WWB, [(GUARD, UNGUARDED)])]),
  ('R1-3_control_adapter_tests', LSA, []),
  ('R1-3_no_success_cleanup_vs_adapter_tests', LSA, [(WWB, [(CLEAN, '')])]),
  ('R1-3_retargeted_assertion_unmutated', LSA, [(LSA, RETARGET)]),
  ('R1-3_retargeted_assertion_no_success_cleanup', LSA, [(LSA, RETARGET), (WWB, [(CLEAN, '')])]),
]
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
res = {}
for name, test, edits in CASES:
    saved = {}
    try:
        for f, reps in edits:
            p = os.path.join(CLI, f)
            if p not in saved: saved[p] = (sha(p), open(p).read())
            s = open(p).read()
            for old, new in reps:
                assert old in s, (name, f, old[:40]); s = s.replace(old, new, 1)
            open(p, 'w').write(s)
        out = f'{OUT}/{name}.json'
        subprocess.run(['npx', 'vitest', 'run', test, '--reporter=json', f'--outputFile={out}'], cwd=CLI, capture_output=True, timeout=600)
        j = json.load(open(out))
        fails = [a['title'] for f in j['testResults'] for a in f['assertionResults'] if a['status'] == 'failed']
        res[name] = {'test': test, 'passed': j['numPassedTests'], 'failed': j['numFailedTests'], 'total': j['numTotalTests'], 'failing': fails}
    finally:
        for p, (h, body) in saved.items():
            open(p, 'w').write(body); assert sha(p) == h, p
    print(name, res[name]['passed'], '/', res[name]['total'], 'failed', res[name]['failed'], res[name]['failing'][:3], flush=True)
json.dump(res, open(f'{OUT}/summary.json', 'w'), indent=1)
