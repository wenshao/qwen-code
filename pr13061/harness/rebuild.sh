#!/bin/bash
# usage: rebuild.sh <kind> [wt] [m2]  -- rebuild the artifact a mutant touches
source <rig>/rig/env.sh
KIND=$1; WT=${2:-wt-mut}; M2=${3:-m2-mut}
cd $SP/$WT
case $KIND in
  ts) (node esbuild.config.js && node scripts/copy_bundle_assets.js) > $SP/logs/rebundle-$WT.log 2>&1 || { echo rebundle failed; tail -20 $SP/logs/rebundle-$WT.log; exit 1; } ;;
  broker) mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$SP/$M2 -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SP/logs/rebroker-$WT.log 2>&1 || { echo broker install failed; tail -30 $SP/logs/rebroker-$WT.log; exit 1; } ;;
  server) : ;;
esac
