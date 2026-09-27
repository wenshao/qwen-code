mvn --batch-mode --no-transfer-progress -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install
