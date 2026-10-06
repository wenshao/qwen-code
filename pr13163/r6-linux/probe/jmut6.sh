#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): Java mutants for d7aa13aa at 13df2a65, full managed-agent-server suite each.
export JAVA_HOME=/opt/jdk21 PATH=/opt/jdk21/bin:/root/v13163/tools/apache-maven-3.9.9/bin:$PATH
cd /root/v13163/rig/probe && J_TREE=/root/v13163/jmut6/repo/packages/sdk-java M2=/root/v13163/m2-head3 OUT=/root/v13163/out/jmut6 /usr/bin/node javamut14.mjs C0 J1 J2 J3 J4 J5 > /root/v13163/out/jmut6/ledger.txt 2>&1
