SP=${SCRATCH:?set SCRATCH to the directory holding wt-*, m2, jars and empty-settings.xml}
export JAVA_HOME=$HOME/Install/jdk21
export PATH=$JAVA_HOME/bin:$HOME/Install/maven/bin:$PATH
MVN=(mvn --batch-mode --no-transfer-progress -o -s $SP/empty-settings.xml -Dmaven.repo.local=$SP/m2)
