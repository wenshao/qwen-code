#!/usr/bin/env python3
"""PR #13497 mutation matrix. Each mutant is one exact, unique string
replacement in one file of the PR; the runner restores the file after each."""
import json
import sys

BASE = "packages/sdk-java/managed-agent-server/src/main/"
STORE = BASE + "java/com/alibaba/qwen/code/managedagent/store/"
DEL = STORE + "JdbcChannelDeliveryRepository.java"
ROUTE = STORE + "JdbcChannelRouteRepository.java"
DREPO = STORE + "ChannelDeliveryRepository.java"
RREPO = STORE + "ChannelRouteRepository.java"
MIG = BASE + "resources/db/migration/V47__managed_channel_route_delivery.sql"

MUTANTS = [
    ("M01", "delivery transition drops the stored-state CAS", DEL,
     '''                        + " AND delivery_id = ? AND state = ?",
                state, providerReceipt, databaseNow(), tenantId,
                channelInstanceId, deliveryId, expectedState);''',
     '''                        + " AND delivery_id = ?",
                state, providerReceipt, databaseNow(), tenantId,
                channelInstanceId, deliveryId);'''),
    ("M02", "delivery cursor includes its own row (< to <=)", DEL,
     '''+ " AND delivery_id < ?)";''', '''+ " AND delivery_id <= ?)";'''),
    ("M03", "delivery listing drops the id tiebreak", DEL,
     '''" ORDER BY created_at DESC, delivery_id DESC LIMIT ?"''',
     '''" ORDER BY created_at DESC LIMIT ?"'''),
    ("M04", "delivery findOrCreate drops the segment check", DEL,
     '''                || !row.segmentId().equals(candidate.segmentId())
                || row.ordinal() != candidate.ordinal()) {''',
     '''                ) {'''),
    ("M05", "delivery replay ignores the receipt", DEL,
     '''&& (providerReceipt == null || providerReceipt.equals(
                        row.providerReceipt()))).orElse(null);''',
     ''').orElse(null);'''),
    ("M06", "isLegalStep admits non-channel states", DREPO,
     '''        return DELIVERY_STATES.contains(to)
                && ManagedExtensionRecords''',
     '''        return ManagedExtensionRecords'''),
    ("M07", "route admit drops the staged guard", ROUTE,
     '''                        + " WHERE tenant_id = ? AND route_key = ?"
                        + " AND state = 'staged'",''',
     '''                        + " WHERE tenant_id = ? AND route_key = ?",'''),
    ("M08", "route cursor includes its own row (< to <=)", ROUTE,
     '''+ " AND route_key < ?)";''', '''+ " AND route_key <= ?)";'''),
    ("M09", "route listing drops the key tiebreak", ROUTE,
     '''" ORDER BY created_at DESC, route_key DESC LIMIT ?"''',
     '''" ORDER BY created_at DESC LIMIT ?"'''),
    ("M10", "routeKey drops the separator check", RREPO,
     '''        if (tenantId.contains(SEPARATOR) || channelInstanceId.contains(
                SEPARATOR) || platformEventId.contains(SEPARATOR)) {''',
     '''        if (false) {'''),
    ("M11", "null receipt erases the stored receipt", DEL,
     '''" state = ?, provider_receipt = COALESCE(?,"
                        + " provider_receipt), updated_at = ?"''',
     '''" state = ?, provider_receipt = ?,"
                        + " updated_at = ?"'''),
    ("M12", "route create drops the admitted/inputId pairing", ROUTE,
     '''        if ("admitted".equals(candidate.state())
                == (candidate.inputId() == null)) {''',
     '''        if (false) {'''),
    ("M13", "delivery hasMore off by one (> to >=)", DEL,
     '''boolean hasMore = rows.size() > limit;
        return new DeliveryPage(''',
     '''boolean hasMore = rows.size() >= limit;
        return new DeliveryPage('''),
    ("M14", "delivery find ignores the tenant", DEL,
     '''                        + " FROM qwen_managed_channel_delivery"
                        + " WHERE tenant_id = ? AND channel_instance_id = ?"
                        + " AND delivery_id = ?",''',
     '''                        + " FROM qwen_managed_channel_delivery"
                        + " WHERE (tenant_id = ? OR 1 = 1) AND channel_instance_id = ?"
                        + " AND delivery_id = ?",'''),
    ("M15", "route listing ignores the tenant", ROUTE,
     '''                        + " FROM qwen_managed_channel_route"
                        + " WHERE tenant_id = ? AND channel_instance_id = ?" + cursor''',
     '''                        + " FROM qwen_managed_channel_route"
                        + " WHERE (tenant_id = ? OR 1 = 1) AND channel_instance_id = ?" + cursor'''),
    ("M16", "both tables lose COLLATE utf8mb4_bin", MIG,
     None, None),
    ("M17", "databaseNow drops the milliseconds", DEL,
     '''                        Math.multiplyExact(row.getLong(1), 1000),
                        row.getLong(2) / 1000));''',
     '''                        Math.multiplyExact(row.getLong(1), 1000),
                        0L));'''),
    ("M18", "route admit replay ignores the input id", ROUTE,
     '''&& inputId.equals(row.inputId())).orElse(null);''',
     ''').orElse(null);'''),
    ("M19", "delivery create admits a non-planned start", DEL,
     '''        if (!"planned".equals(candidate.state())) {''',
     '''        if (false) {'''),
]


def apply(root, mutant_id):
    for mid, _desc, path, old, new in MUTANTS:
        if mid != mutant_id:
            continue
        full = root + "/" + path
        text = open(full, encoding="utf-8").read()
        if mid == "M16":
            n = text.count(" COLLATE utf8mb4_bin")
            if n != 2:
                sys.exit(f"{mid}: expected 2 COLLATE clauses, found {n}")
            text = text.replace(" COLLATE utf8mb4_bin", "")
        else:
            n = text.count(old)
            if n != 1:
                sys.exit(f"{mid}: anchor found {n} times in {path}")
            text = text.replace(old, new)
        open(full, "w", encoding="utf-8").write(text)
        print(path)
        return
    sys.exit(f"unknown mutant {mutant_id}")


if __name__ == "__main__":
    if sys.argv[1] == "list":
        for mid, desc, path, _o, _n in MUTANTS:
            print(f"{mid}\t{path}\t{desc}")
    else:
        apply(sys.argv[2], sys.argv[1])
