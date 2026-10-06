#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): Harness mutants for d7aa13aa (+ P1/P2) at 13df2a65 in a hardlinked tree.
cd /root/v13163/rig/probe && TS_TREE=/root/v13163/tsmut6 /usr/bin/node tsmut14.mjs C0 N1 N2 N3 N4 N5 P1 P2 > /root/v13163/out/tsmut6-ledger.txt 2>&1
