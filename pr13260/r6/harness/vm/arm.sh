#!/bin/bash
# inside VM: run one scenario arm against a jar label.  usage: arm.sh <label> <tag> <script> <storages> [extra env file keys...]
set -u
L=$1; TAG=$2; SCRIPT=$3; STS=$4; shift 4
sudo rm -rf /srv/w1c-bundles/*
export TAG MAINT_JAR=/opt/w1c/$L-server.jar MIG_JAR=/opt/w1c/$L-server-workspace-migration.jar BUNDLE_JAR=/opt/w1c/$L-server-workspace-bundle.jar
exec bash /Users/wenshao/pr13260-rig/vm/run.sh w1c_${TAG//-/_} $SCRIPT STORAGES=$STS JAR=$L-server.jar "$@"
