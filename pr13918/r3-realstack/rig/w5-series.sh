#!/bin/bash
# New head on the dedicated MySQL 8.4.7 (23921): the 7 hold cases whose digests the shared server dropped, then paired bursts.
cd /Users/wenshao/pr13918-rig
export DBPORT=23921
ARMS=r4 bash batch3.sh w5 both:60 placement:20 placement:30 placement:60 publication:20 publication:30 publication:60
bash digest3.sh w5
bash burst3.sh x1 20 40 "r4 b3"
bash burst3.sh x2 20 80 "r4 b3"
echo W5-SERIES-DONE
