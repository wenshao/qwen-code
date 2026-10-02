// PR #13090 mutants on the collector change. Each anchor must match exactly once (fail closed).
export const FILE = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationCollector.java';
export const MUTANTS = [
  ['J1', 'candidate scan back to LIMIT 1', '+ " ORDER BY gc_next_at, scope_key, publication_id LIMIT 32"', '+ " ORDER BY gc_next_at, scope_key, publication_id LIMIT 1"'],
  ['J2', 'grace wait back to now + 60 s', 'next = Math.addExact(retiredAt, grace.toMillis());', 'next = now + CLAIM_MILLIS;'],
  ['J3', 'grace wait = retired_at (no grace)', 'next = Math.addExact(retiredAt, grace.toMillis());', 'next = retiredAt;'],
  ['J4', 'grace wait restarts at now + grace', 'next = Math.addExact(retiredAt, grace.toMillis());', 'next = Math.addExact(now, grace.toMillis());'],
  ['J5', 'no defer after mid-page claim loss', '                    defer(claim);\n                    return false;', '                    return false;'],
  ['J6', 'always probe OSS (inline-only too)', 'if (page.stream().anyMatch(object -> object.key() != null)) {', 'if (true) {'],
  ['J7', 'never probe OSS at page level', 'if (page.stream().anyMatch(object -> object.key() != null)) {', 'if (false) {'],
  ['J8', 'probe only all-key pages (anyMatch->allMatch)', 'if (page.stream().anyMatch(object -> object.key() != null)) {', 'if (page.stream().allMatch(object -> object.key() != null)) {'],
  ['J9', 'claims every candidate, returns the last', '            if (claim != null) {\n                return claim;\n            }', '            if (claim != null && candidate == candidates.getLast()) {\n                return claim;\n            }'],
  ['J10', 'candidate scan LIMIT 4', '+ " ORDER BY gc_next_at, scope_key, publication_id LIMIT 32"', '+ " ORDER BY gc_next_at, scope_key, publication_id LIMIT 4"'],
  ['J11', 'candidate scan LIMIT 31', '+ " ORDER BY gc_next_at, scope_key, publication_id LIMIT 32"', '+ " ORDER BY gc_next_at, scope_key, publication_id LIMIT 31"'],
  ['J12', 'candidate scan LIMIT 1000', '+ " ORDER BY gc_next_at, scope_key, publication_id LIMIT 32"', '+ " ORDER BY gc_next_at, scope_key, publication_id LIMIT 1000"'],
];
