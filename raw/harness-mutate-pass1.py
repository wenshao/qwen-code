#!/usr/bin/env python3
"""Mutation matrix for PR #10383 new modules.

Each mutant makes a single semantic change to a PR source file and reruns the
PR's own tests for that module. A mutant that leaves the suite green is a hole
in the batch's test coverage.
"""
import json
import shutil
import subprocess
import sys
import os

ROOT = "/Users/wenshao/git/qwen-10383/packages/cli"
OT = ROOT + "/src/ui/opentui"

MUTANTS = [
    # id, file, old, new, test files
    ("M1-rewind-cutpoint-offbyone", f"{OT}/session-rewind-model.ts",
     "if (seen === occurrence) return idx;",
     "if (seen === occurrence + 1) return idx;",
     ["src/ui/opentui/session-rewind.test.ts"]),

    ("M2-rewind-scroll-half", f"{OT}/session-rewind-model.ts",
     "const halfVisible = Math.floor(visibleCount / 2);",
     "const halfVisible = 0;",
     ["src/ui/opentui/session-rewind.test.ts"]),

    ("M3-rewind-scrolldown-boundary", f"{OT}/session-rewind-model.ts",
     "showScrollDown: offset + visibleCount < total,",
     "showScrollDown: offset + visibleCount <= total,",
     ["src/ui/opentui/session-rewind.test.ts"]),

    ("M4-rewind-drop-code-option", f"{OT}/session-rewind-model.ts",
     """  if (hasChanges) {
    options.push({
      key: 'code',
      label: t('Restore code only'),
    });
  }""",
     """  if (false) {
    options.push({
      key: 'code',
      label: t('Restore code only'),
    });
  }""",
     ["src/ui/opentui/session-rewind.test.ts"]),

    ("M5-rewind-sentToModel-ignored", f"{OT}/session-rewind-model.ts",
     "if (typeof turn.sentToModel === 'boolean') return turn.sentToModel;",
     "if (typeof turn.sentToModel === 'boolean') return true;",
     ["src/ui/opentui/session-rewind.test.ts"]),

    ("M6-route-swap-stats-diff", f"{OT}/commands-registry.ts",
     """    case 'diff':
      return { dialog: 'diff' };
    case 'stats':
      return { dialog: 'stats' };""",
     """    case 'diff':
      return { dialog: 'stats' };
    case 'stats':
      return { dialog: 'diff' };""",
     ["src/ui/opentui/commands-registry.test.ts",
      "src/ui/opentui/commands-dispatch.test.ts"]),

    ("M7-route-drop-persistScope", f"{OT}/commands-registry.ts",
     "        persistScope: result.persistScope,",
     "        persistScope: undefined,",
     ["src/ui/opentui/commands-registry.test.ts",
      "src/ui/opentui/commands-dispatch.test.ts"]),

    ("M8-route-branch-no-throw", f"{OT}/commands-registry.ts",
     """      throw new Error(
        "'/branch' is a host action (handleBranch) and must not route to a dialog",
      );""",
     "      return { dialog: 'help' };",
     ["src/ui/opentui/commands-registry.test.ts",
      "src/ui/opentui/commands-dispatch.test.ts"]),

    ("M9-gateway-drop-busy-guard", f"{OT}/slash-gateway.ts",
     """    if (this.busy) {
      return {
        kind: 'rejected',
        reason: 'A slash command is already running.',
      };
    }""",
     "    if (false) { return { kind: 'rejected', reason: 'x' }; }",
     ["src/ui/opentui/slash-gateway.test.ts"]),

    ("M10-gateway-drop-initerror-guard", f"{OT}/slash-gateway.ts",
     "    if (!this.dispatcher) {",
     "    if (false && !this.dispatcher) {",
     ["src/ui/opentui/slash-gateway.test.ts"]),

    ("M11-gateway-no-await-ready", f"{OT}/slash-gateway.ts",
     "    await this.ready;\n    if (!this.dispatcher) {",
     "    if (!this.dispatcher) {",
     ["src/ui/opentui/slash-gateway.test.ts"]),

    ("M12-hide-invocation-drop-nocolor", f"{OT}/commands-dispatch.ts",
     "    if (canonicalPath[0] === 'theme' && process.env['NO_COLOR']) {\n      return false;\n    }",
     "    if (false) {\n      return false;\n    }",
     ["src/ui/opentui/commands-dispatch.test.ts"]),

    ("M13-dispatch-drop-resume-intercept", f"{OT}/commands-dispatch.ts",
     """                if (result.dialog === 'resume') {
                  if (result.sessionId) {
                    await this.host.handleResume(result.sessionId);
                    return { kind: 'handled' };
                  }
                }""",
     "",
     ["src/ui/opentui/commands-dispatch.test.ts"]),

    ("M14-dispatch-drop-branch-intercept", f"{OT}/commands-dispatch.ts",
     """                if (result.dialog === 'branch') {
                  await this.host.handleBranch(result.name);
                  return { kind: 'handled' };
                }""",
     "",
     ["src/ui/opentui/commands-dispatch.test.ts"]),

    ("M15-help-width-floor-removed", f"{OT}/help-content.ts",
     "const safeWidth = Math.max(72, availableWidth);",
     "const safeWidth = availableWidth;",
     ["src/ui/opentui/help-content.test.ts"]),

    ("M16-dialog-data-", f"{OT}/dialog-data.ts", None, None, []),
]


def run_tests(files):
    cmd = ["npx", "vitest", "run", *files, "--reporter=basic", "--no-coverage"]
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=900)
    return p.returncode, (p.stdout + p.stderr)[-2500:]


def main():
    results = []
    for mid, path, old, new, tests in MUTANTS:
        if old is None:
            continue
        src = open(path).read()
        if src.count(old) != 1:
            results.append({"id": mid, "status": "ANCHOR-MISS",
                            "occurrences": src.count(old)})
            print(f"{mid}: ANCHOR-MISS ({src.count(old)} occurrences)")
            continue
        backup = path + ".bak"
        shutil.copy2(path, backup)
        try:
            open(path, "w").write(src.replace(old, new))
            rc, out = run_tests(tests)
            status = "KILLED" if rc != 0 else "SURVIVED"
            failed = ""
            for line in out.splitlines():
                if "Tests " in line or "Test Files" in line:
                    failed += line.strip() + " | "
            results.append({"id": mid, "status": status, "summary": failed[:300]})
            print(f"{mid}: {status}  {failed[:160]}")
        finally:
            shutil.move(backup, path)
    out_path = os.environ.get("PROBE_OUT", "/tmp") + "/mutation.json"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(results, open(out_path, "w"), indent=2)
    killed = sum(1 for r in results if r["status"] == "KILLED")
    print(f"\nKILLED {killed}/{len(results)}")
    for r in results:
        if r["status"] != "KILLED":
            print("  !!", r["id"], r["status"])


if __name__ == "__main__":
    main()
