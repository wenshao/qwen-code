#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): run the UI screenshots once the round-6 sequence has released the rig ports.
until grep -q SEQ6-DONE /root/v13163/rig/out/seq6.log 2>/dev/null; do sleep 10; done
bash /root/v13163/rig/ui6.sh; echo "UI6 rc=$? $(date -u +%T)" >> /root/v13163/rig/out/seq6.log
