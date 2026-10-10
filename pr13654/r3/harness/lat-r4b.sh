#!/bin/bash
R=$(cd $(dirname $0); pwd)
$R/r4.sh UP
DB1=p654r4b DB2=p654r4a PLOG=paired-r4b PB=pr4c N0=44 $R/paired2.sh "M X"
echo "lat-r4b done $(date +%T)" >> $R/out/paired-r4b.log
