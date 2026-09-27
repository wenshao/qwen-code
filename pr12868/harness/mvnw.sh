#!/bin/bash
# Isolated Maven: JDK 21 + private local repository.
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=$JAVA_HOME/bin:/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
SCRATCH=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad
exec /Users/wenshao/Install/maven/bin/mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SCRATCH/m2 "$@"
