#!/bin/bash
docker exec pr12865-db mysql -uroot -prootpw ${1:-qwen_managed_agent} -e "SELECT LEFT(binding_id,8) bid, runtime_generation gen, binding_state state, runtime_instance_id rt, runtime_endpoint endpoint, record_version ver, IF(loss_evidence_json IS NULL,'-','present') loss FROM qwen_runtime_binding" 2>/dev/null
