#!/bin/bash
# usage: build-jar.sh <arm>  -- managed-agent-server fat jar (inside u24, private m2), copied to rig/server/<arm>-server.jar
A=$1; R=/root/pr13931-rig
mkdir -p $R/rig/server
docker run --rm --name pr13931-jar-$A --network host -v $R:$R qwen-managed-e2e:u24 bash -c "
  export https_proxy=http://127.0.0.1:10809 http_proxy=http://127.0.0.1:10809
  cd $R/src-$A/packages/sdk-java/managed-agent-server &&
  mvn -B -ntp -s $R/settings.xml -Dmaven.repo.local=$R/m2-$A -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package > $R/out/mvn-server-$A.log 2>&1"
echo "[$A] server package exit=$?"
cp $R/src-$A/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $R/rig/server/$A-server.jar && sha256sum $R/rig/server/$A-server.jar | cut -c1-16
