
// ───────────────────────────────────────────────────────────────────────────
// Maintainer-verification witnesses for the four guards no existing test pins.
// Each passes on the PR head and fails on exactly the mutant that removes it.
// ───────────────────────────────────────────────────────────────────────────
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function priv(ch: QQChannelClass): Record<string, unknown> {
  return ch as unknown as Record<string, unknown>;
}
function sentBodies(): Array<Record<string, unknown>> {
  return mockSendQQMessage.mock.calls.map((c) => c[3] as Record<string, unknown>);
}
function sentText(b: Record<string, unknown>): string {
  return ((b['markdown'] as { content?: string } | undefined)?.content ?? (b['content'] as string) ?? '') as string;
}

describe('WITNESS: guards not pinned by the suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendQQMessage.mockResolvedValue(mockResponse(true));
    vi.useFakeTimers();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('W09 an entry-less cancelled-stash send suspended in resolveRoute keeps its msg_seq counter across a successor prompt start', async () => {
    const ch = makeChannel();
    onPromptStart(ch, 'test-chat', 'sess-1', 'msg-A');
    onResponseChunk(ch, 'test-chat', 'part-1 ', 'sess-1');
    await vi.advanceTimersByTimeAsync(2100); // idle flush -> (msg-A, seq 1)
    await drain();
    expect(sentBodies().map((b) => b['msg_seq'])).toEqual([1]);
    // The next send must refresh the token: hold it so the send is suspended in resolveRoute.
    const tok = deferred<{ accessToken: string; expiresIn: number }>();
    mockFetchAccessToken.mockReturnValueOnce(tok.promise);
    priv(ch)['tokenExpiresAt'] = 0;
    const delivery = (
      ch as unknown as {
        deliverCancelledStash: (c: string, s: string, t: string, a?: string | null) => Promise<void>;
      }
    ).deliverCancelledStash('test-chat', 'sess-1', 'STASHED-HEAD', 'msg-A');
    await drain();
    // A successor turn starts on the same session and releases msg-A's anchor.
    onPromptStart(ch, 'test-chat', 'sess-1', 'msg-B');
    tok.resolve({ accessToken: 'test-token-2', expiresIn: 7200 });
    await drain();
    await vi.advanceTimersByTimeAsync(10);
    await delivery;
    const stash = sentBodies().find((b) => sentText(b).includes('STASHED-HEAD'))!;
    expect(stash['msg_id']).toBe('msg-A');
    // QQ dedupes on (msg_id, msg_seq): a reclaimed counter would resolve seq 1 again.
    expect(stash['msg_seq']).toBe(2);
  });

  it('W07 a stash left behind a turn-counter reset is not prepended to the next prompt', async () => {
    const ch = makeChannel();
    // State a settled deferred chain leaves: handOffSealedPre re-stashed under turn 1,
    // then deleteTurnGenerationIfOwned reset the counter (it does not clear the stash).
    (priv(ch)['streamOrphanBuffer'] as Map<string, unknown>).set('sess-1', { turn: 1, text: 'STALE-HEAD ', pre: 'STALE-HEAD ' });
    onPromptStart(ch, 'test-chat', 'sess-1', 'msg-B'); // counter restarts at 1
    onResponseChunk(ch, 'test-chat', 'fresh answer', 'sess-1');
    await onResponseComplete(ch, 'test-chat', 'fresh answer', 'sess-1');
    await vi.advanceTimersByTimeAsync(2100);
    await drain();
    const all = sentBodies().map(sentText).join('|');
    expect(all).toContain('fresh answer');
    expect(all).not.toContain('STALE-HEAD');
  });

  it('W06 a completion record kept across a teardown does not alias onto the restarted turn', async () => {
    const ch = makeChannel();
    // Teardown with a flush marker live keeps completedTurns (by design) while the
    // turn counter restarts; the record then names turn 1.
    (priv(ch)['completedTurns'] as Map<string, number>).set('sess-1', 1);
    onPromptStart(ch, 'test-chat', 'sess-1', 'msg-B'); // turn 1 again
    const state = { chatId: 'test-chat', buffer: '', timer: null, retryCount: 0, msgId: 'msg-B', turn: 1, sealedPre: 'SEALED-HEAD ' };
    streamState(ch).set('sess-1', state as never);
    (
      ch as unknown as { handOffSealedPre: (st: unknown, s: string) => void }
    ).handOffSealedPre(state, 'sess-1');
    await drain();
    // This turn's completion has NOT run: the head must wait in the stash for it,
    // not be delivered on its own ahead of the reply.
    expect(sentBodies().length).toBe(0);
    expect((priv(ch)['streamOrphanBuffer'] as Map<string, { text: string }>).get('sess-1')?.text).toBe('SEALED-HEAD ');
  });

  it("W12 a superseded chain's settle does not clear the successor's flush marker", async () => {
    const ch = makeChannel();
    const sendA = deferred<MockResponse>();
    const sendB = deferred<MockResponse>();
    mockSendQQMessage.mockReturnValueOnce(sendA.promise).mockReturnValueOnce(sendB.promise);
    onPromptStart(ch, 'test-chat', 'sess-1', 'msg-A');
    onResponseChunk(ch, 'test-chat', 'a-1 ', 'sess-1');
    await vi.advanceTimersByTimeAsync(2100); // chain A in flight, marker = A
    await drain();
    // The session is replaced outright while A's send is still pending.
    (ch as unknown as { onSessionDied: (s: string) => void }).onSessionDied('sess-1');
    onPromptStart(ch, 'test-chat', 'sess-1', 'msg-B');
    onResponseChunk(ch, 'test-chat', 'b-1 ', 'sess-1');
    await vi.advanceTimersByTimeAsync(2100); // chain B in flight, marker = B
    await drain();
    const flushing = priv(ch)['flushingSessions'] as Map<string, unknown>;
    const markerB = flushing.get('sess-1');
    expect(markerB).toBeDefined();
    sendA.resolve(mockResponse(true)); // superseded chain A settles
    await drain();
    await vi.advanceTimersByTimeAsync(10);
    // B's send is still in flight: its marker must survive A's settle.
    expect(flushing.get('sess-1')).toBe(markerB);
    sendB.resolve(mockResponse(true));
    await drain();
  });
});
