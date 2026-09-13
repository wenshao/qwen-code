#!/usr/bin/env bash
# PostToolUseFailure hook returning a 50,000-char additionalContext (R3-4 probe).
cat > /dev/null
node -e 'const ctx="HOOK-CONTEXT "+"h".repeat(49987); process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUseFailure",additionalContext:ctx}}))'
