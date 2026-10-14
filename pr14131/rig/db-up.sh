#!/bin/bash
# MySQL 8.4 for the rig: tmpfs datadir, binlog off (it fills tmpfs), 3g cap, private network.
docker network inspect pr14131net >/dev/null 2>&1 || docker network create pr14131net >/dev/null
docker run -d --name pr14131-db --network pr14131net --memory 3g -e MYSQL_ROOT_PASSWORD=hosted-fixture \
  --mount type=tmpfs,destination=/var/lib/mysql docker.m.daocloud.io/library/mysql:8.4 --disable-log-bin >/dev/null && echo "db started"
for i in $(seq 1 90); do docker exec pr14131-db mysql -uroot -phosted-fixture -e "SELECT 1" >/dev/null 2>&1 && docker logs pr14131-db 2>&1 | grep -q "ready for connections.*port: 3306" && { echo "db ready after ${i}x2s"; break; }; sleep 2; done
docker exec pr14131-db mysql -uroot -phosted-fixture -N -e "SELECT VERSION()" 2>/dev/null
