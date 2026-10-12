#!/bin/bash
# usage: run-build.sh <arm>  -- build inside qwen-managed-e2e:u24 (Node 22/Java 21, as CI); host network only for the outbound proxy
A=$1; R=/root/pr13931-rig
docker run --rm --name pr13931-build-$A --network host \
  -v $R:$R -v /root/.m2/repository:/seed-m2:ro \
  -v /root/.local/share/pnpm:/root/.local/share/pnpm -v /root/.cache/node:/root/.cache/node \
  qwen-managed-e2e:u24 bash $R/build.sh $A
