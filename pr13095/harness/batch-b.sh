#!/bin/bash
# Serial batch on the private MySQL / MariaDB: counter repeats, stability repeats, merge tree, MariaDB.
RIG=/Users/wenshao/pr13095-rig
printf 'LOG=\nFAULT=\n' > $RIG/probe/ctl
echo "== counted repeats"
for i in 2 3; do $RIG/scripts/counted.sh wt-base-it base-$i; $RIG/scripts/counted.sh wt head-$i; done
echo "== head repeats on MySQL"
for i in 1 2 3 4 5 6 7 8; do $RIG/scripts/it.sh wt rep-head-mysql-$i mysql | head -1; done
echo "== merge tree (6a602cde + main 3b18cfe5) on MySQL, its own bundle and m2"
for i in 1 2; do CLI=$RIG/wt-merge/dist/cli.js M2=m2-merge $RIG/scripts/it.sh wt-merge merge-mysql-$i mysql | head -1; done
echo "== MariaDB 10.11.18"
$RIG/scripts/it.sh wt-base-it base-mariadb-1 mariadb | head -1
for i in 1 2; do $RIG/scripts/it.sh wt head-mariadb-$i mariadb | head -1; done
CLI=$RIG/wt-merge/dist/cli.js M2=m2-merge $RIG/scripts/it.sh wt-merge merge-mariadb-1 mariadb | head -1
echo "BATCH-B-DONE"
