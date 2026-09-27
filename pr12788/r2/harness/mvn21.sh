#!/bin/bash
# usage: mvn21.sh <module dir> <mvn args...>
S=${WORKDIR:?set WORKDIR to the scratch directory}
export JAVA_HOME=$(cd $HOME/Install/jdk21 && pwd -P)
[ -d "$JAVA_HOME/Contents/Home" ] && export JAVA_HOME="$JAVA_HOME/Contents/Home"
export PATH=$JAVA_HOME/bin:$HOME/Install/maven/bin:$PATH
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
D=$1; shift
cd "$D" && mvn -B -ntp -s $S/settings.xml -Dmaven.repo.local=${M2:-$S/m2-head} "$@"
