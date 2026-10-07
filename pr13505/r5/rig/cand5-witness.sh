#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505 round 5): candidate witnesses — baseline green, each mutant red.
set -u
R=/Users/wenshao/git/pr13505-rig; W=/Users/wenshao/git/pr13505-cand5; O=$R/results/cand6-witness.tsv; : > $O
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH TZ=UTC
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
TR=packages/core/src/managed-runtime/managed-child-run-record.ts
TA=packages/core/src/managed-runtime/managed-session-authority.ts
JR=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.java
JS=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecordStore.java
ts() { (cd $W/packages/core && npx vitest run src/managed-runtime/managed-child-run-record.test.ts src/managed-runtime/managed-session-authority.child-agent.test.ts > $R/logs/cand6-w-$1.log 2>&1); echo "$? $(grep -E '^ +Tests ' $R/logs/cand6-w-$1.log | tr -s ' ')"; }
jv() { (cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -o -Dmaven.repo.local=$R/m2 -Dcheckstyle.skip -Dspotbugs.skip -Dtest=ManagedExtensionRecordStoreTest,ManagedChildRunRecordContractTest -Dsurefire.failIfNoSpecifiedTests=false test > $R/logs/cand6-w-$1.log 2>&1); echo "$? $(grep -E 'Tests run: [0-9]+, Failures' $R/logs/cand6-w-$1.log | tail -1)"; }
mut() { python3 - "$W/$1" "$2" "$3" <<'PY'
import sys; p,old,new=sys.argv[1:4]; s=open(p).read(); assert s.count(old)==1, (p, s.count(old)); open(p,'w').write(s.replace(old,new))
PY
}
printf 'ts\tbaseline\t%s\n' "$(ts base)" | tee -a $O
mut $TA 'child.depth === 1 &&' ''; printf "ts\tdepth-qualifier dropped\t%s\n" "$(ts tsdepth)" | tee -a $O; git -C $W checkout -- $TA
mut $TR '/^[A-Za-z]:/.test(value)' '/[A-Za-z]:/.test(value)'; printf 'ts\tdrive test unanchored\t%s\n' "$(ts unanchored)" | tee -a $O; git -C $W checkout -- $TR
printf 'java\tbaseline\t%s\n' "$(jv base)" | tee -a $O
mut $JS '                    || record.get("depth").longValue() != 1
' ''; printf 'java\tdepth-qualifier dropped\t%s\n' "$(jv depth)" | tee -a $O; git -C $W checkout -- $JS
mut $JR '!DRIVE_SPEC.matcher(value).lookingAt()' '!DRIVE_SPEC.matcher(value).find()'; printf 'java\tdrive find() for lookingAt()\t%s\n' "$(jv find)" | tee -a $O; git -C $W checkout -- $JR
git -C $W status --short
