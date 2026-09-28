#!/bin/bash
# Round 4 mutation matrix for the delta commit f415b565 ("Preserve stderr in
# managed Shell preview"). Each mutant is applied to the head tree's copy of
# packages/core/src/services/shellExecutionService.ts, the whole
# shellExecutionService.test.ts file is run against it, then the file is
# restored and its sha256 re-verified.
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
F=$A/head/packages/core/src/services/shellExecutionService.ts
ORIG=$(sha256sum "$F" | cut -d' ' -f1)
cp "$F" "$A/results/shellExecutionService.orig.ts"
cd "$A/head/packages/core" || exit 9

apply() { # apply <name> <node-replacement-file>
  local name=$1 script=$2
  node "$script" "$F" || { echo "MUTANT $name APPLY_FAILED"; return; }
  local now; now=$(sha256sum "$F" | cut -d' ' -f1)
  if [ "$now" = "$ORIG" ]; then echo "MUTANT $name NO_CHANGE (pattern did not match)"; return; fi
  echo "=== MUTANT $name (file sha ${now:0:12})"
  local mlog="$A/results/mut-$(echo "$name" | tr ' /' '__').log"
  npx vitest run src/services/shellExecutionService.test.ts --reporter=basic > "$mlog" 2>&1
  grep -E "Tests +[0-9]|Test Files +[0-9]" "$mlog" | tail -2
  grep -E "^\s+× |AssertionError|Unable to find|expected " "$mlog" | head -12
  cp "$A/results/shellExecutionService.orig.ts" "$F"
  local back; back=$(sha256sum "$F" | cut -d' ' -f1)
  [ "$back" = "$ORIG" ] && echo "MUTANT $name RESTORED_OK" || echo "MUTANT $name RESTORE_FAILED $back"
}

mkdir -p "$A/harness/mut"
cat > "$A/harness/mut/MB.cjs" <<'EOF'
const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const from='Math.min(8192, Math.floor(maxBufferedOutputBytes / 8))';
if(!s.includes(from))throw new Error('pattern not found');
fs.writeFileSync(f,s.replace(from,'0'));
EOF
cat > "$A/harness/mut/MC.cjs" <<'EOF'
const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const from='\\n\\n[Recent stderr]\\n';
if(!s.includes(from))throw new Error('pattern not found');
fs.writeFileSync(f,s.replace(from,'\\n\\n'));
EOF
cat > "$A/harness/mut/MD.cjs" <<'EOF'
const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const from="if (stream === 'stderr') stderrTail?.add(data);";
if(!s.includes(from))throw new Error('pattern not found');
fs.writeFileSync(f,s.replace(from,"if (stream === 'stdout') stderrTail?.add(data);"));
EOF
cat > "$A/harness/mut/ME.cjs" <<'EOF'
const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const from='const completePreviewBytes = maxBufferedOutputBytes - stderrTailBytes;';
if(!s.includes(from))throw new Error('pattern not found');
fs.writeFileSync(f,s.replace(from,'const completePreviewBytes = maxBufferedOutputBytes;'));
EOF
cat > "$A/harness/mut/MF.cjs" <<'EOF'
const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const from='maxBufferedOutputBytes - previewHeadBytes - stderrTailBytes,';
if(!s.includes(from))throw new Error('pattern not found');
fs.writeFileSync(f,s.replace(from,'maxBufferedOutputBytes - previewHeadBytes,'));
EOF

echo "=== BASELINE (unmutated head)"
npx vitest run src/services/shellExecutionService.test.ts --reporter=basic 2>&1 | grep -E "Tests +[0-9]|Test Files +[0-9]" | tail -2

apply "MB stderrTailBytes=0" "$A/harness/mut/MB.cjs"
apply "MC drop [Recent stderr] marker" "$A/harness/mut/MC.cjs"
apply "MD wrong stream feeds stderr ring" "$A/harness/mut/MD.cjs"
apply "ME completePreviewBytes not shrunk" "$A/harness/mut/ME.cjs"
apply "MF previewTail capacity not shrunk" "$A/harness/mut/MF.cjs"

echo "=== MA full revert of the delta (control file over head file)"
cp "$A/control/packages/core/src/services/shellExecutionService.ts" "$F"
npx vitest run src/services/shellExecutionService.test.ts --reporter=basic 2>&1 | grep -E "×|Tests +[0-9]|AssertionError|expected .* to contain" | head -20
cp "$A/results/shellExecutionService.orig.ts" "$F"
[ "$(sha256sum "$F" | cut -d' ' -f1)" = "$ORIG" ] && echo "MA RESTORED_OK" || echo "MA RESTORE_FAILED"
echo "MATRIX_DONE orig=$ORIG"
