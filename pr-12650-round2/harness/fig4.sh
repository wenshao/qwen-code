#!/bin/bash
# Mutation matrix (from mutation-matrix.json) + survivors driven through the real lanes + residual.
O=/root/verify/pr12650/r2/out; H=/root/verify/pr12650/r2/host
B=$'\033[1m'; R=$'\033[0m'; G=$'\033[32m'; RD=$'\033[31m'; C=$'\033[36m'; D=$'\033[2m'; Y=$'\033[33m'
echo "${B}Mutation matrix @ 0f8f1756${R} ${D}(one edit to scripts/lint.js each; PR's own lint.test.js; killed = ≥1 test red)${R}"
node -e '
const rows=require(process.argv[1]);
const G="\x1b[32m",RD="\x1b[31m",R="\x1b[0m",D="\x1b[2m";
const short={M1:"stageGitFileList: drop the `|| { …; exit 1; }` git guard",M5:"yamllint: append `|| true` (swallow the linter status)",M3:"refuseEmptyList: test the literal name instead of $variable",M11:"shellcheck: drop the terminal-bench exclusion (lint.js:229)",M17:"getLinterPath: `env = process.env` default -> `{}`"};
for (const r of rows) {
  if (r.id==="NC") continue;
  const k=r.killedBy.length>0, d=(short[r.id]||r.desc);
  const first=k?r.killedBy[0]:""; const by=k? D+"← "+r.killedBy.length+" red: "+(first.length>40?first.slice(0,39)+"…":first)+R : "";
  console.log(" "+(k?G+"KILLED  ":RD+"SURVIVED")+R+" "+r.id.padEnd(4)+" "+(d.length>66?d.slice(0,65)+"…":d).padEnd(66)+" "+by);
}
const n=rows.filter(r=>r.id!=="NC"), k=n.filter(r=>r.killedBy.length).length;
console.log("\n "+k+"/"+n.length+" killed");' "$H/mutation-matrix.json"
echo
echo "${B}Survivors driven through the real lanes${R} ${D}(rig, healthy tree, real setup + actionlint + shellcheck + yamllint)${R}"
for a in m17 m18; do
  line=" ${C}$(echo $a | tr a-z A-Z)${R}"
  for l in setup actionlint shellcheck yamllint; do r=$(cut -d' ' -f1 $O/S5.$a.$l.rc); [ "$r" = 0 ] && col=$G || col=$RD; line="$line  $l ${col}exit $r${R}"; done
  echo "$line"
done
echo "   ${D}M17: every lane fails loudly (the PR's own git guard fires in both lanes).${R}"
echo "   ${D}M18: CI goes red at 'Run actionlint'; the shellcheck lane alone stays green (pre-existing, below).${R}"
echo "   ${D}M11: 66 → $(sed 's/.*files=//' $O/S5.m11.shellcheck.calls) scripts, +$(( $(grep -c ': warning: ' $O/S5.m11.shellcheck.out) - $(grep -c ': warning: ' $O/S2.pr.shellcheck.out) )) advisory warnings, exit $(cut -d' ' -f1 $O/S5.m11.shellcheck.rc) (4 terminal-bench scripts join the lane).${R}"
echo "   ${D}M16: lanes exit $(cut -d' ' -f1 $O/S5.m16.shellcheck.rc)/$(cut -d' ' -f1 $O/S5.m16.yamllint.rc), stdout identical to PR — no effect here (image yamllint is on the system PATH).${R}"
echo
echo "${B}Pre-existing residual — shellcheck lane status${R} ${D}(native x86_64, pinned shellcheck 0.11.0; not introduced here)${R}"
printf '   %-34s %-12s %s\n' "case" "PR" "follow-up candidate (last round's diff)"
for k in missing crash; do
  pr=$(cut -d' ' -f1 $O/S6$k.pr.shellcheck.rc); ca=$(cut -d' ' -f1 $O/S6$k.cand.shellcheck.rc)
  msg=$(grep -v '^$' $O/S6$k.cand.shellcheck.err | tail -1)
  printf '   %-34s %s %s\n' "shellcheck binary $k" "${RD}exit $pr${R}      " "${G}exit $ca${R} ${D}$msg${R}"
done
printf '   %-34s %s %s\n' "unparseable script (SC1073 error)" "${RD}exit $(cut -d' ' -f1 $O/S4.pr.shellcheck.rc)${R}      " "${G}exit $(cut -d' ' -f1 $O/S6err.cand.shellcheck.rc)${R} ${D}$(grep -v '^$' $O/S6err.cand.shellcheck.err | tail -1)${R}"
printf '   %-34s %s %s\n' "one extra SC2086 warning" "${G}exit $(cut -d' ' -f1 $O/S6warn.pr.shellcheck.rc)${R}      " "${G}exit $(cut -d' ' -f1 $O/S6warn.cand.shellcheck.rc)${R} ${D}(warnings stay advisory)${R}"
cmp -s $O/S6h.cand.shellcheck.out $O/S2.pr.shellcheck.out && printf '   %-34s %s %s\n' "healthy tree" "${G}exit $(cut -d' ' -f1 $O/S2.pr.shellcheck.rc)${R}      " "${G}exit $(cut -d' ' -f1 $O/S6h.cand.shellcheck.rc)${R} ${D}stdout byte-identical to PR${R}"
