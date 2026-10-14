#!/bin/bash
bash /rig/scripts/setup75.sh > /rig/setup.out 2>&1 || { echo SETUP_FAILED >> /rig/results/PIPELINE.txt; exit 1; }
bash /rig/scripts/pipeline.sh > /rig/pipeline.log 2>&1
