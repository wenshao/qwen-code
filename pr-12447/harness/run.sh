#!/bin/bash
# inside container: /w = copy of repo tree, /d = drift fixtures
cd /w/packages/sdk-java/runtime-broker
F=/w/packages/cli/src/serve/contracts/managed-runtime-attestation-v2.fixtures.json
cp $F /tmp/orig.json
/opt/maven/bin/mvn -o -q --batch-mode test-compile -Djacoco.skip=true >/dev/null 2>&1
for m in /d/J*.json; do
  cp $m $F
  out=$(/opt/maven/bin/mvn -o --batch-mode --no-transfer-progress surefire:test -Djacoco.skip=true -Dtest=ManagedRuntimeAttestationConformanceTest 2>&1)
  line=$(echo "$out" | grep -E "Tests run: [0-9]+, Failures" | tail -1 | sed 's/^\[[A-Z]*\] //')
  why=$(echo "$out" | grep -E "^\[ERROR\]   ManagedRuntime|AssertionFailed|expected:" | head -1 | sed 's/^\[ERROR\] *//' | cut -c1-110)
  echo "$(basename $m .json) | $line | $why"
done
cp /tmp/orig.json $F
