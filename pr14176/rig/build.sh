#!/usr/bin/env bash
# Mirrors the 'build' job of release-managed-agent-reference.yml (steps Test the packager,
# Build Java components, Assemble reference distribution), then assembles a second
# candidate from the same tree to check byte identity.
set -euo pipefail
cd /rig/src
SHA=dc6ea3b4601707ceef4b41f0c064fa490b13a2da
VER=0.0.0-pr.14176
echo "== step: Test the packager"; node --test scripts/tests/package-managed-agent-reference.test.mjs 2>&1 | tail -12
echo "== step: Build Java components"
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true clean install -q
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -DskipTests clean install -q
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests clean package -q
ls -l packages/sdk-java/managed-agent-server/target/*.jar packages/sdk-java/runtime-broker/target/*.jar
echo "== step: Assemble reference distribution (candidate A)"
rm -rf /rig/out-a /rig/out-b
node scripts/package-managed-agent-reference.mjs --version "$VER" --source-revision "$SHA" --output /rig/out-a
echo "== candidate B (same tree, second run)"
sleep 2
node scripts/package-managed-agent-reference.mjs --version "$VER" --source-revision "$SHA" --output /rig/out-b
(cd /rig/out-a && sha256sum *) ; (cd /rig/out-b && sha256sum *)
cmp /rig/out-a/qwen-managed-agent-reference-$VER.tar.gz /rig/out-b/qwen-managed-agent-reference-$VER.tar.gz && echo "ARCHIVE_IDENTICAL"
cmp /rig/out-a/SHA256SUMS.txt /rig/out-b/SHA256SUMS.txt && echo "SUMS_IDENTICAL"
cmp /rig/out-a/qwen-managed-agent-reference-$VER.manifest.json /rig/out-b/qwen-managed-agent-reference-$VER.manifest.json && echo "MANIFEST_IDENTICAL"
echo "BUILD_DONE"
