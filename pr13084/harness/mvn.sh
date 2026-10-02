#!/bin/bash
export JAVA_HOME=$HOME/Install/jdk21
exec $HOME/Install/maven/bin/mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=${M2:-/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/m2} "$@"
