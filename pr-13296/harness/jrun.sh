#!/bin/bash
# runs a command in the CI-parity JDK 21 container with the same mounts as mvnd.sh
exec docker run --rm --network host -v /root/.m2:/root/.m2:ro -v /root/verify/pr13296/m2local:/m2local \
  -v /etc/machine-id:/etc/machine-id:ro -v /root/verify/pr13296:/root/verify/pr13296 -w /root/verify/pr13296 \
  eclipse-temurin:21-jdk "$@"
