#!/usr/bin/env bash
# Figure 6: the 12:28 bot review's witnesses re-run on Linux x64. All values grepped from logs.
L=/root/verify/pr12391-harness/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; Y=$'\e[33m'; RD=$'\e[31m'; D=$'\e[2m'; R=$'\e[0m'
echo "${B}${C}Bot review of 12:28 UTC — its executed witnesses, re-run on a second machine${R}"
echo "${D}$(head -1 $L/bot-witness-head.log) · probe lives in package probe.external (public API only)${R}"
echo
echo "${B}Behavioural findings${R}"
grep -a '^  => ' $L/bot-witness-head.log | sed -E "s/^  => (R1-[0-9]) REPRODUCED (.*) \| observed: .*/  \1  ${G}reproduced${R}  \2/"
echo
echo "${B}R1-6 test strength${R}  ${D}(17 mutants on the sites the bot names + its 6 killed controls; mvn -o test, JDK 21)${R}"
s=$(grep -c ' SURVIVED ' /root/verify/pr12391-harness/mutants/run.log); k=$(grep -c '^C0[0-9]  KILLED' /root/verify/pr12391-harness/mutants/run.log)
echo "  claimed survivors  ${Y}${s}/17 survive${R} with the PR's 12 tests green     controls  ${G}${k}/6 killed${R} (harness can fail)"
python3 - <<'PY'
import xml.etree.ElementTree as ET
r=ET.parse('/root/verify/pr12391-harness/trees/head/sdk-java/runtime-broker/target/site/jacoco/jacoco.xml').getroot()
want=[('InMemoryToolExecutionRepository','renewDispatch'),('InMemoryToolExecutionRepository','findByIdempotencyKey'),
      ('InMemoryToolExecutionRepository','findByExecutionCallId'),('ToolExecutionRecord','withUnknown'),
      ('ToolExecutionRecord','resolveUnknown'),('InMemoryToolExecutionRepository','requireCandidate'),('BrokerValues','immutableValue')]
got={}
for cls in r.iter('class'):
    n=cls.get('name').split('/')[-1]
    for m in cls.iter('method'):
        c={x.get('type'):(int(x.get('covered')),int(x.get('missed'))) for x in m.findall('counter')}
        got[(n,m.get('name'))]=c.get('LINE',(0,0))
parts=[]
for k in want:
    cv,ms=got[k]; parts.append(f"{k[1]} {cv}/{cv+ms}")
print("  JaCoCo lines covered: " + " · ".join(parts[:4]))
print("                        " + parts[4] + " · " + parts[5] + " (throw never runs) · " + parts[6] + " (nested map/list + rejection never run)")
PY
echo
echo "${B}R1-7 allocation${R}  ${D}(ThreadMXBean, 3 JVM runs byte-identical; B = copy() skips the re-freeze of its own fields)${R}"
python3 - <<'PY'
import re
rows={}
cur=None
for line in open('/root/verify/pr12391-harness/logs/alloc.log'):
    m=re.match(r'arm=(\S+)',line)
    if m: cur=m.group(1)[0]; continue
    m=re.match(r'\s+(.*?) : ([\d,]+) B/(call|settle)',line)
    if m:
        k=m.group(1).replace('renewDispatch x2000, ','renew,  ').replace('settle (withResult + CAS) x500, ','settle, ').replace(' reference',' reference').strip()
        rows.setdefault(k,{})[cur]=int(m.group(2).replace(',',''))
for k,v in rows.items():
    a,b=v['A'],v['B']
    print(f"  {k:28s} PR {a:>11,} B/op   B-arm {b:>11,} B/op   redundant {100*(a-b)/a:5.2f}%")
PY
