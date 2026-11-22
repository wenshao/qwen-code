#!/bin/bash
# Witness script for PR 18101: suite counts at head, the trap vacuity cell,
# and the root-vs-non-root difference for the || true pin.
set -u
HEAD=/root/git/qwen-code-verify/tmp/pr18101-head
CONF=./scripts/tests/vitest.config.ts
FILE=scripts/tests/sdk-java-workflow.test.js
cd "$HEAD" || exit 1
sha256sum .github/workflows/sdk-java.yml > /tmp/evidence-yaml.sha

echo '== head suite as root (GitHub default bash -e; root uid) =='
./node_modules/.bin/vitest run --config "$CONF" "$FILE" 2>&1 | grep -E 'Tests +|Test Files +'

echo
echo '== mutation A: delete the EXIT trap from all four call sites (root) =='
python3 - <<'PY'
p='.github/workflows/sdk-java.yml'
s=open(p).read()
line = "            trap 'seed_helper_status=$?; rm -f -- \"${seed_helper}\" || true; exit \"${seed_helper_status}\"' EXIT\n"
print('trap lines removed:', s.count(line))
open(p,'w').write(s.replace(line, ''))
PY
./node_modules/.bin/vitest run --config "$CONF" "$FILE" -t 'loads the shared Maven cache seed helper only when it exists' 2>&1 | grep -E 'FAIL |expected|Tests +' | head -4
git checkout -- .github/workflows/sdk-java.yml

echo
echo '== mutation B: delete only the "|| true" (root uid -> rm never fails, survives) =='
python3 - <<'PY'
p='.github/workflows/sdk-java.yml'
s=open(p).read()
print('"|| true" occurrences:', s.count('rm -f -- "${seed_helper}" || true'))
open(p,'w').write(s.replace('rm -f -- "${seed_helper}" || true', 'rm -f -- "${seed_helper}"'))
PY
./node_modules/.bin/vitest run --config "$CONF" "$FILE" -t 'loads the shared Maven cache seed helper only when it exists' 2>&1 | grep -E 'Tests +'
git checkout -- .github/workflows/sdk-java.yml

echo
echo '== same tree as uid 65534 (how CI runs): full suite =='
(cd /tmp/nr-head && setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp/nr-home TMPDIR=/tmp/nr-tmp \
  PATH=/usr/local/bin:/usr/bin:/bin ./node_modules/.bin/vitest run --config "$CONF" "$FILE" 2>&1) | grep -E 'Tests +|Test Files +'

echo
echo '== mutation B repeated as uid 65534: the || true is pinned here =='
python3 - <<'PY'
p='.github/workflows/sdk-java.yml'
s=open(p).read()
open(p,'w').write(s.replace('rm -f -- "${seed_helper}" || true', 'rm -f -- "${seed_helper}"'))
PY
(cd /tmp/nr-head && setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp/nr-home TMPDIR=/tmp/nr-tmp \
  PATH=/usr/local/bin:/usr/bin:/bin ./node_modules/.bin/vitest run --config "$CONF" "$FILE" -t 'loads the shared Maven cache seed helper only when it exists' 2>&1) | grep -E 'FAIL |expected|Tests +' | head -4
git checkout -- .github/workflows/sdk-java.yml

sha256sum -c /tmp/evidence-yaml.sha
