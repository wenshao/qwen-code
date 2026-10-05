#!/usr/bin/env python3
"""Exact-string mutants of ToolPublicationCollector.java at PR head (each must match exactly once)."""
import sys, pathlib
SWITCH = '''                        long next = now + switch (observed.blocker()) {
                            case "legacy_write_evidence_missing", "quarantined", "not_accepted_complete",
                                    "recovery_protected" -> PROTECTED_RECHECK_MILLIS;
                            default -> CLAIM_MILLIS;
                        };'''
LABELS = '''"legacy_write_evidence_missing", "quarantined", "not_accepted_complete",
                                    "recovery_protected" ->'''
def drop(label):
    names = ["legacy_write_evidence_missing", "quarantined", "not_accepted_complete", "recovery_protected"]
    kept = ", ".join('"%s"' % n for n in names if n != label)
    return (LABELS, kept + " ->")
M = {
  "M01_revert_to_minute": (SWITCH, "                        long next = now + CLAIM_MILLIS;"),
  "M02_drop_legacy": drop("legacy_write_evidence_missing"),
  "M03_drop_quarantined": drop("quarantined"),
  "M04_drop_not_accepted": drop("not_accepted_complete"),
  "M05_drop_recovery": drop("recovery_protected"),
  "M06_default_also_24h": ("default -> CLAIM_MILLIS;", "default -> PROTECTED_RECHECK_MILLIS;"),
  "M07_interval_23h": ("Duration.ofHours(24).toMillis();", "Duration.ofHours(23).toMillis();"),
  "M08_interval_24h_plus_1min": ("Duration.ofHours(24).toMillis();", "Duration.ofHours(24).plusMinutes(1).toMillis();"),
  "M09_interval_1h": ("Duration.ofHours(24).toMillis();", "Duration.ofHours(1).toMillis();"),
  "M10_drop_grace_override": ('''                        if ("grace_period".equals(observed.blocker())) {''',
                              '''                        if (false && "grace_period".equals(observed.blocker())) {'''),
  "M11_trust_stored_protected_blocker": ('''                    Duration grace = properties.getToolPublication().getDeletionGrace();
                    var observed''', '''                    if (java.util.List.of("legacy_write_evidence_missing", "quarantined", "not_accepted_complete",
                            "recovery_protected").contains(row.get("gc_blocker"))) {
                        jdbc.update("UPDATE qwen_tool_publication SET gc_next_at = ? WHERE scope_key = ? AND publication_id = ?",
                                now + PROTECTED_RECHECK_MILLIS, row.get("scope_key"), row.get("publication_id"));
                        return null;
                    }
                    Duration grace = properties.getToolPublication().getDeletionGrace();
                    var observed'''),
  "M12_collection_retry_24h": ('''                ToolPublicationRetentionStore.now(jdbc) + CLAIM_MILLIS,
                claim.scope()''', '''                ToolPublicationRetentionStore.now(jdbc) + PROTECTED_RECHECK_MILLIS,
                claim.scope()'''),
  "M13_keep_blocker_on_deleting": ('''gc_claim_until = ?, gc_blocker = NULL WHERE scope_key = ? AND publication_id = ?",''',
                                   '''gc_claim_until = ? WHERE scope_key = ? AND publication_id = ?",'''),
  "M14_reader_active_blocker_not_persisted": ('''                                observed.blocker(), next, observed.scope(), observed.publication());''',
      '''                                "reader_active".equals(observed.blocker()) ? null : observed.blocker(), next,
                                observed.scope(), observed.publication());'''),
}
if __name__ == "__main__":
    name, path = sys.argv[1], pathlib.Path(sys.argv[2])
    old, new = M[name]
    src = path.read_text()
    n = src.count(old)
    if n != 1:
        sys.exit(f"{name}: expected 1 occurrence, found {n}")
    path.write_text(src.replace(old, new))
    print(f"{name}: applied")
