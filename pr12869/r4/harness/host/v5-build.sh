#!/bin/bash
# container: builds the server jar from a source tree and compares its contents with a reference jar.
# usage: v5-build.sh <tree> <jar name> [reference jar]
set -u
TREE=$1; JAR=$2; REF=${3:-}
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/v5; mkdir -p $O
W=/w-$TREE; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean install > $O/$TREE-build.log 2>&1)
(cd $SJ/managed-agent-server && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true clean package >> $O/$TREE-build.log 2>&1 && cp target/qwen-managed-agent-server-0.1.0-alpha.jar /rig/server/$JAR)
echo "[build] $JAR $(stat -c %s /rig/server/$JAR 2>/dev/null) bytes  sha256 $(sha256sum /rig/server/$JAR | cut -c1-16)"
if [ -n "$REF" ]; then
  listing() { # <jar> <dir>: sha256 of every entry, nested project jars opened
    rm -rf $2 && mkdir -p $2 && (cd $2 && jar xf /rig/server/$1)
    for nested in $2/BOOT-INF/lib/qwen-managed-runtime-broker-*.jar $2/BOOT-INF/lib/qwencode-*.jar; do
      [ -f "$nested" ] || continue; d=$nested.d; mkdir -p $d && (cd $d && jar xf $nested) && rm $nested
    done
    (cd $2 && find . -type f ! -name MANIFEST.MF ! -name 'pom.properties' ! -name 'build-info.properties' ! -name '*.idx' -print0 | sort -z | xargs -0 sha256sum)
  }
  listing $JAR /cmp/new > $O/$TREE-entries.txt; listing $REF /cmp/ref > $O/$TREE-entries-ref.txt
  echo "[compare] entries: $(wc -l < $O/$TREE-entries.txt) in $JAR, $(wc -l < $O/$TREE-entries-ref.txt) in $REF"
  echo "[compare] class files: $(grep -c '\.class$' $O/$TREE-entries.txt)"
  if diff $O/$TREE-entries.txt $O/$TREE-entries-ref.txt > $O/$TREE-entries.diff; then echo "[compare] IDENTICAL: every entry has the same sha256"; else echo "[compare] DIFFERENT: $(grep -c '^[<>]' $O/$TREE-entries.diff) lines"; head -20 $O/$TREE-entries.diff; fi
fi
echo BUILD-DONE
