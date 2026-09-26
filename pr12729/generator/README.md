# managed-tool-result/1 fixture generator (PR #12729)

The author's implementation of the O1a design document, written without the
TypeScript module or the Java test. It builds every case of
`packages/core/src/managed-runtime/contracts/managed-tool-result-v1.fixtures.json`
by changing a valid base to target one rule, and computes every digest from
the bytes it describes; `Ledger` is the segment store semantics that produce
the expected outcome of each publication step. `gen_schema.py` writes the
shared schema.

Regenerate from the repository root and compare with the committed files
(Python 3.9 or later, no packages needed):

```bash
C=packages/core/src/managed-runtime/contracts
python3 gen_fixtures.py | npx prettier --stdin-filepath $C/managed-tool-result-v1.fixtures.json > /tmp/fixtures.json
python3 gen_schema.py | npx prettier --stdin-filepath $C/managed-tool-result-v1.schema.json > /tmp/schema.json
cmp /tmp/fixtures.json $C/managed-tool-result-v1.fixtures.json
cmp /tmp/schema.json $C/managed-tool-result-v1.schema.json
```

Both files reproduce byte for byte at `a94d76f960`, the head that adds the
`unknown-outcome-*` cases.

`mutate.py` is the mutation sweep over
`packages/core/src/managed-runtime/managed-tool-result.ts`: it applies each
mutant in turn, runs the core contract suite, and restores the file. Run it
from the repository root; pass mutant names to run a subset.
