#!/bin/bash
R=/Users/wenshao/git/pr13349-rig
cd $R
./run-one.sh head-exhaust-2 exhaust head
./run-one.sh base-exhaust-2 exhaust base
./run-one.sh head-inflight-1 inflight head
./run-one.sh base-inflight-1 inflight base
./run-one.sh head-rollforward-1 rollforward head
./run-one.sh base-rollforward-1 rollforward base
./run-one.sh head-storeoutage-1 storeoutage head
./run-one.sh base-storeoutage-1 storeoutage base
./run-one.sh head-exhaust-3 exhaust head
./run-one.sh base-exhaust-3 exhaust base
./run-one.sh base-control-1 control base
echo BATCH1-DONE
