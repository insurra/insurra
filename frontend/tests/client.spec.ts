import { test, expect } from "@playwright/test";
import { createApiClient, ApiClientError } from "../src/lib/api/client";

function fixture(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return response;
  };
  return { client: createApiClient("http://synthetic.test/", fetcher), calls };
}

test("typed query strings and legacy GET stay compatible", async () => {
  const { client, calls } = fixture(Response.json([]));
  await client.request("get", "/api/v1/audit", {
    token: "synthetic",
    query: { type: "consent", limit: 2, offset: 0 },
  });
  expect(calls[0].url).toBe(
    "http://synthetic.test/api/v1/audit?type=consent&limit=2&offset=0",
  );
  expect(new Headers(calls[0].init.headers).get("X-Demo-Session")).toBe(
    "synthetic",
  );
  const second = fixture(Response.json([]));
  await second.client.get(
    "/api/v1/audit",
    "synthetic",
    new URLSearchParams({ event_type: "CONSENT_GRANTED" }),
  );
  expect(second.calls[0].url).toContain("event_type=CONSENT_GRANTED");
});

test("multipart passes FormData without a manufactured Content-Type boundary", async () => {
  const { client, calls } = fixture(
    Response.json({ document_id: "synthetic", status: "QUEUED" }),
  );
  const form = new FormData();
  form.set("file", new Blob(["synthetic"]), "synthetic.pdf");
  await client.request("post", "/api/v1/documents", {
    token: "synthetic",
    body: form,
    headers: { "Content-Type": "application/json" },
  });
  expect(calls[0].init.body).toBe(form);
  expect(new Headers(calls[0].init.headers).has("Content-Type")).toBe(false);
});

test("PATCH and DELETE serialize JSON and encode dynamic identifiers", async () => {
  const patch = fixture(Response.json({}));
  await patch.client.patch("/api/v1/fields/{field_id}", {
    token: "synthetic",
    params: { field_id: "a/b ?" },
    body: { confirm: true, value: null },
  });
  expect(patch.calls[0].url.endsWith("/fields/a%2Fb%20%3F")).toBe(true);
  expect(patch.calls[0].init.method).toBe("PATCH");
  expect(JSON.parse(patch.calls[0].init.body as string)).toEqual({
    confirm: true,
    value: null,
  });
  const deletion = fixture(Response.json({ deleted: true }));
  await deletion.client.delete("/api/v1/documents/{document_id}", {
    token: "synthetic",
    params: { document_id: "owned-id" },
    body: { confirm: "HAPUS" },
  });
  expect(deletion.calls[0].init.method).toBe("DELETE");
  expect(new Headers(deletion.calls[0].init.headers).get("Content-Type")).toBe(
    "application/json",
  );
});

test("204 responses are not parsed as JSON", async () => {
  const { client } = fixture(new Response(null, { status: 204 }));
  const result: undefined = await client.request(
    "post",
    "/api/v1/auth/logout",
    { token: "synthetic" },
  );
  expect(result).toBeUndefined();
});

test("profile PUT unwraps the canonical envelope and GET keeps the legacy shape", async () => {
  const updated = fixture(
    Response.json({
      profile: { display_name: "Synthetic", city: "Synthetic" },
      suggested_docs: [],
    }),
  );
  const result = await updated.client.put("/api/v1/profile", "synthetic", {
    city: "Synthetic",
    priorities: [],
  });
  const name: string = result.profile.display_name;
  expect(name).toBe("Synthetic");
  expect(result.suggested_docs).toEqual([]);
  const existing = fixture(Response.json(result.profile));
  expect(
    (await existing.client.get("/api/v1/profile", "synthetic")).display_name,
  ).toBe(name);
});

test("stream transport exposes bytes, and still rejects API errors", async () => {
  const ok = fixture(
    new Response("event: complete\ndata: {}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }),
  );
  const stream = await ok.client.stream("post", "/api/v1/ask", {
    token: "synthetic",
    body: { question: "Synthetic?" },
  });
  expect(
    new TextDecoder().decode((await stream.getReader().read()).value),
  ).toContain("event: complete");
  expect(new Headers(ok.calls[0].init.headers).get("Accept")).toBe(
    "text/event-stream",
  );
  const failure = fixture(
    Response.json(
      {
        code: "NOT_IMPLEMENTED",
        message: "Deferred",
        details: null,
        request_id: "synthetic",
      },
      { status: 501 },
    ),
  );
  await expect(
    failure.client.stream("post", "/api/v1/ask", {
      token: "synthetic",
      body: { question: "Synthetic?" },
    }),
  ).rejects.toBeInstanceOf(ApiClientError);
});

test("malformed errors remain safe, and cancellation is preserved", async () => {
  const bad = fixture(
    new Response("private upstream text", {
      status: 502,
      headers: { "X-Request-ID": "synthetic" },
    }),
  );
  await expect(bad.client.get("/health")).rejects.toMatchObject({
    error: { code: "INVALID_RESPONSE", request_id: "synthetic" },
  });
  const abort = new AbortController();
  abort.abort();
  const client = createApiClient("http://synthetic.test", async () => {
    throw new DOMException("Aborted", "AbortError");
  });
  await expect(
    client.request("get", "/health", { signal: abort.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

// These compilation checks exercise generated schemas, not duplicated domain types.
function contractChecks(client: ReturnType<typeof createApiClient>) {
  // @ts-expect-error Dynamic routes require path parameters.
  void client.request("get", "/api/v1/documents/{document_id}", {
    token: "synthetic",
  });
  // @ts-expect-error JSON bodies cannot stand in for multipart uploads.
  void client.request("post", "/api/v1/documents", { body: { file: "wrong" } });
  void client.post("/api/v1/consents", null, {
    purpose: "external_ai",
    // @ts-expect-error Consent grants must be booleans.
    granted: "true",
  });
  // @ts-expect-error GET cannot call a POST-only endpoint.
  void client.request("get", "/api/v1/ask", {});
}
void contractChecks;

test("missing deployment API configuration fails clearly without a localhost request", async () => {
  let calls = 0;
  const client = createApiClient("", async () => {
    calls += 1;
    return new Response("{}");
  });
  await expect(client.get("/api/v1/home/summary")).rejects.toMatchObject({
    status: 0,
    error: { code: "BACKEND_NOT_CONFIGURED" },
  });
  expect(calls).toBe(0);
});
