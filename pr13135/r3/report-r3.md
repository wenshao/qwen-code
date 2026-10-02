## Real-environment verification, round 3 — PR #13135 @ `d7c5c5e50e` (head unchanged)

**Verdict: the head has not changed since [round 2](https://github.com/QwenLM/qwen-code/pull/13135#issuecomment-5947693305), so the round-2 real-stack results still apply. This update is description-only.** This round:
- checks the new migration note against the evidence (it is accurate);
- tests the one upgrade path the author still listed as untested;
- corrects a sentence of mine about F1.

![round 3](IMG4)

### Upgrade from the other provisional numbering

- **Setup:** I built `0b9ad071e5`, which records the close migration as **V30** after main's V28/V29. I initialized a fresh MySQL 8.4.7 database with it, then started the current head jar on that database.
- **Result:** Spring refuses to start with `Migration checksum mismatch for migration version 30`. The schema history is left untouched (30 rows, no V31).
- **Conclusion:** both provisional numberings (V28 and V30) fail the same way, while a main database upgrades cleanly (round 2).
- **Suggested note wording:** the migration note could say "any database that ran an earlier build of this PR (close recorded as V28 or V30) must be recreated or repaired". As written, it names only V28 and calls V30 untested.

### Correction to round 2

I wrote that the author "agrees with option 1". As the author [clarified](https://github.com/QwenLM/qwen-code/pull/13135#issuecomment-5948174677), option 1 is a recommendation, and the PR author has not chosen a policy yet.

**F1 is open:**
- Either refuse a new close before writing the operation, CLOSING state or fence when the original resources are already unverifiable,
- or document the container limitation and its same-storage availability cost.

Neither has landed on this head.

### CI on this head

All checks have passed, including the web-shell E2E smoke that was pending in round 2. `review-pr` is still running.

The new database, Spring log excerpt and figure source are under `r3/` [here](TREE).
