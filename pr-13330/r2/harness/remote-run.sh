#!/bin/bash
# usage: run.sh <tree-name>   (tree under r2/trees; nc-r3 resolves the c096be36-era broker jars)
name=$1; R=/root/pr13330-verify
tail=$R/r2/m2local-r2
[ "$name" = nc-r3 ] && tail=$R/m2local
docker run --rm --name pr13330r2-$name --network host --cpus=3 --memory=5g \
  -v /root/.m2/repository:/m2home:ro -v $R:$R -v /etc/machine-id:/etc/machine-id:ro \
  -w $R/r2/trees/$name/packages/sdk-java/managed-agent-server maven:3.9.11-eclipse-temurin-21 \
  mvn --batch-mode --no-transfer-progress -s $R/settings.xml \
  -Dmaven.repo.local=$R/r2/m2dl -Dmaven.repo.local.tail=$tail,/m2home \
  -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true test > $R/r2/logs/$name.log 2>&1
echo EXIT=$? >> $R/r2/logs/$name.log
