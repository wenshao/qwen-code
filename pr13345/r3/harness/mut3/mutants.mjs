// Round 3 mutation set for PR #13345.
//   prev = 4ae14d62 (wt-mut-pr), new3 = be2c87bb (wt-mut-base).
// be2c87bb changes only commitDomainRecord and one test, so the Java lanes
// are unchanged since round 2 and are not re-run; every TS mutant from round
// 2 is re-run on new3 (witness files), with the domain-path anchors that
// be2c87bb moved adapted, plus one mutant per new /review R2 item.
import { MUTANTS as R2, JSON_FNS } from '../mut2/mutants.mjs';

const CORE = 'packages/core/src/managed-runtime';
const DOMAIN_PREFLIGHT_NEW3 = `      assertExtensionActor(actor.class);
      assertCommandIdentity(command);
      // Refused before publishing, so a retry loop leaves no body behind.
      this.assertCommandWritable(command);
      this.assertExpectedSequence(command);
      const previous = this.domainRecords.get(request.domain);`;

const ADAPT = {
  'A-T06-domain-preflight-deleted': [
    {
      file: `${CORE}/managed-session-authority.ts`,
      find: DOMAIN_PREFLIGHT_NEW3,
      replace: `      const previous = this.domainRecords.get(request.domain);`,
    },
  ],
  'B06-identity-preflight-stripped': [
    {
      file: `${CORE}/managed-session-authority.ts`,
      find: `      assertCommandIdentity(command);
      // Refused before publishing, so a retry loop leaves no body behind.
      this.assertCommandWritable(command);`,
      replace: `      // Refused before publishing, so a retry loop leaves no body behind.
      this.assertCommandWritable(command);`,
    },
    {
      file: `${CORE}/managed-session-authority.ts`,
      find: `      assertExtensionActor(actor.class);
      assertCommandIdentity(command);
      if (request.input !== undefined) {`,
      replace: `      assertExtensionActor(actor.class);
      if (request.input !== undefined) {`,
    },
  ],
};

const rerun = R2.filter((m) => m.lanes.includes('ts')).map((m) => ({
  ...m,
  id: `R-${m.id}`,
  arms: ['new3'],
  lanes: ['ts'],
  edits: ADAPT[m.id] ?? m.edits,
}));

const fresh = [
  {
    id: 'C01-hoisted-pair-stripped',
    finding: 'R2-1',
    arms: ['new3'],
    lanes: ['ts'],
    desc: 'commitDomainRecord loses the two hoisted checks (writable, expectedSequence)',
    edits: [
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: DOMAIN_PREFLIGHT_NEW3,
        replace: `      assertExtensionActor(actor.class);
      assertCommandIdentity(command);
      const previous = this.domainRecords.get(request.domain);`,
      },
    ],
  },
  {
    id: 'C02-rebuild-never-reads-goal_state',
    finding: 'R2-2',
    arms: ['prev', 'new3'],
    lanes: ['ts'],
    desc: 'the rebuild filters goal_state events out, so the skip predicate never runs',
    edits: [
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: `    const events = this.events.filter(
      (event) =>
        event.kind === 'domain.committed' &&
        MANAGED_EXTENSION_RECORD_BODIES[`,
        replace: `    const events = this.events.filter(
      (event) =>
        event.kind === 'domain.committed' &&
        event.payload['domain'] !== 'goal_state' &&
        MANAGED_EXTENSION_RECORD_BODIES[`,
      },
    ],
  },
];

export const MUTANTS = [...fresh, ...rerun];
export { JSON_FNS };
