#!/bin/bash
# usage: run-it.sh <arm>  -- HostedPublicWorkspaceIT against the private MySQL, CI recipe narrowed to one class
A=$1; RIG=/Users/wenshao/pr13674-rig; W=$RIG/src-$A; M2=${IT_M2:-$RIG/m2-$A}; CLI=${IT_CLI:-$W/dist/cli.js}
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
DB=hosted_it_$A
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql --protocol=tcp -h127.0.0.1 -P13674 -uroot -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB"
cd $W/packages/sdk-java/managed-agent-server
/Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=$M2 -Phosted-harness-mysql \
  -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false \
  -Dit.test="HostedPublicWorkspaceIT#publicForegroundShellUsesMandatoryApprovalOnBothSurfaces" -Dnode.executable="$(command -v node)" -Dqwen.cli.entry="$CLI" \
  -Dmysql.url="jdbc:mysql://127.0.0.1:13674/$DB?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password= \
  verify > $RIG/out/it-$A${IT_TAG:-}.log 2>&1
echo "[$A${IT_TAG:-}] it exit=$?"
grep -E "Tests run:|FAILURE|ERROR\]|PUBLIC_FG6F" $RIG/out/it-$A${IT_TAG:-}.log | head -30
