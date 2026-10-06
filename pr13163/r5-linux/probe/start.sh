#!/bin/bash
# VERIFICATION RIG ONLY: start model+tap, Harness and Spring for one arm.  usage: start.sh <db> <jar> <dist>
R=/root/v13163/rig; DB=$1; JAR=$2; D=$3
bash $R/aux.sh $DB
bash $R/harness.sh $DB $D
DIST=$D bash $R/spring.sh $JAR $DB
