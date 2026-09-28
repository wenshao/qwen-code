#!/bin/bash
# Round 4: measure a candidate minimal fix for the misaligned-window mojibake.
# A ring-buffer window that starts inside a multi-byte character is not valid
# UTF-8, so decodeBufferedOutput() falls back to the system code page / chardet
# and renders garbage. Dropping the leading continuation bytes restores UTF-8.
# Applied to a scratch copy of the head tree, measured, then restored + sha-verified.
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
F=$A/head/packages/core/src/services/shellExecutionService.ts
ORIG=$(sha256sum "$F" | cut -d' ' -f1)
cp "$F" "$A/results/candidate-fix-orig.ts"
echo "ORIG=$ORIG"

python3 - "$F" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()

anchor = "function decodeBufferedOutput(finalBuffer: Buffer): string {"
helper = """/**
 * A ring-buffer window can start inside a multi-byte character. Such a slice is
 * not valid UTF-8, so decoding it would fall back to the system code page and
 * render garbage; drop the leading continuation bytes instead.
 */
function dropPartialLeadingUtf8(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length && i < 3 && (buf[i] & 0xc0) === 0x80) i++;
  return i === 0 ? buf : buf.subarray(i);
}

"""
assert anchor in s, 'helper anchor not found'
s = s.replace(anchor, helper + anchor, 1)

old = "const stderrPreview = stderrTail?.read() ?? Buffer.alloc(0);"
new = "const stderrPreview = dropPartialLeadingUtf8(\n            stderrTail?.read() ?? Buffer.alloc(0),\n          );"
assert old in s, 'stderrPreview anchor not found'
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
PY
PATCHED=$(sha256sum "$F" | cut -d' ' -f1)
echo "PATCHED=$PATCHED"
if [ "$PATCHED" = "$ORIG" ]; then echo "PATCH_NOT_APPLIED"; exit 9; fi
git -C "$A/head" diff --stat -- packages/core/src/services/shellExecutionService.ts

echo "=== T1/T2/T3/T4 with the candidate fix (head+fix)"
timeout 400 "$A/head/node_modules/.bin/tsx" "$A/harness/s9c-cjk.mts" --tree "$A/head" --json "$A/results/s9c-head-fix.json" 2>&1 | grep -vE "^#"
echo "=== s9b sibling sweep with the candidate fix (collateral check)"
timeout 500 "$A/head/node_modules/.bin/tsx" "$A/harness/s9b-stderr-siblings.mts" --tree "$A/head" --json "$A/results/s9b-head-fix.json" 2>&1 | grep -E "^(PASS|FAIL|# SUMMARY)"
echo "=== core shell suite with the candidate fix"
cd "$A/head/packages/core" && npx vitest run src/services/shellExecutionService.test.ts --reporter=basic 2>&1 | grep -E "Tests +[0-9]|Test Files +[0-9]|× " | tail -4

cp "$A/results/candidate-fix-orig.ts" "$F"
BACK=$(sha256sum "$F" | cut -d' ' -f1)
[ "$BACK" = "$ORIG" ] && echo "RESTORED_OK $BACK" || echo "RESTORE_FAILED $BACK"
echo "FIX_EXPERIMENT_DONE"
