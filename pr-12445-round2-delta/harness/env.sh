export JAVA_HOME=${JAVA_HOME:?point JAVA_HOME at a JDK 21}
export PATH=$JAVA_HOME/bin:$PATH
export FJ=${M2_REPO:-$HOME/.m2/repository}/com/alibaba/fastjson2/fastjson2/2.0.60/fastjson2-2.0.60.jar
export H2=${M2_REPO:-$HOME/.m2/repository}/com/h2database/h2/2.3.232/h2-2.3.232.jar
export MYSQLJ=${M2_REPO:-$HOME/.m2/repository}/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar
export PROTO=$(ls ${M2_REPO:-$HOME/.m2/repository}/com/google/protobuf/protobuf-java/*/protobuf-java-*.jar 2>/dev/null | head -1)
# build classpath for a given tree: cp_for <tree>
cp_for() { echo "$1/packages/sdk-java/runtime-broker/target/classes:$FJ:$H2:$MYSQLJ"; }
