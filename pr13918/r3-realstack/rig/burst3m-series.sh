#!/bin/bash
cd /Users/wenshao/pr13918-rig
export DBPORT=23920 DBPASS=runtime-broker MYSQL_PWD=runtime-broker
bash burst3m.sh mq1 20 40 r3j
bash burst3m.sh mq1 20 40 b3j
bash burst3m.sh mq2 20 80 r3j
bash burst3m.sh mq2 20 80 b3j
echo MARIA-BURST-DONE
