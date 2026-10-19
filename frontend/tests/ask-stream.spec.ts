import { test, expect } from "@playwright/test";
import { readAskEvents } from "../src/lib/api/ask-stream";

const point = {
  text: "Perlu verifikasi ✓",
  label: "FROM_DOCUMENT",
  citations: [
    { doc: "synthetic-doc", page: 1, quote: "Exact fictional quote" },
  ],
};
function frame(event: string, data: unknown) {
  return `event: ${event}\r\ndata: ${JSON.stringify({ event, data })}\r\n\r\n`;
}
function bytes(value: string, size = 3) {
  const encoded = new TextEncoder().encode(value);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < encoded.length; i += size)
        controller.enqueue(encoded.slice(i, i + size));
      controller.close();
    },
  });
}
test("SSE handles UTF-8 split bytes, CRLF, heartbeat and clean completion", async () => {
  const text =
    ": heartbeat\r\n\r\n" +
    frame("progress", { stage: "retrieving" }) +
    frame("answer_point", point) +
    frame("complete", { answer_points: [point] });
  const events = [];
  for await (const event of readAskEvents(bytes(text))) events.push(event);
  expect(events.map((e) => e.event)).toEqual([
    "progress",
    "answer_point",
    "complete",
  ]);
  expect(events[1].data).toMatchObject({ text: "Perlu verifikasi ✓" });
});
test("SSE rejects uncited points, name mismatch, incomplete and post-terminal data", async () => {
  for (const text of [
    frame("answer_point", { ...point, citations: [] }),
    `event: wrong\ndata: ${JSON.stringify({ event: "answer_point", data: point })}\n\n`,
    frame("answer_point", point),
    frame("complete", { answer_points: [] }) +
      frame("redirect", { redirect: "emergency" }),
  ]) {
    await expect(async () => {
      for await (const event of readAskEvents(bytes(text))) {
        void event;
      }
    }).rejects.toThrow();
  }
});
test("SSE supports explicit errors, emergency redirect and cancellation", async () => {
  for (const [name, data] of [
    [
      "error",
      {
        code: "AI_UNAVAILABLE",
        message: "Belum bisa menjawab",
        request_id: "test",
      },
    ],
    ["redirect", { redirect: "emergency" }],
  ] as const) {
    const result = [];
    for await (const event of readAskEvents(bytes(frame(name, data))))
      result.push(event.event);
    expect(result).toEqual([name]);
  }
  const controller = new AbortController();
  controller.abort();
  await expect(async () => {
    for await (const event of readAskEvents(bytes(""), controller.signal)) {
      void event;
    }
  }).rejects.toMatchObject({ name: "AbortError" });
});
