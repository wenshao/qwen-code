#!/bin/bash
P=$(cd $(dirname $0); pwd)
ITS= $P/run.sh head > $P/run-head.out 2>&1
ITS=",ToolPublicationAsyncVerificationMySqlIT#settledCsiRetirementStillVerifiesAcceptedWork" $P/run.sh revert > $P/run-revert.out 2>&1
ITS=",ToolPublicationAsyncVerificationMySqlIT" $P/run.sh cand3 > $P/run-cand3.out 2>&1
echo "three done $(date +%T)" >> $P/three.log
