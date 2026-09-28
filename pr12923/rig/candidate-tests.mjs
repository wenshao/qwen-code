// Apply the two candidate tests to the PR head worktree (idempotent).
import fs from 'node:fs';
const WT = process.argv[2];
const B = `${WT}/packages/acp-bridge/src/bridge.test.ts`;
const S = `${WT}/packages/acp-bridge/src/sessionAttachments.test.ts`;
let b = fs.readFileSync(B, 'utf8');
const anchorB = "    it('closes captured attachment stores during bridge shutdown', async () => {";
const testB = `    it("frees a detached client's staged uploads while another client keeps the session open", async () => {
      const bridge = makeBridge({
        channelFactory: async () => makeChannel().channel,
      });
      try {
        const first = await bridge.spawnOrAttach({ workspaceCwd: WS_A });
        const second = await bridge.spawnOrAttach({ workspaceCwd: WS_A });
        const create = (clientId: string) =>
          bridge.createSessionAttachmentUpload(
            first.sessionId,
            { name: 'staged.bin', mimeType: 'application/octet-stream', size: 1 },
            { clientId },
          );
        for (let i = 0; i < 8; i++) create(first.clientId);
        expect(() => create(second.clientId)).toThrow(
          expect.objectContaining({ status: 429 }),
        );
        await bridge.detachClient(first.sessionId, first.clientId);
        for (let i = 0; i < 8; i++) {
          expect(() => create(second.clientId)).not.toThrow();
        }
      } finally {
        await bridge.shutdown();
      }
    });

`;
if (!b.includes("frees a detached client's staged uploads")) {
  if (b.split(anchorB).length !== 2) throw new Error('bridge anchor');
  b = b.replace(anchorB, testB + anchorB);
  fs.writeFileSync(B, b);
}
let s = fs.readFileSync(S, 'utf8');
const anchorS = "  it('keeps existing same-name references available while a new write queues', async () => {";
const testS = `  it('rejects an oversized chunked upload before staging it', async () => {
    const store = new SessionAttachmentStore();
    try {
      expect(() =>
        store.createUpload({
          name: 'large.bin',
          mimeType: 'application/octet-stream',
          size: SESSION_ATTACHMENT_MAX_ITEM_BYTES + 1,
        }),
      ).toThrow(RangeError);
    } finally {
      await store.close();
    }
  });

`;
if (!s.includes('rejects an oversized chunked upload before staging it')) {
  if (s.split(anchorS).length !== 2) throw new Error('store anchor');
  s = s.replace(anchorS, testS + anchorS);
  fs.writeFileSync(S, s);
}
console.log('applied');
