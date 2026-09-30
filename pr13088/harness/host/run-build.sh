#!/bin/bash
# macOS host: build jars for the given labels inside the VM's Java 21 container.
RIG=/rig
for L in "$@"; do
  $RIG/dk.sh run --rm --network host -v $RIG:/rig -v $RIG/m2:/root/.m2/repository pr12865-linux:latest bash /rig/build.sh src-$L $L
done
