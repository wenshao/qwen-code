#!/bin/bash
# usage: fingerprint.sh <kind> [wt] [m2] -- print a hash of the artifact a mutant kind changes
SP=<rig>
KIND=$1; WT=${2:-wt-mut}; M2=${3:-m2-mut}
case $KIND in
  ts) find $SP/$WT/dist -name '*.js' -type f | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12 ;;
  broker) J=$SP/$M2/com/alibaba/qwen-managed-runtime-broker/0.1.0-alpha/qwen-managed-runtime-broker-0.1.0-alpha.jar; unzip -v "$J" | grep -E "/RuntimeBrokerService.class|/ToolExecutionRecord.class" | awk '{print $7}' | tr '\n' '-' | cut -c1-17 ;;
  server) find $SP/$WT/packages/sdk-java/managed-agent-server/target/classes -name 'WorkspaceRuntimeTransport*.class' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12 ;;
esac
