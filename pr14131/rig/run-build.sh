#!/bin/bash
R=/root/pr14131-rig
docker run --rm --name pr14131-build --network host --memory 7g --memory-swap 7g \
  -v /root:/root qwen-managed-e2e:u24 bash $R/build.sh
echo "container exit=$?" >> $R/out/build-base.log
