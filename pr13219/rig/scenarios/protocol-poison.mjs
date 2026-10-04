import run from './turn-poison.mjs';
// A 503 without the Harness boot-id header: Spring classifies it as
// hosted_harness_protocol_error (terminal on both arms, pre-existing path).
export default (ctx) => run(ctx, { fault: { id: 'prompt503-noboot', method: 'POST', re: '/prompt$', status: 503, noEcho: true } });
