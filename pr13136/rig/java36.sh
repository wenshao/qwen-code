#!/bin/bash
# PR #13136: H2 admission-index suite at head, then with the Store's admission change reverted to the base
# (3f56f74a6a) -- parse() stays public so V29 still compiles -- to see which tests pin it.
set -u
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
R=/Users/wenshao/pr13129-rig; W=$R/wt36; O=$R/out/unit36; BASE=3f56f74a6a; M2=$R/m2-head
F=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecordStore.java
mkdir -p $O
run() { # label
  (cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip=true -Dtest=ManagedHookAdmissionIndexTest -Dsurefire.failIfNoSpecifiedTests=false test > $O/java-$1.log 2>&1); local e=$?
  echo "== java-$1 exit=$e $(/usr/bin/grep -E 'Tests run:.*Fail' $O/java-$1.log | tail -1)"
  /usr/bin/grep -E '^\[ERROR\] +[A-Za-z].*(Test|IT)\.' $O/java-$1.log | cut -c1-220 | head -20
}
cd $W && echo "head=$(git rev-parse --short HEAD) dirty=$(git status --porcelain | wc -l | tr -d ' ')"
run head
cd $W && git show $BASE:$F > $F && sed -i '' 's/^    static JsonNode parse(String text) {/    public static JsonNode parse(String text) {/' $F
echo "-- pin store reverted: $(git diff --stat -- $F | tail -1); public parse: $(/usr/bin/grep -c 'public static JsonNode parse' $F)"
run pin-store
cd $W && git checkout HEAD -- $F && echo "   restored, dirty files: $(git status --porcelain | wc -l | tr -d ' ')"
echo JAVA36-DONE
