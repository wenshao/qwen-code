#!/bin/bash
# inside temurin; $1 = mutant dir. Runs the module's three unit-test classes explicitly; main's attestation
# conformance test needs the full repo tree and does not touch the mutated classes.
cd $1/runtime-broker && /opt/maven/bin/mvn -o -q -B -Djacoco.skip=true test -Dtest=JdbcRepositoryTest,InMemoryRepositoryTest,RuntimeBrokerServiceTest > ../suite.log 2>&1
echo $? > ../suite.exit
