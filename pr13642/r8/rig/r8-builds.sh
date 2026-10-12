#!/bin/bash
# round 8: base = main da224e61, main2 = trial merge 6f5f7f6a + da224e61 (8b72c287)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
for a in base main2; do ( rm -rf $S/wt-$a/packages/sdk-java/*/target; $S/build-arm.sh $a > $S/build-r8-$a.out 2>&1; echo "build $a exit=$?" ) & done
wait
cp $S/wt-base/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $S/jars/main-r8-da224e61.jar
cp $S/wt-main2/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $S/jars/merge-r8-8b72c287.jar
ls -la $S/jars/*r8*
echo BUILDS-DONE
