#!/bin/bash
# host-side: run a command inside the rig container.  usage: lxx.sh <cmd...>
exec docker --context colima-pr13673 exec pr13673-lx bash -c "$*"
