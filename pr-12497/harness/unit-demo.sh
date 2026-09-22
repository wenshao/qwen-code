#!/bin/bash
cd /root/verify/pr12497/head/packages/core
echo "\$ git diff --stat   # mutant M3: isToolHiddenBehindToolSearch re-implemented, CodeModeOnly guard forgotten"
git -C /root/verify/pr12497/head diff --stat -- packages/core/src/skills/bundled-reference.ts
echo
echo "\$ vitest run <BASE 99bf4ce test table>   (no CodeModeOnly row)"
npx vitest run src/skills/workflow-authoring-skill.basearm.test.ts --coverage.enabled=false 2>&1 | sed "s/\x1b\[[0-9;]*m//g" | grep -E "Test Files|Tests  "
echo
echo "\$ vitest run <PR head 59053bf test table>   (+ CodeModeOnly row)"
npx vitest run src/skills/workflow-authoring-skill.test.ts --coverage.enabled=false 2>&1 | sed "s/\x1b\[[0-9;]*m//g" | grep -E "FAIL .*>|AssertionError|Expected|Received|Test Files|Tests  " | head -8
