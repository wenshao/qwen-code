#!/bin/bash
# For every storage the base run's HostedWorkspaceToolTurnIT registered, compare the probes' old lookup
# (storage_key = sha256(tenant + "\0storage-N"), no domain tag / no length prefixes) with the PR's alias join.
DB=${1:-it_base_full}; OUT=/root/pr14131-rig/probe/alias-probe-$DB.txt
q() { docker exec pr14131-db mysql -uroot -phosted-fixture -N -B $DB -e "$1" 2>/dev/null; }
{
echo "db=$DB  rows in ma_storage for hosted-tools-* tenants: $(q "SELECT COUNT(*) FROM ma_storage WHERE tenant_id LIKE 'hosted-tools-%'")"
printf "%-48s %-10s %-14s %-14s %-9s %-9s\n" tenant storage alias_key old_key old_hits join_hits
q "SELECT tenant_id, storage_id, alias_key FROM ma_storage WHERE tenant_id LIKE 'hosted-tools-%' ORDER BY tenant_id, storage_id" |
while IFS=$'\t' read -r t s alias; do
  old=$(printf '%s\0%s' "$t" "$s" | sha256sum | cut -d' ' -f1)
  oh=$(q "SELECT COUNT(*) FROM ma_storage_owner WHERE storage_key = '$old'")
  jh=$(q "SELECT COUNT(*) FROM ma_storage_owner o JOIN ma_storage s ON s.physical_key = o.storage_key WHERE s.alias_key = '$alias' AND s.tenant_id = '$t' AND s.storage_id = '$s'")
  printf "%-48s %-10s %-14s %-14s %-9s %-9s\n" "$t" "$s" "${alias:0:12}.." "${old:0:12}.." "$oh" "$jh"
done
} | tee $OUT
