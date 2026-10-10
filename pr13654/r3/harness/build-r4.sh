#!/bin/bash
# Round 4 builds. java: head (m2-r2) then base (m2-r2main), sequential. node: head dist then base dist.
R=$(cd $(dirname $0); pwd); H=$HOME/git/qwen-code-pr13654; B=$HOME/git/qwen-code-pr13654-base
case $1 in
java)
  M=$R/mvn-r2.sh; cd $H && $M -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install -q && $M -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install -q && $M -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests clean package -q && cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $R/jars/head4-server.jar && echo "head4 jar ok $(git rev-parse --short HEAD)" || echo "head4 jar FAILED"
  M=$R/mvn-r2main.sh; cd $B && $M -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install -q && $M -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install -q && $M -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests clean package -q && cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $R/jars/base4-server.jar && echo "base4 jar ok $(git rev-parse --short HEAD)" || echo "base4 jar FAILED"
  echo "java done";;
node)
  export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
  for W in $H $B; do cd $W && (npm run build > $R/out/build-r4-$(basename $W).log 2>&1 && npm run bundle >> $R/out/build-r4-$(basename $W).log 2>&1 && echo "dist ok $W $(git rev-parse --short HEAD) $(ls -la dist/cli.js | awk '{print $5,$6,$7,$8}')") || echo "dist FAILED $W"; done
  echo "node done";;
esac
