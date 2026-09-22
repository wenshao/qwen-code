import sys, pathlib
mid = sys.argv[1]; head = sys.argv[2]
P = lambda p: pathlib.Path(head, p)
def sub(path, old, new, count=1):
    p = P(path); t = p.read_text()
    assert t.count(old) >= 1, f"pattern not found in {path}: {old[:70]!r}"
    p.write_text(t.replace(old, new, count))

if mid == 'M1':   # put the trusted state back inside the repository
    sub('packages/cli/src/commands/review/lib/paths.ts',
        "  const digest = getProjectHash(canonicalReviewRepositoryRoot(repositoryRoot));\n  return join(Storage.getGlobalQwenDir(), REVIEW_TRUST_STATE_DIR, digest);",
        "  return join(canonicalReviewRepositoryRoot(repositoryRoot), RETIRED_REVIEW_LEASE_DIR);")
elif mid == 'M2': # drop the case/symlink canonicalization
    sub('packages/cli/src/commands/review/lib/paths.ts',
        "    canonical = realpathSync.native(canonical);", "    canonical = canonical;")
elif mid == 'M3': # drop the re-applied boundary rule after canonicalization
    sub('packages/cli/src/commands/review/lib/paths.ts',
        "  canonical = outermostReviewRepositoryRoot(canonical);\n  return canonical;", "  return canonical;")
elif mid == 'M4': # innermost instead of outermost review layer
    sub('packages/cli/src/commands/review/lib/paths.ts',
        "  const at = (resolved + sep).indexOf(marker);", "  const at = (resolved + sep).lastIndexOf(marker);")
elif mid == 'M5': # accept a worktree outside the review geometry instead of refusing
    sub('packages/cli/src/commands/review/lib/paths.ts',
        "  if (at < 0) {\n    throw new Error(", "  if (false) {\n    throw new Error(")
elif mid == 'M6': # re-add the built-in workspace mask
    sub('packages/cli/src/config/config.ts',
        "  const shellExecutionSandbox = requestedShellExecutionSandbox;",
        "  const shellExecutionSandbox = requestedShellExecutionSandbox\n    ? {\n        ...requestedShellExecutionSandbox,\n        maskedPaths: [\n          ...(requestedShellExecutionSandbox.maskedPaths ?? []),\n          path.join(requestedShellExecutionSandbox.workspace, '.qwen', 'review-leases'),\n        ],\n      }\n    : undefined;")
elif mid == 'M7': # stop excluding the retired directory from local-diff capture
    sub('packages/cli/src/commands/review/lib/local-diff.ts',
        "    RETIRED_REVIEW_LEASE_DIR,\n  ]", "  ]")
elif mid == 'M8': # drop the 0700 mode on the trusted state directories
    sub('packages/cli/src/services/review-worktree-lease.ts',
        "  mkdirSync(leaseDirectory(repositoryRoot), {\n    recursive: true,\n    mode: 0o700,\n  });",
        "  mkdirSync(leaseDirectory(repositoryRoot), { recursive: true });")
    sub('packages/cli/src/commands/review/lib/base-tree-trust.ts',
        "  mkdirSync(dirname(trustPath), { recursive: true, mode: 0o700 });",
        "  mkdirSync(dirname(trustPath), { recursive: true });")
elif mid == 'M9': # lease directory back inside the workspace
    sub('packages/cli/src/services/review-worktree-lease.ts',
        "  return reviewTrustStateDir(repositoryRoot);",
        "  return join(resolve(repositoryRoot), '.qwen', 'review-leases');")
else:
    raise SystemExit(f'unknown mutant {mid}')
print(f'{mid} applied')
