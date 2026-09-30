# sourced by every rig script: CI-equivalent toolchain (Java 21), private m2, UTC on both JVM and DB
export RIG=/Users/wenshao/pr13095-rig
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=$JAVA_HOME/bin:/Users/wenshao/Install/maven/bin:$PATH
export TZ=UTC
export MYSQL_HOME_DIR=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64
export MYSQL_PORT=23195
export NODE_BIN=$(command -v node)
