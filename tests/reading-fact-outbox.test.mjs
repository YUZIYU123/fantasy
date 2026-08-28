import assert from "node:assert/strict";
import test from "node:test";
import { ReadingFactOutbox } from "../app/reading-fact-outbox.ts";

test("阅读事实发送失败时保留原请求并用同一 operationId 重试", async () => {
  const outbox = new ReadingFactOutbox();
  const body = { fact: "active-window", operationId: "window-stable", chapterId: "chapter-1" };
  const attempts = [];
  outbox.enqueue("window-stable", body);

  assert.equal(await outbox.flush(async (sent) => {
    attempts.push(structuredClone(sent));
    throw new TypeError("connection reset");
  }), false);
  assert.equal(outbox.pending, 1);
  assert.equal(await outbox.flush(async (sent) => {
    attempts.push(structuredClone(sent));
    return new Response(null, { status: 204 });
  }), true);

  assert.deepEqual(attempts, [body, body]);
  assert.equal(outbox.pending, 0);
});

test("阅读事实队列按顺序发送且同一节点不会重复排队", async () => {
  const outbox = new ReadingFactOutbox();
  const sent = [];
  outbox.enqueue("node-a", { nodeId: "node-a" });
  outbox.enqueue("node-a", { nodeId: "node-a" });
  outbox.enqueue("node-b", { nodeId: "node-b" });
  assert.equal(outbox.pending, 2);
  await outbox.flush(async (body) => { sent.push(body); return Response.json({ ok: true }); });
  await outbox.flush(async (body) => { sent.push(body); return Response.json({ ok: true }); });
  assert.deepEqual(sent, [{ nodeId: "node-a" }, { nodeId: "node-b" }]);
});
