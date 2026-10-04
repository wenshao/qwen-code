#!/bin/bash
# macOS host: run something in the dedicated VM's Linux container (Ubuntu 24.04, JDK 21, Node 24, MySQL 8.0).
RIG=/Users/wenshao/pr13350-rig
exec docker --context colima-pr13083 run --rm --init --network host -v $RIG:/rig -v /Users/wenshao/pr13083-rig/m2:/root/.m2/repository "$@"
