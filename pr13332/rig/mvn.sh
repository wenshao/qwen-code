#!/bin/bash
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH="$JAVA_HOME/bin:$PATH"
exec /Users/wenshao/Install/maven/bin/mvn -s /Users/wenshao/git/pr13332-rig/empty-settings.xml -Dmaven.repo.local=/Users/wenshao/git/pr13332-rig/m2 "$@"
