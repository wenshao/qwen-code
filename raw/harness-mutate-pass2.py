#!/usr/bin/env python3
"""Second mutation pass: fixed M7 anchor + one mutant per UNTESTED module,
each run against the entire opentui suite (all 56 files / 927 tests)."""
import json
import shutil
import subprocess
import os

ROOT = "/Users/wenshao/git/qwen-10383/packages/cli"
OT = ROOT + "/src/ui/opentui"
FULL = ["src/ui/opentui/"]

MUTANTS = [
    ("M7b-route-model-drop-persistScope", f"{OT}/commands-registry.ts",
     """        mode: 'primary',
        ...(result.persistScope ? { persistScope: result.persistScope } : {}),""",
     """        mode: 'primary',""",
     ["src/ui/opentui/commands-registry.test.ts",
      "src/ui/opentui/commands-dispatch.test.ts"]),

    # --- one mutant per module with ZERO tests, run against the WHOLE suite ---
    ("U1-help-overlay-drop-scroll-hint", f"{OT}/help-overlay.tsx",
     "      {maxScroll > 0 && (", "      {false && (", FULL),

    ("U2-modes-approval-picks-wrong-mode", f"{OT}/dialogs-modes.tsx",
     "    const mode = modes[sel];", "    const mode = modes[0];", FULL),

    ("U3-stats-dialog-swallow-esc", f"{OT}/dialogs-stats-skills.tsx",
     "  const { config, onClose, isFocused = true } = props;",
     "  const { config, onClose: _onClose, isFocused = true } = props;\n  const onClose = () => {};",
     FULL),

    ("U4-arena-status-label-broken", f"{OT}/dialogs-arena.tsx",
     """    case ArenaSessionStatus.FAILED:
      return { text: 'Failed', color: C.red };""",
     """    case ArenaSessionStatus.FAILED:
      return { text: 'Completed', color: C.green };""",
     FULL),

    ("U5-rewind-viewer-restore-option-drop", f"{OT}/session-rewind.tsx",
     "export type RestoreOption = 'both' | 'conversation' | 'code' | 'cancel';",
     "export type RestoreOption = 'both' | 'conversation' | 'code' | 'cancel';\nconst __MUTANT__ = 1;\nvoid __MUTANT__;",
     FULL),
]


def run_tests(files):
    cmd = ["npx", "vitest", "run", *files, "--reporter=basic", "--no-coverage"]
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=1800)
    return p.returncode, (p.stdout + p.stderr)[-2500:]


results = []
for mid, path, old, new, tests in MUTANTS:
    src = open(path).read()
    if src.count(old) != 1:
        results.append({"id": mid, "status": "ANCHOR-MISS",
                        "occurrences": src.count(old)})
        print(f"{mid}: ANCHOR-MISS ({src.count(old)})")
        continue
    backup = path + ".bak"
    shutil.copy2(path, backup)
    try:
        open(path, "w").write(src.replace(old, new))
        rc, out = run_tests(tests)
        status = "KILLED" if rc != 0 else "SURVIVED"
        summary = " | ".join(l.strip() for l in out.splitlines()
                             if "Tests " in l or "Test Files" in l)
        results.append({"id": mid, "status": status, "summary": summary[:300]})
        print(f"{mid}: {status}  {summary[:180]}")
    finally:
        shutil.move(backup, path)

out_path = os.environ.get("PROBE_OUT", "/tmp") + "/mutation2.json"
os.makedirs(os.path.dirname(out_path), exist_ok=True)
json.dump(results, open(out_path, "w"), indent=2)
print("\nSURVIVED:", [r["id"] for r in results if r["status"] == "SURVIVED"])
