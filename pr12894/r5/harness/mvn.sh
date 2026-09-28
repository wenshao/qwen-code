#!/bin/bash
export JAVA_HOME=$HOME/Install/jdk21
exec $HOME/Install/maven/bin/mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/01614b74-ad2d-46ba-bd62-6246811907b8/scratchpad/m2 "$@"
