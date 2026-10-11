#!/bin/bash
# usage: rerun-it.sh <worktree> <mvn-wrapper> <tag> <Class#method> <reps>  (deps must already be installed in the wrapper's repo)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad; W=$1; M=$2; TAG=$3; T=$4; N=${5:-3}
cd $W/packages/sdk-java/managed-agent-server || exit 1; echo "# $T at $(git rev-parse --short HEAD), $N reps"
for i in $(seq 1 $N); do
  $M -Pmysql-integration -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test="$T" -Dfailsafe.failIfNoSpecifiedTests=false \
    "-Dmysql.url=jdbc:mysql://127.0.0.1:13654/p654rr$i?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig13654 \
    -Dcheckstyle.skip=true -Dspotbugs.skip=true verify > $S/r5/rerun-$TAG-$i.log 2>&1
  echo "rep $i exit=$? load=$(uptime | sed 's/.*averages: //' | cut -d' ' -f1) :: $(grep -E 'Tests run:.*in com' $S/r5/rerun-$TAG-$i.log | sed 's/.*Tests run/Tests run/' | cut -c1-120)"
done
