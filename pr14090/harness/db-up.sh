#!/bin/bash
docker network create pr14090net >/dev/null && echo net-ok
docker run -d --name pr14090-db --network pr14090net --memory 2g -e MYSQL_ROOT_PASSWORD=hosted-fixture docker.m.daocloud.io/library/mysql:8.4 >/dev/null && echo db-started
for i in $(seq 1 60); do docker exec pr14090-db mysqladmin ping -uroot -phosted-fixture 2>/dev/null | grep -q alive && { echo "db-alive after ${i}x2s"; break; }; sleep 2; done
