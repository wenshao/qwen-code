#!/bin/bash
export JAVA_HOME=$HOME/Install/jdk21
exec $HOME/Install/maven/bin/mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad/${M2:-m2} "$@"
