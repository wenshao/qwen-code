#!/bin/bash
# usage: getexec.sh <execId> <harness> <runtimeSession> [brokerPort]
curl -s -w ' HTTP=%{http_code}\n' -H 'Authorization: Bearer pr13642-broker-token-0123456789abcdef' "http://127.0.0.1:${4:-18643}/internal/runtime-broker/v1/executions/$1?requestId=r-$RANDOM&harnessSessionId=$2&runtimeSessionId=$3"
