#!/usr/bin/env python3
"""Render evidence figures from the rig's captured DingTalk payloads.

Every card in these figures is drawn from the exact `cardParamMap` the bundled
CLI sent to the (fake) DingTalk Card OpenAPI, and every text bubble from the
exact `sessionWebhook` / robot-message body it sent. Nothing is hand-written.
"""
import json, os, sys, html

OUT = os.path.expanduser('~/git/rig-10457/out')
FIG = os.path.expanduser('~/git/rig-10457/figs')
os.makedirs(FIG, exist_ok=True)


def load(name):
    with open(os.path.join(OUT, name + '.json')) as f:
        return json.load(f)


STATUS_STYLE = {
    'pending':   ('#0a7cff', 'pending'),
    'approved':  ('#12a150', 'approved'),
    'denied':    ('#d4380d', 'denied'),
    'cancelled': ('#8c8c8c', 'cancelled'),
    'expired':   ('#8c8c8c', 'expired'),
    'submitted': ('#12a150', 'submitted'),
}


def card_html(params, caption, disabled=None):
    status = params.get('card_status', 'pending')
    colour, label = STATUS_STYLE.get(status, ('#8c8c8c', status))
    try:
        form = json.loads(params.get('form', '{}'))
        options = form['fields'][0]['options']
        flabel = form['fields'][0]['label']
    except Exception:
        options, flabel = [], ''
    terminal = status != 'pending'
    opts = ''
    if not terminal:
        for o in options:
            opts += (
                '<label class="opt"><span class="box"></span>'
                f'<span>{html.escape(o["text"])}</span></label>'
            )
    btn_cls = 'btn done' if terminal else 'btn'
    return f'''
<figure class="wrap">
  <figcaption>{html.escape(caption)}</figcaption>
  <div class="card">
    <div class="head">
      <span class="bot">Q</span>
      <span class="title">{html.escape(params.get('question_title', ''))}</span>
      <span class="pill" style="background:{colour}">{html.escape(label)}</span>
    </div>
    <div class="desc">{html.escape(params.get('question_desc', ''))}</div>
    {'<div class="flabel">' + html.escape(flabel) + '</div>' if opts else ''}
    <div class="opts">{opts}</div>
    <button class="{btn_cls}">{html.escape(params.get('form_btn_text', ''))}</button>
  </div>
</figure>'''


def bubble_html(text, caption, kind=''):
    return f'''
<figure class="wrap">
  <figcaption>{html.escape(caption)}</figcaption>
  <div class="bubble {kind}">{html.escape(text)}</div>
</figure>'''


CSS = '''
* { box-sizing: border-box; }
body { margin:0; padding:22px; background:#eef0f3; font:14px/1.5 -apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif; color:#1f2328; }
h1 { font-size:17px; margin:0 0 4px; }
p.sub { margin:0 0 18px; color:#57606a; font-size:12.5px; }
.row { display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap; }
.wrap { margin:0; width:392px; min-width:392px; }
figcaption { font-size:12px; color:#57606a; margin-bottom:6px; font-weight:600; }
.card { background:#fff; border-radius:10px; padding:14px 15px; box-shadow:0 1px 3px rgba(0,0,0,.13); border:1px solid #e3e6ea; }
.head { display:flex; align-items:center; gap:8px; margin-bottom:9px; }
.bot { width:20px;height:20px;border-radius:5px;background:#5b47ff;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:700; }
.title { font-weight:700; font-size:14.5px; flex:1; }
.pill { color:#fff; font-size:11px; padding:1.5px 7px; border-radius:9px; }
.desc { overflow-wrap:anywhere; color:#3d444d; font-size:13px; word-break:break-all; background:#f6f7f9; border-radius:6px; padding:8px 9px; }
.flabel { margin:11px 0 6px; font-size:12.5px; color:#57606a; }
.opts { display:flex; flex-direction:column; gap:7px; }
.opt { display:flex; align-items:flex-start; gap:8px; font-size:13px; overflow-wrap:anywhere; }
.box { flex:0 0 14px; margin-top:3px; }
.box { width:14px;height:14px;border:1.5px solid #b6bcc4;border-radius:3px;display:inline-block; }
.btn { margin-top:13px; width:100%; padding:7px 0; border:0; border-radius:6px; background:#0a7cff; color:#fff; font-size:13.5px; font-weight:600; }
.btn.done { background:#eef0f3; color:#8c8c8c; }
.bubble { overflow-wrap:anywhere; word-break:break-word; background:#fff; border-radius:10px; padding:12px 14px; white-space:pre-wrap; font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; box-shadow:0 1px 3px rgba(0,0,0,.13); border:1px solid #e3e6ea; }
.bubble.warn { border-left:3px solid #d4380d; }
'''


def page(title, sub, body):
    return (
        '<!doctype html><meta charset="utf-8">'
        f'<style>{CSS}</style><h1>{title}</h1>'
        f'<p class="sub">{sub}</p>{body}'
    )


def perm(d, idx=0):
    return d['permissionCards'][idx]


def write(name, content):
    p = os.path.join(FIG, name + '.html')
    open(p, 'w').write(content)
    print(p)


# ---------------------------------------------------------------- fig 1: before/after
base = load('base-card-disabled')
head_zh = load('head-zh-allow-once')
write('fig1-before-after', page(
    'Figure 1 — before / after, same tool permission request',
    'Left: base <code>eb891d6b</code> (merge-base) replies with the permission-command text. '
    'Right: PR head <code>d2026842</code> delivers a native card. Both captured from '
    '<code>qwen channel start dt</code> running the release bundle against a local DingTalk stack.',
    '<div class="row">'
    + bubble_html(base['fallbacks'][0]['text'], 'base eb891d6b — sessionWebhook text')
    + card_html(perm(head_zh)['params'], 'PR head d2026842 — createAndDeliver cardParamMap')
    + '</div>'))

# ---------------------------------------------------------------- fig 2: locale matrix
head_en = load('head-en-deny')
write('fig2-locale', page(
    'Figure 2 — locale follows the startup <code>general.language</code> snapshot',
    'Same tool call, same options, two channel processes. Chinese copy is selected by '
    '<code>general.language: "Chinese"</code>; every other value renders English. '
    'Note the persistent option keeps its upstream scope suffix (<code>echo *</code>) in both locales.',
    '<div class="row">'
    + card_html(perm(head_zh)['params'], 'general.language = "Chinese"')
    + card_html(perm(head_en)['params'], 'general.language = "en"')
    + '</div>'))

# ---------------------------------------------------------------- fig 3: terminal states
cancel = load('head-cancel')
timeout = load('head-timeout')
zh_deny = load('head-zh-deny')
write('fig3-terminal', page(
    'Figure 3 — terminal states, all four reached live',
    'Each panel is the final <code>PUT /v1.0/card/instances</code> payload for that run. '
    'Approved / denied come from card taps, cancelled from the card cancel action, '
    'expired from the controller timeout (<code>permissionCard.timeoutMs = 6000</code>).',
    '<div class="row">'
    + card_html(perm(head_zh)['finalParams'], 'approved (zh) — tool ran')
    + card_html(perm(zh_deny)['finalParams'], 'denied (zh) — tool did not run')
    + card_html(perm(cancel)['finalParams'], 'cancelled (en) — card cancel action')
    + card_html(perm(timeout)['finalParams'], 'expired (en) — timeout denied the request')
    + '</div>'))

# ---------------------------------------------------------------- fig 4: owner binding
fta = load('head-fta-rep')
grp = load('head-foreign-group-zh')
dm = load('head-foreign-dm-en')
write('fig4-owner-binding', page(
    'Figure 4 — the card is bound to the run owner',
    'Shared group session (<code>sessionScope: single</code>, <code>groupPolicy: open</code>). '
    'A second group member cannot settle the permission by tapping the card or by typing '
    '<code>/approve</code>; the owner still can.',
    '<div class="row">'
    + bubble_html(grp['robotMessages'][0]['param']['text'],
                  'non-owner taps the card (group, zh) — robot/groupMessages/send')
    + bubble_html(dm['robotMessages'][0]['param']['text'],
                  'non-owner taps the card (1:1, en) — robot/oToMessages/batchSend')
    + bubble_html(fta['fallbacks'][0]['text'],
                  'non-owner types /approve while the card is pending')
    + '</div>'))

# ---------------------------------------------------------------- fig 5: fallbacks
disabled = load('head-card-disabled')
delivery = load('head-delivery-failure')
qoff = load('head-qcard-off')
write('fig5-fallback', page(
    'Figure 5 — the text path is still there when the card is not',
    'Left: <code>permissionCard.enabled = false</code>. Middle: cards enabled but the Card '
    'OpenAPI returns HTTP 503 for the create. Right: <code>ask_user_question</code> with '
    '<code>questionCard.enabled = false</code> — it stays a question, it does not become an allow/deny card.',
    '<div class="row">'
    + bubble_html(disabled['fallbacks'][0]['text'], 'permissionCard.enabled = false')
    + bubble_html(delivery['fallbacks'][0]['text'], 'card create fails (HTTP 503)')
    + bubble_html(qoff['fallbacks'][0]['text'], 'ask_user_question, questionCard disabled')
    + '</div>'))
