#!/bin/bash
# usage: mkvariant.sh <name> <prod: base|head> <lease: 1|1.5>
set -euo pipefail
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/2f81e323-488e-421e-ab76-882360719f9e/scratchpad
NAME=$1; PROD=$2; LEASE=$3
PKG=src/main/java/com/alibaba/qwen/code/runtimebroker
TPKG=src/test/java/com/alibaba/qwen/code/runtimebroker
V="${S:?}/head/packages/sdk-java/rb-${NAME:?}"
[ -e "$V" ] && { echo "exists: $V"; exit 1; }
cp -Rc "$S/head/packages/sdk-java/runtime-broker" "$V"
rm -rf "${V:?}/target"
if [ "$PROD" = base ]; then
  for f in JdbcRepositorySupport JdbcRuntimeBindingRepository JdbcToolExecutionRepository; do
    cp "$S/base/packages/sdk-java/runtime-broker/$PKG/$f.java" "$V/$PKG/$f.java"
  done
  cp "$S/base/packages/sdk-java/runtime-broker/$TPKG/JdbcRepositorySupportTest.java" "$V/$TPKG/JdbcRepositorySupportTest.java"
fi
T="$V/$TPKG/ManagedContextRecoveryTest.java"
if [ "$LEASE" = 1 ]; then
  grep -q 'Duration.ofMillis(1500), Duration.ofMillis(1500)' "$T"
  sed -i '' 's/Duration.ofMillis(1500), Duration.ofMillis(1500)/Duration.ofSeconds(1), Duration.ofSeconds(1)/' "$T"
fi
# drop the final closing brace, append probes (which re-close the class)
sed -i '' '$ d' "$T"
cat "$S/probe/inject.java.txt" >> "$T"
echo "variant $NAME: prod=$PROD lease=$LEASE"; grep -n 'UUID.randomUUID().toString(), Duration' "$T"
