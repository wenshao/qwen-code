#!/bin/bash
# macOS host: run a command line inside the VM, in the rig's vm directory.
exec colima ssh -p pr12869 -- bash -c "cd /rig/vm && $*"
