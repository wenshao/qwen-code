let acceptReplacementContinuation = false;
let wsHoldReleased = false;
let releaseWsHold = () => {};
const wsHold = new Promise<void>((resolve) => {
  releaseWsHold = resolve;
});
let wsAfterSequence = 0;
