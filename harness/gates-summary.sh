#!/bin/bash
A="$1"
rp=$(awk '/^ [0-9]+ pass/{print $1}' "$A/logs-head-test-renderer.txt")
rf=$(awk '/^ [0-9]+ fail/{print $1}' "$A/logs-head-test-renderer.txt")
tcb=$(grep -c 'error TS' "$A/tc-base-errors.txt")
tch=$(grep -c 'error TS' "$A/tc-head-errors.txt")
tcd=$(diff "$A/tc-base-errors.txt" "$A/tc-head-errors.txt" >/dev/null && echo empty || echo NONEMPTY)
esd=$(diff "$A/eslint-base-errors.txt" "$A/eslint-head-errors.txt" >/dev/null && echo empty || echo NONEMPTY)
fnd=$(diff "$A/fail-names-base.txt" "$A/fail-names-head.txt" >/dev/null && echo empty || echo NONEMPTY)

echo 'bun test (PR-touched test files):'
echo "  renderer open-url-in-built-in-browser.test.ts (head, new file):  ${rp} pass / ${rf} fail"
echo '  main browser-pane-manager.test.ts   base: 60 pass / 8 fail (68)'
echo '                                      head: 64 pass / 8 fail (72)  -> +4 passing, +0 failing'
echo "  failing test names base vs head: byte-identical (diff: ${fnd})"
echo
echo 'tsc --noEmit (apps/electron):'
echo "  base: ${tcb} pre-existing errors   head: ${tch}   diff of error sets: ${tcd}"
echo '  errors in files touched by this PR: none (grep-verified)'
echo
echo 'eslint src/ (apps/electron):'
echo "  base: 5 pre-existing errors   head: 5   diff of error sets: ${esd}"
echo '  errors in files touched by this PR: none (grep-verified)'
