// probe-once.mjs <kind G|D> <sender> <token> [daemonLog]  → prints verdict
import fs from 'node:fs';
const [kind, sender, token, daemonLog] = process.argv.slice(2);
const API = '/root/verify/pr12475-runs/dingtalk/shared/api.jsonl';
const lines = () => fs.readFileSync(API, 'utf8').split('\n').filter(Boolean);
const off = lines().length; const logOff = daemonLog ? fs.readFileSync(daemonLog, 'utf8').length : 0;
const isGroup = kind !== 'D'; const cid = isGroup ? 'cid-grp-1' : `cid-dm-${sender}`;
await fetch('http://127.0.0.1:28081/push', { method: 'POST', body: JSON.stringify({ msgId: `m-${token}`, msgtype: 'text', conversationType: isGroup ? '2' : '1', conversationId: cid, conversationTitle: 'Team Group', sessionWebhook: `https://oapi.dingtalk.com/robot/send?access_token=${cid}`, sessionWebhookExpiredTime: 9999999999999, chatbotUserId: 'bot-user', senderNick: sender, senderStaffId: sender, senderId: `$:LWCP_v1:$${sender}`, isInAtList: isGroup, atUsers: isGroup ? [{ dingtalkId: 'bot-user' }] : [], text: { content: `${token} hello` } }) });
const end = Date.now() + 20000; let v = 'NO_REPLY';
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, 300));
  if (lines().slice(off).join('\n').includes(`ANSWER ${token}`)) { v = 'ANSWERED'; break; }
  if (daemonLog) { const m = fs.readFileSync(daemonLog, 'utf8').slice(logOff).match(/preflight rejected reason=(\S+)/); if (m) { await new Promise((r) => setTimeout(r, 2000)); v = lines().slice(off).join('\n').includes(`ANSWER ${token}`) ? 'ANSWERED' : `REJECTED(${m[1]})`; break; } }
}
console.log(`${kind}:${sender} ${token} => ${v}`);
