import { config } from "@/lib/config";
import type { components, paths } from "./types.gen";

type Schema = components["schemas"];
type Route = keyof paths;
type Operation<P extends Route, M extends keyof paths[P]> = NonNullable<
  paths[P][M]
>;
type SuccessBody<O> = O extends { responses: infer R }
  ? {
      [K in keyof R]: K extends 200 | 201 | 202
        ? R[K] extends { content: { "application/json": infer T } }
          ? T
          : never
        : never;
    }[keyof R]
  : never;
type RequestBody<O> = O extends {
  requestBody: { content: { "application/json": infer T } };
}
  ? T
  : never;
type GetRoute = {
  [P in Route]: paths[P] extends { get: object } ? P : never;
}[Route];
type WriteRoute<M extends "post" | "put"> = {
  [P in Route]: paths[P] extends Record<M, object> ? P : never;
}[Route];

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: Schema["ApiError"],
  ) {
    super(error.message);
  }
}

async function request<T>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("X-Demo-Session", token);
  if (init.body) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, {
      code: "NETWORK_ERROR",
      message:
        "Backend belum terhubung. Pastikan server berjalan di port 8000.",
      details: null,
      request_id: "local",
    });
  }
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({
        code: "INVALID_RESPONSE",
        message: "Respons server tidak dapat dibaca.",
        details: null,
        request_id: response.headers.get("X-Request-ID") ?? "unknown",
      }))) as Schema["ApiError"];
    throw new ApiClientError(response.status, error);
  }
  return response.json() as Promise<T>;
}

export const api = {
  get<P extends GetRoute>(
    path: P,
    token: string | null = null,
    query?: URLSearchParams,
  ): Promise<SuccessBody<Operation<P, "get">>> {
    return request(`${path}${query?.size ? `?${query}` : ""}`, token);
  },
  post<P extends WriteRoute<"post">>(
    path: P,
    token: string | null,
    body: RequestBody<Operation<P, "post">>,
  ): Promise<SuccessBody<Operation<P, "post">>> {
    return request(path, token, { method: "POST", body: JSON.stringify(body) });
  },
  put<P extends WriteRoute<"put">>(
    path: P,
    token: string,
    body: RequestBody<Operation<P, "put">>,
  ): Promise<SuccessBody<Operation<P, "put">>> {
    return request(path, token, { method: "PUT", body: JSON.stringify(body) });
  },
};
