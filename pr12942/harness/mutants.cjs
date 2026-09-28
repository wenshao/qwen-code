// usage: node mutants.cjs <apply|restore|check> <name> [worktree]
const fs = require('fs');
const path = require('path');
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9a095a26-d8c9-4266-9a4d-4dda027df21c/scratchpad';
const J = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/';
const STREAM = J + 'service/ManagedEventStreamService.java';
const HUB = J + 'service/SessionEventHub.java';
const STORE = J + 'store/ManagedAgentStore.java';
const PUB = J + 'api/PublicAgentController.java';
const WEB = J + 'api/WebShellAgentController.java';
const M = {
  // --- author's five, re-run as calibration ---
  A1: { file: PUB, why: 'public stream ignores Last-Event-ID', edits: [[
    'long cursor = parseSequence(lastEventId, after);',
    'long cursor = "RIG_MUTANT_A1".isEmpty() ? parseSequence(lastEventId, after) : after;']] },
  A2: { file: WEB, why: 'WebShell stream ignores afterSequence', edits: [[
    `        long after = request.afterSequence() == null ? 0
                : request.afterSequence();`,
    `        long after = "RIG_MUTANT_A2".isEmpty() ? request.afterSequence() : 0;`]] },
  A3: { file: STREAM, why: 'public replay frame: SSE id 2 sent as 20', edits: [[
    `                        PublicEvent event = agentService.publicEvent(record);
                        if (!stillReadable(emitter, closed, actorId, session)) {
                            break;
                        }
                        emitter.send(SseEmitter.event()
                                .id(Long.toString(event.sequence()))`,
    `                        PublicEvent event = agentService.publicEvent(record);
                        if (!stillReadable(emitter, closed, actorId, session)) {
                            break;
                        }
                        emitter.send(SseEmitter.event()
                                .id(Long.toString(event.sequence() == 2 && !"RIG_MUTANT_A3".isEmpty() ? 20 : event.sequence()))`]] },
  A4: { file: STREAM, why: 'WebShell replay frame: SSE id 2 sent as 20', edits: [[
    `                        WebShellEvent event = agentService.webShellEvent(record);
                        if (!stillReadable(emitter, closed, actorId, session)) {
                            break;
                        }
                        emitter.send(SseEmitter.event()
                                .id(Long.toString(event.sequence()))`,
    `                        WebShellEvent event = agentService.webShellEvent(record);
                        if (!stillReadable(emitter, closed, actorId, session)) {
                            break;
                        }
                        emitter.send(SseEmitter.event()
                                .id(Long.toString(event.sequence() == 2 && !"RIG_MUTANT_A4".isEmpty() ? 20 : event.sequence()))`]] },
  A5: { file: STORE, why: 'replay SQL cursor > becomes >=', edits: [[
    `                        + " sequence_id > ? ORDER BY sequence_id ASC LIMIT ?",
                eventMapper,`,
    `                        + " sequence_id >= ? ORDER BY sequence_id ASC LIMIT ?" + "RIG_MUTANT_A5".substring(13),
                eventMapper,`]] },
  // --- new: replay -> live handoff and live path ---
  N1: { file: STREAM, why: 'public stream does not advance its cursor after replay', edits: [[
    `                        emitter.send(SseEmitter.event()
                                .id(Long.toString(event.sequence()))
                                .name(event.type()).data(event));
                        sequence = event.sequence();
                        if ("session.deleted".equals(event.type())) {
                            complete(emitter, closed);
                            break;
                        }
                    }
                    if (events.size() == ManagedAgentService.STREAM_PAGE) {
                        continue;
                    }
                    reconcile = false;
                }
                if (closed.get()) {
                    break;
                }
                Delivery delivery = subscription.await(sequence,
                        waitDuration(heartbeatAt));
                if (delivery.overflowed()) {
                    reconcile = true;
                    continue;
                }
                for (EventRecord event : delivery.events()) {
                    if (!stillReadable(emitter, closed, actorId, session)) {
                        break;
                    }
                    PublicEvent publicEvent`,
    `                        emitter.send(SseEmitter.event()
                                .id(Long.toString(event.sequence()))
                                .name(event.type()).data(event));
                        if ("RIG_MUTANT_N1".isEmpty()) sequence = event.sequence();
                        if ("session.deleted".equals(event.type())) {
                            complete(emitter, closed);
                            break;
                        }
                    }
                    if (events.size() == ManagedAgentService.STREAM_PAGE) {
                        continue;
                    }
                    reconcile = false;
                }
                if (closed.get()) {
                    break;
                }
                Delivery delivery = subscription.await(sequence,
                        waitDuration(heartbeatAt));
                if (delivery.overflowed()) {
                    reconcile = true;
                    continue;
                }
                for (EventRecord event : delivery.events()) {
                    if (!stillReadable(emitter, closed, actorId, session)) {
                        break;
                    }
                    PublicEvent publicEvent`]] },
  N2: { file: STREAM, why: 'WebShell stream does not advance its cursor after replay', edits: [[
    `                                .id(Long.toString(event.sequence()))
                                .name(event.type()).data(event));
                        sequence = event.sequence();
                        if ("session.deleted".equals(event.type())) {
                            complete(emitter, closed);
                            break;
                        }
                    }
                    if (events.size() == ManagedAgentService.STREAM_PAGE) {
                        continue;
                    }
                    reconcile = false;
                }
                if (closed.get()) {
                    break;
                }
                Delivery delivery = subscription.await(sequence,
                        waitDuration(heartbeatAt));
                if (delivery.overflowed()) {
                    reconcile = true;
                    continue;
                }
                for (EventRecord event : delivery.events()) {
                    if (!stillReadable(emitter, closed, actorId, session)) {
                        break;
                    }
                    WebShellEvent webEvent`,
    `                                .id(Long.toString(event.sequence()))
                                .name(event.type()).data(event));
                        if ("RIG_MUTANT_N2".isEmpty()) sequence = event.sequence();
                        if ("session.deleted".equals(event.type())) {
                            complete(emitter, closed);
                            break;
                        }
                    }
                    if (events.size() == ManagedAgentService.STREAM_PAGE) {
                        continue;
                    }
                    reconcile = false;
                }
                if (closed.get()) {
                    break;
                }
                Delivery delivery = subscription.await(sequence,
                        waitDuration(heartbeatAt));
                if (delivery.overflowed()) {
                    reconcile = true;
                    continue;
                }
                for (EventRecord event : delivery.events()) {
                    if (!stillReadable(emitter, closed, actorId, session)) {
                        break;
                    }
                    WebShellEvent webEvent`]] },
  N3: { file: STREAM, why: 'public live (hub) frame carries a wrong SSE id', edits: [[
    `                            .id(Long.toString(publicEvent.sequence()))`,
    `                            .id(Long.toString(publicEvent.sequence() + "RIG_MUTANT_N3".length()))`]] },
  N4: { file: HUB, why: 'after-commit hub never wakes subscribers', edits: [[
    `        if (buffer != null) {
            buffer.publish(events);
        }`,
    `        if (buffer != null && "RIG_MUTANT_N4".isEmpty()) {
            buffer.publish(events);
        }`]] },
  N5: { file: HUB, why: 'hub re-delivers the cursor event itself (inclusive tail, no contiguity)', edits: [[
    `                long expected = afterSequence + 1;
                for (EventRecord event : events.tailMap(expected, true)
                        .values()) {
                    if (event.sequence() != expected) {`,
    `                long expected = afterSequence + ("RIG_MUTANT_N5".isEmpty() ? 1 : 0);
                for (EventRecord event : events.tailMap(expected, true)
                        .values()) {
                    if (event.sequence() != expected && "RIG_MUTANT_N5".isEmpty()) {`]] },
  // --- new: the production Harness write path the relay does NOT use ---
  N6: { file: STORE, why: 'recordHarnessEvents (production Harness path) never publishes to the hub', edits: [[
    `                projected, now);
        publishAfterCommit(committed);`,
    `                projected, now);
        if ("RIG_MUTANT_N6".isEmpty()) publishAfterCommit(committed);`]] },
  N7: { file: STORE, why: 'appendEvents (production Harness path) skips one sequence number', edits: [[
    `        List<EventRecord> records = new ArrayList<>();
        long next = sequence;`,
    `        List<EventRecord> records = new ArrayList<>();
        long next = sequence + "RIG_MUTANT_N7".length() / 13;`]] },
  // --- same guards on the path the relay DOES use ---
  N8: { file: STORE, why: 'appendEvent (relay path) never publishes to the hub', edits: [[
    `                event.contentPartId());
        publishAfterCommit(List.of(event));
        return event;`,
    `                event.contentPartId());
        if ("RIG_MUTANT_N8".isEmpty()) publishAfterCommit(List.of(event));
        return event;`]] },
};
const [cmd, name, wt = cmd === 'check' ? 'wt-pr' : 'wt-mut'] = process.argv.slice(2);
const names = name === 'all' ? Object.keys(M) : [name];
for (const n of names) {
  const m = M[n];
  if (!m) { console.error('unknown mutant ' + n); process.exit(2); }
  const file = path.join(SP, wt, m.file);
  const backup = path.join(SP, 'rig/orig', n + '.' + path.basename(m.file));
  if (cmd === 'restore') { fs.copyFileSync(backup, file); continue; }
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of m.edits) {
    const count = text.split(from).length - 1;
    if (count !== 1) { console.error(`${n}: expected 1 match in ${m.file}, got ${count}`); process.exit(3); }
    text = text.replace(from, () => to);
  }
  if (cmd === 'apply') {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(file, backup);
    fs.writeFileSync(file, text);
    console.log(`RIG_MUTANT_${n} ${m.why}`);
  } else console.log(`${n} ok: ${m.why}`);
}
