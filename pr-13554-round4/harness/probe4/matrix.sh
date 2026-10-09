#!/bin/bash
# usage: matrix.sh <db>
DB=$1; P=/Users/wenshao/pr13554-rig/probe4
$P/run-arm.sh head $DB inflight,gap,collectorFirst,footprint,stress 30
$P/run-arm.sh nofence $DB inflight,gap,collectorFirst,stress 30
$P/run-arm.sh plain $DB inflight,gap,stress 30
$P/run-arm.sh noinval $DB collectorFirst
$P/run-arm.sh noindex $DB footprint
$P/run-arm.sh head $DB recapture
$P/run-arm.sh noinval $DB recapture
echo MATRIX-DONE > /Users/wenshao/pr13554-rig/logs/race/matrix-$DB.done
