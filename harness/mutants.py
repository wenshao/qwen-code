# Each mutant: (id, file, old, new, description)
CLEANUP = 'packages/cli/src/utils/housekeeping/cleanup.ts'
SCHED   = 'packages/cli/src/services/housekeeping/scheduler.ts'

MUTANTS = [
 ('M1', CLEANUP,
  "    if (!entry.isFile() || !entry.name.endsWith(DEBUG_LOG_FILE_SUFFIX)) {",
  "    if (false || !entry.name.endsWith(DEBUG_LOG_FILE_SUFFIX)) {",
  'drop the isFile() guard (symlinks/dirs become sweep candidates)'),

 ('M2', CLEANUP,
  "    if (!entry.isFile() || !entry.name.endsWith(DEBUG_LOG_FILE_SUFFIX)) {",
  "    if (!entry.isFile() || false) {",
  'drop the .txt suffix guard'),

 ('M3', CLEANUP,
  "    if (!opts.isValidSessionId(sessionId) || excludes.has(sessionId)) {",
  "    if (false || excludes.has(sessionId)) {",
  'drop the session-id validation (any .txt stem sweeps)'),

 ('M4', CLEANUP,
  "    if (!opts.isValidSessionId(sessionId) || excludes.has(sessionId)) {",
  "    if (!opts.isValidSessionId(sessionId) || false) {",
  'drop the excludeSessionIds guard'),

 ('M5', CLEANUP,
  "          if (s.mtime < opts.cutoffDate) {",
  "          if (true) {",
  'ignore the cutoff (delete every candidate)'),

 ('M6', CLEANUP,
  "          if (s.mtime < opts.cutoffDate) {",
  "          if (s.mtime <= opts.cutoffDate) {",
  'boundary: < becomes <='),

 ('M7', CLEANUP,
  "    if (isENOENT(e)) return result;\n    debugLogger.error('readdir failed', e);",
  "    if (isENOENT(e)) throw e;\n    debugLogger.error('readdir failed', e);",
  'missing debug dir throws instead of returning zero'),

 ('M8', CLEANUP,
  "          if (isENOENT(err)) return;\n          result.errors++;\n          debugLogger.error(`failed to sweep ${filePath}`, err);",
  "          result.errors++;\n          debugLogger.error(`failed to sweep ${filePath}`, err);",
  'count a concurrent delete (ENOENT) as an error'),

 ('M9', CLEANUP,
  "    const sessionId = entry.name.slice(0, -DEBUG_LOG_FILE_SUFFIX.length);",
  "    const sessionId = entry.name;",
  'stop stripping the .txt suffix before validating'),

 ('M10', SCHED,
  "  const markerPaths = [\n    join(qwenDir, FILE_HISTORY_MARKER),\n    getDebugLogsMarkerPath(qwenDir, Storage.getGlobalDebugDir()),\n  ];",
  "  const markerPaths = [\n    join(qwenDir, FILE_HISTORY_MARKER),\n  ];",
  'debug marker no longer registered for the catch-up delay'),

 ('M11', SCHED,
  "  const debugDirKey = createHash('sha256')\n    .update(debugDir)\n    .digest('hex')\n    .slice(0, 16);",
  "  const debugDirKey = 'fixedkey00000000';",
  'marker key no longer depends on the debug dir'),

 ('M12', SCHED,
  "      const r = await cleanupOldDebugLogs({\n        cutoffDate: cutoff,\n        excludeSessionIds: new Set([currentSessionId]),\n        isValidSessionId,\n      });",
  "      const r = await cleanupOldDebugLogs({\n        cutoffDate: cutoff,\n        excludeSessionIds: new Set(),\n        isValidSessionId,\n      });",
  'scheduler stops protecting the current session'),

 ('M13', SCHED,
  "      const r = await cleanupOldDebugLogs({\n        cutoffDate: cutoff,\n        excludeSessionIds: new Set([currentSessionId]),\n        isValidSessionId,\n      });",
  "      const r = await cleanupOldDebugLogs({\n        cutoffDate: cutoff,\n        excludeSessionIds: new Set([currentSessionId]),\n        isValidSessionId: () => true,\n      });",
  'scheduler passes a validator that accepts everything'),
]
