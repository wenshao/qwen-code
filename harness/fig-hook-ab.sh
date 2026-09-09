#!/usr/bin/env bash
# Real useReactToolScheduler hook + real CoreToolScheduler, base vs PR.
S=/root/git/h11483
B=$'\e[1m'; R=$'\e[0m'; RED=$'\e[91m'; GRN=$'\e[92m'; YEL=$'\e[93m'; CYA=$'\e[96m'; DIM=$'\e[2m'
line() { printf '%s\n' "${DIM}────────────────────────────────────────────────────────────────────────────────────────────────${R}"; }
echo "${B}${CYA}PR #11483 — R4: real useReactToolScheduler over a real CoreToolScheduler held busy${R}"
echo "${DIM}batch A executing; batch B scheduled with a pre-aborted signal, once per caller branch${R}"
line
for wt in base11483 pr11483; do
  out=/tmp/r4-$wt.jsonl; : > "$out"
  cp $S/h11483-downstream.test.tsx /root/git/$wt/packages/cli/src/ui/hooks/
  (cd /root/git/$wt/packages/cli && R4_OUT=$out npx vitest run src/ui/hooks/h11483-downstream.test.tsx >/dev/null 2>&1)
  rm -f /root/git/$wt/packages/cli/src/ui/hooks/h11483-downstream.test.tsx
  tag=$([ "$wt" = base11483 ] && echo "${RED}base 10895031e2${R}" || echo "${GRN}PR   5ab8312f3f${R}")
  printf '  %b\n' "$tag"
  python3 - "$out" <<'PY'
import json,sys
G='\x1b[92m'; RD='\x1b[91m'; Y='\x1b[93m'; N='\x1b[0m'; D='\x1b[2m'
for ln in open(sys.argv[1]):
    d=json.loads(ln)
    print('    branch %-10s abort %-13s' % (d['branch'], d['timing']))
    disp=[c for c in d['displayWhileBusy'] if c['callId']=='pre-aborted-call']
    if disp:
        c=disp[0]
        print('      while busy  : %stool card "%s" status=%s errorType=%s%s' % (RD,c['resultDisplay'],c['status'],c['errorType'],N))
    else:
        print('      while busy  : %sno tool card%s' % (D,N))
    cw=[x for grp in d['onCompleteWhileBusy'] for x in grp if x.startswith('pre-aborted')]
    print('      onComplete   : %s' % (RD+', '.join(cw)+N if cw else D+'not called'+N))
    ca=[x for grp in d['onCompleteAfterRelease'] for x in grp if x.startswith('pre-aborted')]
    print('      after release: %s' % (Y+', '.join(ca)+N if ca else D+'never completed'+N))
PY
done
line
echo "${B}normal branch  — base: late ${YEL}cancelled${R}${B} completion.   PR: dropped outright (caller swallows it; signal.aborted).${R}"
echo "${B}full-turn branch — base: late ${YEL}cancelled${R}${B} completion.  PR: ${RED}error / unhandled_exception${R}${B} card + error tool result  (issue #11148).${R}"
