#!/bin/bash
# Java mutants of the PR's Broker hunks, run against the whole runtime-broker unit suite (JDK 21, private Maven repo).
set -u
. /rig/rig.env
export JAVA_HOME PATH=$JAVA_HOME/bin:$(dirname $NODE):$PATH TZ=UTC
T=$RIG/wt-mut3/packages/sdk-java/runtime-broker; S=$T/src/main/java/com/alibaba/qwen/code/runtimebroker; O=$RIG/out/mut-java.log; : > $O
run() { (cd $T && mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2-head -Dcheckstyle.skip=true test > $RIG/out/mut-java-$1.console 2>&1); rc=$?; echo "$1 rc=$rc $(grep -a -E '^\[(INFO|ERROR|WARNING)\] Tests run: [0-9]+, F' $RIG/out/mut-java-$1.console | tail -1 | sed -E 's/^\[[A-Z]+\] //') $(grep -a -E '<<< (FAILURE|ERROR)!' $RIG/out/mut-java-$1.console | grep -v 'Tests run' | sed -E 's/^\[[A-Z]+\] //; s/ -- Time.*//' | head -3 | tr '\n' ';')  [$2]" | tee -a $O; }
mut() { id=$1; f=$2; note=$5; cp $S/$f $S/$f.orig; NEEDLE="$3" REPL="$4" perl -0pi -e 'BEGIN{$n=$ENV{NEEDLE};$r=$ENV{REPL}} $c=()=/\Q$n\E/g; die "anchor count $c\n" unless $c==1; s/\Q$n\E/$r/' $S/$f || { echo "$id ANCHOR-FAILED" | tee -a $O; mv $S/$f.orig $S/$f; return; }; run $id "$note"; mv $S/$f.orig $S/$f; }
run BASELINE "unmodified head"
mut J1 HttpRuntimeTransport.java 'if ("history".equals(immutable.get("kind")) || "raw-file-history".equals(immutable.get("kind"))) {' 'if ("history".equals(immutable.get("kind"))) {' 'raw history is forwarded without acquiring a provider session'
mut J2 ProviderRuntimeProtocol.java '&& !harnessSessionId.equals(object(operation.get("state")).get("ownerSessionId"))) {' '&& false) {' 'bind state owner must be the Harness Session'
mut J3 ProviderRuntimeProtocol.java 'if (!sessionId.equals(string(operation, "promptId"))' 'if (false' 'prepare promptId must be the runtime session'
mut J4 ProviderRuntimeProtocol.java '|| paths.isEmpty() || paths.stream().anyMatch(value -> !(value instanceof String))) {' ') {' 'prepare paths must be a non-empty list of strings'
mut J5 ProviderRuntimeProtocol.java 'default -> throw invalid();
                }
            }
            case "manifest", "history"' 'default -> required = Set.of("kind", "action");
                }
            }
            case "manifest", "history"' 'unknown raw-history action is refused'
echo DONE | tee -a $O
