#!/bin/bash
cd /Users/wenshao/pr13918-rig
export DBPORT=23920 DBPASS=runtime-broker MYSQL_PWD=runtime-broker
bash burst3m.sh mq3 20 40 r4j
bash burst3m.sh mq3 20 40 b3j
bash burst3m.sh mq4 20 80 r4j
bash burst3m.sh mq4 20 80 b3j
echo MARIA4-BURST-DONE
