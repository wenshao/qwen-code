#!/bin/bash
# Live comparisons over the captured outputs (each line below is computed here).
O=/root/verify/pr12650/r2/out; H=/root/verify/pr12650/r2/host
B=$'\033[1m'; R=$'\033[0m'; G=$'\033[32m'; RD=$'\033[31m'; C=$'\033[36m'; D=$'\033[2m'; Y=$'\033[33m'
ok() { if eval "$1"; then echo "${G}✔${R} $2"; else echo "${RD}✘${R} $2"; fi; }
echo "${B}Healthy checkout${R} ${D}(verbatim ci.yml step added safe.directory first; 10252 tracked files)${R}"
for l in shellcheck yamllint; do
  echo "  ${C}$l${R}  main: exit $(cut -d' ' -f1 $O/S2.base.$l.rc), $(sed 's/.*files=//' $O/S2.base.$l.calls) files, 1 call   PR: exit $(cut -d' ' -f1 $O/S2.pr.$l.rc), $(sed 's/.*files=//' $O/S2.pr.$l.calls) files, 1 call"
  ok "cmp -s $O/S2.base.$l.out $O/S2.pr.$l.out && cmp -s $O/S2.base.$l.err $O/S2.pr.$l.err" "  $l stdout+stderr byte-identical main vs PR ($(wc -l < $O/S2.pr.$l.out) lines)"
done
n=$(grep -cE ': (warning|error):' /root/verify/pr12650/r2/out/ci.shellcheck.out)
ok "diff -q <(grep -E ': (warning|error):' /root/verify/pr12650/r2/out/ci.shellcheck.out) <(grep -E ': (warning|error):' $O/S2.pr.shellcheck.out) >/dev/null" "  rig's $n shellcheck findings == real CI log, line for line"
echo "     ${D}(Lint & Static job 110076302069 at 0f8f1756 on ecs-qwen-hk3-13: 2324 warnings, 0 errors, 58 files)${R}"
echo "  ${C}real violations${R}  dup-key YAML → yamllint exit $(cut -d' ' -f1 $O/S4.base.yamllint.rc) on main, exit $(cut -d' ' -f1 $O/S4.pr.yamllint.rc) on PR (same ::error lines)"
echo
echo "${B}Refactor since the last verified head${R} ${D}(de0f9143 → 0f8f1756: stageGitFileList/refuseEmptyList, tempDir param)${R}"
echo "  ${C}\$ diff <(generated lane shell @ de0f9143) <(… @ 0f8f1756)${R}"
diff $H/eq/prev.txt $H/eq/pr.txt | sed -e "s/^</$RD</" -e "s/^>/$G>/" -e "s/\$/$R/" -e "s/^/  /"
echo "  ${D}→ the shell CI executes is unchanged except one stderr wording (\"lint\" → \"pass\")${R}"
ok "(cd $H/eq && node path.mjs | grep -q identical)" "  getLinterPath() identical @ de0f9143 vs @ 0f8f1756 (linux, darwin, win32, no-arg)"
echo
echo "${B}PR suite${R} ${D}(npx vitest run --config ./scripts/tests/vitest.config.ts scripts/tests/lint.test.js)${R}"
echo "  Linux x86_64 (dash, Node 22.22.2):  $(sed 's/\x1b\[[0-9;]*m//g' $H/suite-pr.ansi | grep -E '^ +Tests ' | sed 's/^ *//')"
echo "  CI Test (ubuntu-latest) @ 0f8f1756: $(grep -ao '✓ scripts/tests/lint.test.js (16 tests)' /root/verify/pr12650/r2/ci/test-job.log)"
echo "  simulated unsupported arch:         $(sed 's/\x1b\[[0-9;]*m//g' $H/arch-arm64.raw | grep -E '^ +Tests ' | sed 's/^ *//')  ${D}(lane cases ctx.skip())${R}"
echo "  negative control (PR tests vs main's lane strings): ${RD}$(node -e "const j=require('$H/mut-NC.json');console.log(j.numFailedTests+' failed')")${R} | $(node -e "console.log(require('$H/mut-NC.json').numPassedTests)") passed — all 5 = the guard tests"
