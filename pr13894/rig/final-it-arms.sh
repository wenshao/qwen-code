#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b690e0a7-ea85-4f4c-a5cb-402948583da3/scratchpad
export JAVA_HOME=~/Install/jdk21
mkdir -p $S/results/it-final
for db in mysql mariadb; do
  if [ $db = mysql ]; then URL="jdbc:mysql://127.0.0.1:23894/mysql?allowPublicKeyRetrieval=true&useSSL=false"; U=rig; P=rig;
  else URL="jdbc:mysql://127.0.0.1:33894/mysql?allowPublicKeyRetrieval=true&useSSL=false"; U=root; P=<throwaway-root-password>; fi
  for arm in base head; do
    if [ $arm = base ]; then W=~/git/qwen-code-pr13894-base; else W=~/git/qwen-code-pr13894; fi
    (cd $W/packages/sdk-java/managed-agent-server && rm -rf target/surefire-reports && mvn -o -B -Dmaven.repo.local=$S/m2 -Dcheckstyle.skip -Dspotbugs.skip=true -Djacoco.skip=true -Dmaven.test.failure.ignore=true test \
      -Dtest='ToolPublicationLockOrderMySqlIT,ToolPublicationLifecycleMySqlIT' -Dsurefire.failIfNoSpecifiedTests=false \
      "-Dmysql.url=$URL" -Dmysql.user=$U -Dmysql.password=$P > $S/results/it-final/$arm-$db.log 2>&1
     rm -rf $S/results/it-final/$arm-$db-reports; cp -R target/surefire-reports $S/results/it-final/$arm-$db-reports)
    echo "$arm $db: $(grep -E '^\[(INFO|ERROR|WARNING)\] Tests run:' $S/results/it-final/$arm-$db.log | tail -1)"
  done
done
