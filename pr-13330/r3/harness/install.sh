#!/bin/bash
# usage: install.sh <arm>   -> installs qwencode + runtime-broker (with test-jar), compiles managed-agent-server tests
arm=$1; R=/root/pr13330-r3; L=$R/logs/install-$arm.log
{ $R/mvn.sh $arm qwencode 3 4g -DskipTests install && \
  $R/mvn.sh $arm runtime-broker 3 4g -DskipTests install && \
  $R/mvn.sh $arm managed-agent-server 3 4g -DskipTests test-compile; echo EXIT=$?; } > $L 2>&1
