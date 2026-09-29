// Alternative from the #13031 triage: insert + claim in one TransactionTemplate
// (transfersHarness... only), no pause. Keeps only the post-release widening.
import fs from 'node:fs';
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
const old = `        Admission turn = store.insertTurnCommand(tenant, "SUBMIT_TURN",
                "takeover-turn", "sha256:" + "e".repeat(64),
                session.sessionId(), List.of(),
                "sha256:" + "f".repeat(64));
        String owner = "takeover-owner";
        awaitScannerChance(tenant, session.sessionId(), turn.turnId());
        assertThat(store.claimTurn(tenant, session.sessionId(),
                turn.turnId(), owner, Duration.ofMinutes(1))).isPresent();
`;
const neu = `        String owner = "takeover-owner";
        Admission turn = new TransactionTemplate(transactionManager).execute(status -> {
            Admission admitted = store.insertTurnCommand(tenant, "SUBMIT_TURN",
                    "takeover-turn", "sha256:" + "e".repeat(64),
                    session.sessionId(), List.of(),
                    "sha256:" + "f".repeat(64));
            assertThat(store.claimTurn(tenant, session.sessionId(),
                    admitted.turnId(), owner, Duration.ofMinutes(1))).isPresent();
            return admitted;
        });
`;
if (!s.includes(old)) throw new Error('anchor');
s = s.replace(old, neu);
fs.writeFileSync(f, s);
console.log('txn alternative applied');
