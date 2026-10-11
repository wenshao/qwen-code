#!/bin/bash
# IT lifecycle arms (inside the rig container): head, per-test schema (round-4 shape), no truncation.
# Each arm runs SessionResourceCollectionMySqlIT with JUnit's random method order under fixed seeds.
R=/Users/wenshao/pr13554-rig
for db in mariadb mysql84; do
  for arm in it-head it-pertest it-notrunc; do
    for seed in 1 2 3; do
      $R/probe5/run-it.sh $arm m2-x5 SessionResourceCollectionMySqlIT $db "$arm-seed$seed" \
        "-Djunit.jupiter.testmethod.order.default=org.junit.jupiter.api.MethodOrderer\$Random -Djunit.jupiter.execution.order.random.seed=$seed" > /dev/null
    done
  done
done
echo IT-LIFECYCLE-DONE > $R/r5/results/it/lifecycle.done
