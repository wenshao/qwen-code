// VERIFY-18177: the PR's own fixture shape (a `kind: 'user'` background
// notice) is not the shape the transcript reducer produces; this control shows
// the indicator surviving that shape, so the contrast with the real shape
// (kind: 'assistant') is attributable to the block kind, not to the harness.
function verifyBackgroundSetup(): void {
  sendPrompt.mockImplementationOnce(async (_text, options) => {
    blocksState = [{ id: 'u-verify-ctl', kind: 'user', text: 'hi' }];
    options?.onAdmissionStarted?.();
    throw new Error('response lost');
  });
  render();
}

it('VERIFY-18177 control: author fixture shape (user-kind notice) keeps the indicator', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  verifyBackgroundSetup();
  await act(async () => {
    latestOnSubmit!('hi');
    await Promise.resolve();
  });
  expect(testid('pane-failed-prompt-retry')).not.toBeNull();
  blocksState = [
    { id: 'u-verify-ctl', kind: 'user', text: 'hi' },
    {
      id: 'bg-user-1',
      kind: 'user',
      text: 'Background notice',
      meta: { source: 'background_notification' },
    },
  ];
  rerender();
  const indicator = testid('pane-failed-prompt-retry');
  console.log(
    `[VERIFY-18177] indicator-after-author-shape=${
      indicator ? 'shown' : 'CLEARED'
    }`,
  );
  expect(indicator).not.toBeNull();
  warn.mockRestore();
});