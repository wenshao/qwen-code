#!/bin/bash
# Witness script for PR 18101: the repo gates the PR's test plan names.
set -u
HEAD=/root/git/qwen-code-verify/tmp/pr18101-head
cd "$HEAD" || exit 1
sha256sum .github/workflows/sdk-java.yml > /tmp/gates-yaml.sha

echo '== prettier --check on the six changed text files =='
npx prettier --check \
  .github/workflows/sdk-java.yml \
  .github/workflows/release-managed-agent-reference.yml \
  .github/scripts/ci-runner-routing.test.mjs \
  scripts/tests/sdk-java-workflow.test.js \
  docs/design/2026-10-20-sdk-java-fair-lock-queue.md \
  docs/design/2026-10-20-sdk-java-fair-lock-queue.zh-CN.md 2>&1 | tail -2

echo
echo '== actionlint 1.7.12 (pinned sha256 verified) =='
/tmp/al/actionlint -shellcheck '-exclude=SC1090,SC2034,SC2154' \
  .github/workflows/sdk-java.yml .github/workflows/release-managed-agent-reference.yml
echo "actionlint exit=$?"

echo
echo '== shellcheck .github/scripts/maven-cache-seed.sh =='
shellcheck .github/scripts/maven-cache-seed.sh
echo "shellcheck exit=$?"

echo
echo '== workflow size ratchet (base 5dd61c30) =='
WORKFLOW_SIZE_BASE_SHA=5dd61c30 bash .github/scripts/check-workflow-size.sh 2>&1 | tail -2

echo
echo '== regrowth cell: +5000 bytes must fail the ratchet =='
cp .github/workflows/sdk-java.yml /tmp/gates-sdk.yml
python3 -c "
p='.github/workflows/sdk-java.yml'
s=open(p).read(); open(p,'w').write(s + 'x'*5000)
"
WORKFLOW_SIZE_BASE_SHA=5dd61c30 bash .github/scripts/check-workflow-size.sh 2>&1 | tail -1
cp /tmp/gates-sdk.yml .github/workflows/sdk-java.yml
sha256sum -c /tmp/gates-yaml.sha
