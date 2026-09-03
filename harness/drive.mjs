// Driver: pushes real DingTalk stream frames into the daemon through the fake
// gateway, and reads the gateway's request log as the oracle.
const CTL = 'http://127.0.0.1:' + (process.env.GW_CTL_PORT || 9099);

async function push(topic, data) {
  const r = await fetch(CTL + '/push', { method: 'POST', body: JSON.stringify({ topic, data }) });
  return r.json();
}
export async function log() {
  const t = await (await fetch(CTL + '/log')).text();
  return t.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
export const reset = () => fetch(CTL + '/reset');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function sendMessage({ text, conversationId, senderId = 'owner-1', isGroup = false, msgId, isMentioned = false }) {
  return push('/v1.0/im/bot/messages/get', {
    msgtype: 'text',
    text: { content: text },
    msgId: msgId || 'msg-' + Math.random().toString(36).slice(2),
    createAt: Date.now(),
    conversationType: isGroup ? '2' : '1',
    conversationId,
    conversationTitle: 'harness',
    senderId: 'sid-' + senderId,
    senderNick: senderId,
    senderStaffId: senderId,
    sessionWebhook: 'https://oapi.dingtalk.com/robot/send?access_token=harness',
    sessionWebhookExpiredTime: Date.now() + 3600_000,
    robotCode: 'harnessClientId',
    isInAtList: isMentioned,
  });
}

export function sendCardCallback({ outTrackId, actorId = 'owner-1', actionId = 'submit', form, cancel = false, noBusiness = false }) {
  const priv = { actionIds: [actionId] };
  if (cancel) priv.params = { user_cancel: true };
  else if (!noBusiness) priv.params = { form: form ?? {} };
  return push('/v1.0/card/instances/callback', {
    userId: actorId,
    outTrackId,
    content: JSON.stringify({ cardPrivateData: priv }),
  });
}

export async function waitFor(pred, { timeout = 30000, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const entries = await log();
    const hit = pred(entries);
    if (hit) return hit;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label} after ${timeout}ms`);
    await sleep(300);
  }
}

export const cardCreates = (e) => e.filter((x) => x.kind === 'http' && x.path === '/v1.0/card/instances/createAndDeliver');
export const cardUpdates = (e) => e.filter((x) => x.kind === 'http' && x.path === '/v1.0/card/instances' && x.method === 'PUT');
export const robotSends = (e) => e.filter((x) => x.kind === 'http' && (x.path === '/robot/send' || x.path.startsWith('/v1.0/robot/oToMessages') || x.path.startsWith('/v1.0/robot/groupMessages')));
export const texts = (e) => robotSends(e).map((x) => x.body?.text?.content ?? x.body?.msgParam ?? JSON.stringify(x.body)).filter(Boolean);
export const permissionCards = (e) => cardCreates(e).filter((x) => {
  const p = x.body?.cardData?.cardParamMap ?? {};
  return typeof p['form'] === 'string' && p['form'].includes('permission_decision');
});
