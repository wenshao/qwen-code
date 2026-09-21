export JAVA_TOOL_OPTIONS=
H=/root/verify/pr12390-harness
PRCLASSES=/root/verify/pr12390/packages/sdk-java/runtime-broker/target/classes
CP=$PRCLASSES:$H/classes:/root/.m2/repository/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar:/root/.m2/repository/com/h2database/h2/2.3.232/h2-2.3.232.jar
MY=jdbc:mysql://127.0.0.1:33984/runtime_broker_test
MYCST=jdbc:mysql://127.0.0.1:33985/runtime_broker_test
build() { mkdir -p $H/classes && javac --release 21 -nowarn -cp $CP -d $H/classes $H/src/com/alibaba/qwen/code/runtimebroker/*.java; }
