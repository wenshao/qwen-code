#!/bin/bash
# usage: race.sh <arm: head|fix|mut-*> <label> <container> <port> [nodes] [threads] [keys] [churnSeconds]
set -u
H=/root/verify/pr12458-harness; M2=/root/.m2/repository
ARM=$1; LABEL=$2; C=$3; PORT=$4; NODES=${5:-6}; THREADS=${6:-8}; KEYS=${7:-100}; CHURN=${8:-25}
CLI=mysql; [[ $C == *maria* ]] && CLI=mariadb
DB="race_${LABEL//[^a-zA-Z0-9]/_}"
docker exec $C $CLI -uroot -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB"
URL="jdbc:mysql://127.0.0.1:$PORT/$DB?allowPublicKeyRetrieval=true&useSSL=false"
OUT=$H/race/$LABEL; rm -rf $OUT; mkdir -p $OUT/classes
CP=$H/copies/$ARM/runtime-broker/target/classes:$H/copies/$ARM/runtime-broker/target/test-classes:$M2/com/alibaba/fastjson2/fastjson2/2.0.60/fastjson2-2.0.60.jar:$M2/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar
JAVA=/root/verify/pr12458-harness/jdk21/bin
$JAVA/javac -nowarn --release 21 -d $OUT/classes -cp $CP $H/probes/src/com/alibaba/qwen/code/runtimebroker/RaceNode.java 2>&1 | grep -v ^Note
cat > $OUT/Init.java <<J
public class Init { public static void main(String[] a) { com.alibaba.qwen.code.runtimebroker.JdbcRuntimeBrokerSchema.initialize(new com.mysql.cj.jdbc.MysqlDataSource() {{ setURL(a[0]); setUser("root"); setPassword(""); }}); } }
J
$JAVA/javac -nowarn -d $OUT/classes -cp $CP $OUT/Init.java && $JAVA/java -cp $OUT/classes:$CP Init "$URL"
START=$(( $(date +%s%3N) + 6000 ))
echo "### $LABEL ($ARM): $NODES JVMs x $THREADS threads, $KEYS keys, churn ${CHURN}s, server $(docker exec $C $CLI -uroot -N -e 'select version()')"
for n in $(seq 1 $NODES); do
  $JAVA/java -cp $OUT/classes:$CP com.alibaba.qwen.code.runtimebroker.RaceNode "$URL" r1 n$n $START $THREADS $KEYS $CHURN $OUT/n$n.log > $OUT/n$n.stdout 2>&1 &
done
wait
python3 $H/analyze_race.py $OUT $KEYS $C $DB
