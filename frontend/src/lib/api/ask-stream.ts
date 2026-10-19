import type { components } from "./types.gen";

type Event = components["schemas"]["AskStreamEvent"];
type Point = components["schemas"]["AnswerPoint"];
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function point(value: unknown): value is Point {
  return (
    object(value) &&
    typeof value.text === "string" &&
    ["FROM_DOCUMENT", "ESTIMATE", "NEEDS_CONFIRMATION"].includes(
      String(value.label),
    ) &&
    Array.isArray(value.citations) &&
    value.citations.length > 0 &&
    value.citations.every(
      (c) =>
        object(c) &&
        typeof c.doc === "string" &&
        Number.isInteger(c.page) &&
        Number(c.page) > 0 &&
        typeof c.quote === "string" &&
        c.quote.length > 0,
    )
  );
}
function event(value: unknown): value is Event {
  if (!object(value) || !object(value.data)) return false;
  switch (value.event) {
    case "progress":
      return ["retrieving", "validating"].includes(String(value.data.stage));
    case "answer_point":
      return point(value.data);
    case "redirect":
      return value.data.redirect === "emergency";
    case "error":
      return (
        typeof value.data.code === "string" &&
        typeof value.data.message === "string" &&
        typeof value.data.request_id === "string"
      );
    case "complete":
      return (
        Array.isArray(value.data.answer_points) &&
        value.data.answer_points.length <= 5 &&
        value.data.answer_points.every(point)
      );
    default:
      return false;
  }
}

export async function* readAskEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<Event> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    terminal = false,
    points = 0;
  const received: Point[] = [];
  const abort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 1_000_000) throw new Error("Respons terlalu besar.");
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const lines = frame.split("\n").filter((line) => !line.startsWith(":"));
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (terminal) throw new Error("Respons berlanjut setelah selesai.");
        const parsed: unknown = JSON.parse(data);
        if (!event(parsed)) throw new Error("Format respons tidak valid.");
        const named = lines
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
        if (named !== parsed.event)
          throw new Error("Nama event respons tidak cocok.");
        if (parsed.event === "answer_point" && ++points > 5)
          throw new Error("Terlalu banyak poin jawaban.");
        if (
          parsed.event === "complete" &&
          parsed.data.answer_points.length !== points
        )
          throw new Error("Jawaban akhir tidak cocok dengan aliran respons.");
        if (parsed.event === "answer_point") received.push(parsed.data);
        if (
          parsed.event === "complete" &&
          JSON.stringify(parsed.data.answer_points) !== JSON.stringify(received)
        )
          throw new Error("Isi jawaban akhir berubah dalam aliran respons.");
        terminal = ["complete", "error", "redirect"].includes(parsed.event);
        yield parsed;
      }
      if (chunk.done) break;
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!terminal || buffer.trim())
      throw new Error("Respons terputus sebelum selesai. Coba ulangi.");
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
