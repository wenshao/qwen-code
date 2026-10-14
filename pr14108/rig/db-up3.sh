#!/bin/bash
# usage: db-up3.sh <lane> <cpuset>  -- MySQL 8.4 on tmpfs, binlog off (it piled up in tmpfs and OOM-killed the first DB), 4g cap
L=$1; C=$2
docker network inspect pr14108net >/dev/null 2>&1 || docker network create pr14108net >/dev/null
docker run -d --name pr14108-db-$L --network pr14108net --cpuset-cpus $C --memory 4g -e MYSQL_ROOT_PASSWORD=hosted-fixture \
  --mount type=tmpfs,destination=/var/lib/mysql docker.m.daocloud.io/library/mysql:8.4 --disable-log-bin >/dev/null && echo "db $L started"
for i in $(seq 1 90); do docker exec pr14108-db-$L mysql -uroot -phosted-fixture -e "SELECT 1" >/dev/null 2>&1 && docker logs pr14108-db-$L 2>&1 | grep -q "ready for connections.*port: 3306" && { echo "db $L ready after ${i}x2s"; break; }; sleep 2; done
