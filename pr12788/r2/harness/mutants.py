"""PR #12788 mutation matrix. Each mutant rewrites exactly one site of the
head production code; `apply(dir, name)` fails unless the target text occurs
the expected number of times, so a mutant can never silently become a no-op.
"""
import sys

PKG = "src/main/java/com/alibaba/qwen/code/runtimebroker/"
SUP = PKG + "JdbcRepositorySupport.java"
BIND = PKG + "JdbcRuntimeBindingRepository.java"
TOOL = PKG + "JdbcToolExecutionRepository.java"

PRECISE = "Instant now = JdbcRepositorySupport.databaseNowPrecise(connection);"
TRUNC = "Instant now = JdbcRepositorySupport.databaseNow(connection);"
CEIL = "JdbcRepositorySupport.leaseUntil(now, duration)"
PLAIN = "now.plus(duration)"

# name: (file, old, new, occurrence index (1-based) or 0 for 'the only one',
#        expected total occurrences, description)
MUTANTS = {
    "M01": (SUP,
            "return deadline.getNano() == 0 ? deadline\n"
            "                : deadline.truncatedTo(ChronoUnit.SECONDS).plusSeconds(1);",
            "return deadline;", 0, 1, "leaseUntil: no rounding"),
    "M02": (SUP, "deadline.getNano() == 0 ? deadline", "false ? deadline",
            0, 1, "leaseUntil: always +1 s (pads whole-second deadlines)"),
    "M03": (SUP, ".truncatedTo(ChronoUnit.SECONDS).plusSeconds(1);",
            ".truncatedTo(ChronoUnit.SECONDS);", 0, 1,
            "leaseUntil: floor instead of ceil"),
    "M04": (BIND, PRECISE, TRUNC, 1, 3,
            "binding compareAndSet: truncated clock for liveness"),
    "M05": (BIND, PRECISE, TRUNC, 2, 3,
            "binding claimOperation: truncated clock"),
    "M06": (BIND, CEIL, PLAIN, 1, 2,
            "binding claimOperation: unrounded deadline"),
    "M07": (BIND, PRECISE, TRUNC, 3, 3,
            "binding renewOperation: truncated clock"),
    "M08": (BIND, CEIL, PLAIN, 2, 2,
            "binding renewOperation: unrounded deadline"),
    "M09": (TOOL, "JdbcRepositorySupport.databaseNowPrecise(\n"
                  "                                    connection))",
            "JdbcRepositorySupport.databaseNow(\n"
            "                                    connection))", 0, 1,
            "tool compareAndSet: truncated clock for liveness"),
    "M10": (TOOL, PRECISE, TRUNC, 1, 2,
            "tool claimDispatch: truncated clock"),
    "M11": (TOOL, CEIL, PLAIN, 1, 2,
            "tool claimDispatch: unrounded deadline"),
    "M12": (TOOL, PRECISE, TRUNC, 2, 2,
            "tool renewDispatch: truncated clock"),
    "M13": (TOOL, CEIL, PLAIN, 2, 2,
            "tool renewDispatch: unrounded deadline"),
}


def apply(root, name):
    path, old, new, nth, total, _ = MUTANTS[name]
    full = root.rstrip("/") + "/" + path
    text = open(full).read()
    count = text.count(old)
    if count != total:
        raise SystemExit(f"{name}: expected {total} matches, found {count}")
    index = -1
    for _ in range(nth if nth else 1):
        index = text.index(old, index + 1)
    text = text[:index] + new + text[index + len(old):]
    open(full, "w").write(text)
    print(f"{name} applied at occurrence {nth or 1}/{total}: "
          f"{MUTANTS[name][5]}")


if __name__ == "__main__":
    if sys.argv[1] == "list":
        for key, value in MUTANTS.items():
            print(key, value[5])
    else:
        apply(sys.argv[1], sys.argv[2])
