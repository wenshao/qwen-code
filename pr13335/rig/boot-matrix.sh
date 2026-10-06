#!/bin/bash
# Boot each scenario on both arms (Spring only), record outcome, warnings, bound values.
R=/Users/wenshao/pr13335-rig
OUT=$R/results/boot-matrix
mkdir -p "$OUT"
declare -a NAMES ENVS
add() { NAMES+=("$1"); ENVS+=("$2"); }
add S0-default ""
add S1-bare-seconds "QWEN_MANAGED_AGENT_DISPATCH_LEASE_DURATION=120 QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION=90 QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE=1800 QWEN_MANAGED_AGENT_RUNTIME_BROKER_V3_RESULT_WINDOW=1800 QWEN_MANAGED_AGENT_TOOL_PUBLICATION_DELETION_GRACE=86400"
add S1c-drift-300 "QWEN_MANAGED_AGENT_AUTH_ALLOWED_DRIFT=300"
add S1b-approval-600 "QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT=600"
add S2-stale-ms "QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE=600000 QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION=60000 QWEN_MANAGED_AGENT_RUNTIME_BROKER_V3_RESULT_WINDOW=300000 QWEN_MANAGED_AGENT_AUTH_ALLOWED_DRIFT=300000 QWEN_MANAGED_AGENT_TOOL_PUBLICATION_DELETION_GRACE=86400000 QWEN_MANAGED_AGENT_DISPATCH_LEASE_DURATION=60000"
add S3-approval-600000 "QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT=600000"
add S4-v3-window-30 "QWEN_MANAGED_AGENT_RUNTIME_BROKER_V3_RESULT_WINDOW=30"
add S5-no-cli-entry "NO_CLI_ENTRY"
add S6-k8s-envs "QWEN_MANAGED_AGENT_KUBERNETES_NAMESPACE=pr13335-ns QWEN_MANAGED_AGENT_KUBERNETES_IMAGE=pr13335/image:1"
add S6b-k8s-provisioner "QWEN_MANAGED_AGENT_RUNTIME_PROVISIONER=kubernetes QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED=false QWEN_MANAGED_AGENT_WORKSPACE_CWD="
add S8-null-default-durations "QWEN_MANAGED_AGENT_TOOL_PUBLICATION_MAX_VERIFICATION_TIMEOUT=300000 QWEN_MANAGED_AGENT_TOOL_PUBLICATION_OPERATION_TIMEOUT=600000 QWEN_MANAGED_AGENT_TOOL_PUBLICATION_CLAIM_TIMEOUT=60000"
add S9-suffixed-small-e2e-values "QWEN_MANAGED_AGENT_DISPATCH_LEASE_DURATION=2s QWEN_MANAGED_AGENT_DISPATCH_LEASE_RENEW_INTERVAL=500ms QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION=1s"
add S10-suffixed-short-timeouts "QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE=2m QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT=30s"
add S7-materialize-250 "QWEN_MANAGED_AGENT_EVENTS_MATERIALIZE_INTERVAL=250"

only="${1:-}"
for i in "${!NAMES[@]}"; do
  name=${NAMES[$i]}; envs=${ENVS[$i]}
  [ -n "$only" ] && [[ "$name" != $only* ]] && continue
  for arm in ${ARMS:-base merge}; do
    tag="boot-$name-$arm"
    extra=(); noce=0
    for kv in $envs; do [ "$kv" = NO_CLI_ENTRY ] && noce=1 || extra+=("$kv"); done
    start=$(date +%s)
    status=$(NO_CLI_ENTRY=$noce "$R/rig/stack.sh" spring $arm "$tag" "${extra[@]}" 2>&1 | grep SPRING_BOOT)
    secs=$(( $(date +%s) - start ))
    RUN=$R/runs/$tag
    S=$(grep ^SPRING= "$RUN/meta.env" | cut -d= -f2)
    {
      echo "scenario=$name arm=$arm env=[$envs]"
      echo "$status (${secs}s)"
      if [[ "$status" == *OK* ]]; then
        curl -s "$S/actuator/configprops" | python3 "$R/rig/props.py"
      else
        python3 "$R/rig/failure.py" "$RUN/spring.log"
      fi
      grep -E 'WARN .*ManagedAgentProperties' "$RUN/spring.log" | sed -E 's/^.*ManagedAgentProperties *: //' | sed 's/^/WARN: /'
      grep -o 'Embedded Runtime Broker listening.*' "$RUN/spring.log" | sed 's/^/LOG: /'
    } > "$OUT/$name.$arm.txt"
    "$R/rig/stack.sh" down "$tag" >/dev/null
    cat "$OUT/$name.$arm.txt"; echo
  done
done
