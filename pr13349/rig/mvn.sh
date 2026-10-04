#!/bin/bash
# usage: mvn.sh <arm> <mvn args...>  -- per-arm isolated local repo so the base
# server jar can never bundle the head SDK (or vice versa).
arm=$1; shift
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH="$JAVA_HOME/bin:$PATH"
exec /Users/wenshao/Install/maven/bin/mvn -s /Users/wenshao/git/pr13349-rig/empty-settings.xml -Dmaven.repo.local=/Users/wenshao/git/pr13349-rig/m2-$arm "$@"
