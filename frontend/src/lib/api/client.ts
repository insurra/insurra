import { config } from "@/lib/config";
import type { components, paths } from "./types.gen";

type Method = "get" | "post" | "put" | "patch" | "delete";
type Route = keyof paths;
type RouteFor<M extends Method> = {
  [P in Route]: paths[P] extends Record<M, object> ? P : never;
}[Route];
type StaticRouteFor<M extends Method> = Exclude<
  RouteFor<M>,
  `${string}{${string}`
>;
type Operation<P extends Route, M extends Method> = M extends keyof paths[P]
  ? NonNullable<paths[P][M]>
  : never;
type SuccessBody<O> = O extends { responses: infer R }
  ? {
      [K in keyof R]: K extends 200 | 201 | 202 | 204 | 206
        ? R[K] extends { content: { "application/json": infer T } }
          ? T
          : undefined
        : never;
    }[keyof R]
  : never;
type Body<O> = O extends { requestBody?: infer R }
  ? NonNullable<R> extends { content: infer C }
    ? C extends { "application/json": infer J }
      ? J
      : C extends { "multipart/form-data": unknown }
        ? FormData
        : never
    : never
  : never;
type BodyOptions<O> = O extends { requestBody: unknown }
  ? { body: Body<O> }
  : { body?: Body<O> };
type PathOptions<O> = O extends { parameters: { path: infer P } }
  ? { params: P }
  : { params?: never };
type Query<O> = O extends { parameters: { query?: infer Q } }
  ? NonNullable<Q> | URLSearchParams
  : URLSearchParams;
type RequestOptions<O> = BodyOptions<O> &
  PathOptions<O> & {
    token?: string | null;
    query?: Query<O>;
    headers?: HeadersInit;
    signal?: AbortSignal;
  };
type BodyArgs<O> = O extends { requestBody: unknown }
  ? [body: Body<O>]
  : [body?: Body<O>];
type TransportOptions = {
  token?: string | null;
  body?: unknown;
  params?: Record<string, string | number>;
  query?: URLSearchParams | Record<string, unknown>;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: components["schemas"]["ApiError"],
  ) {
    super(error.message);
  }
}

export function createApiClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  async function transport(
    method: Method,
    path: string,
    options: TransportOptions,
    stream = false,
  ) {
    if (!baseUrl)
      throw new ApiClientError(0, {
        code: "BACKEND_NOT_CONFIGURED",
        message:
          "Backend is not configured for this deployment. Please contact the administrator.",
        details: null,
        request_id: "local",
      });
    const rendered = path.replace(/\{([^}]+)\}/g, (_, key: string) => {
      const value = options.params?.[key];
      if (value === undefined)
        throw new Error(`Missing path parameter: ${key}`);
      return encodeURIComponent(String(value));
    });
    const query =
      options.query instanceof URLSearchParams
        ? new URLSearchParams(options.query)
        : new URLSearchParams();
    if (options.query && !(options.query instanceof URLSearchParams)) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === null || value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value])
          query.append(key, String(item));
      }
    }
    const headers = new Headers(options.headers);
    if (options.token) headers.set("X-Demo-Session", options.token);
    const multipart = options.body instanceof FormData;
    if (multipart)
      headers.delete("Content-Type"); // The browser owns the multipart boundary.
    else if (options.body !== undefined)
      headers.set("Content-Type", "application/json");
    if (stream) headers.set("Accept", "text/event-stream");
    let response: Response;
    try {
      response = await fetcher(
        `${baseUrl.replace(/\/$/, "")}${rendered}${query.size ? `?${query}` : ""}`,
        {
          method: method.toUpperCase(),
          headers,
          cache: "no-store",
          signal: options.signal,
          body:
            options.body === undefined
              ? undefined
              : multipart
                ? (options.body as FormData)
                : JSON.stringify(options.body),
        },
      );
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiClientError(0, {
        code: "NETWORK_ERROR",
        message: "Backend is not connected. Check your connection or try again.",
        details: null,
        request_id: "local",
      });
    }
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const valid =
        payload !== null &&
        typeof payload === "object" &&
        "code" in payload &&
        "message" in payload &&
        "request_id" in payload;
      throw new ApiClientError(
        response.status,
        valid
          ? (payload as components["schemas"]["ApiError"])
          : {
              code: "INVALID_RESPONSE",
              message: "Server response could not be parsed.",
              details: null,
              request_id: response.headers.get("X-Request-ID") ?? "unknown",
            },
      );
    }
    return response;
  }

  async function request<M extends Method, P extends RouteFor<M>>(
    method: M,
    path: P,
    options: RequestOptions<Operation<P, M>>,
  ): Promise<SuccessBody<Operation<P, M>>> {
    const response = await transport(method, path, options as TransportOptions);
    if (response.status === 204 || response.status === 205)
      return undefined as SuccessBody<Operation<P, M>>;
    return response.json() as Promise<SuccessBody<Operation<P, M>>>;
  }

  return {
    request,
    get<P extends StaticRouteFor<"get">>(
      path: P,
      token: string | null = null,
      query?: Query<Operation<P, "get">>,
    ) {
      return request("get", path, { token, query } as RequestOptions<
        Operation<P, "get">
      >);
    },
    post<P extends StaticRouteFor<"post">>(
      path: P,
      token: string | null,
      ...args: BodyArgs<Operation<P, "post">>
    ) {
      return request("post", path, {
        token,
        body: args[0],
      } as unknown as RequestOptions<Operation<P, "post">>);
    },
    put<P extends StaticRouteFor<"put">>(
      path: P,
      token: string,
      ...args: BodyArgs<Operation<P, "put">>
    ) {
      return request("put", path, {
        token,
        body: args[0],
      } as unknown as RequestOptions<Operation<P, "put">>);
    },
    patch<P extends RouteFor<"patch">>(
      path: P,
      options: RequestOptions<Operation<P, "patch">>,
    ) {
      return request("patch", path, options);
    },
    delete<P extends RouteFor<"delete">>(
      path: P,
      options: RequestOptions<Operation<P, "delete">>,
    ) {
      return request("delete", path, options);
    },
    async stream<M extends Method, P extends RouteFor<M>>(
      method: M,
      path: P,
      options: RequestOptions<Operation<P, M>>,
    ): Promise<ReadableStream<Uint8Array>> {
      const response = await transport(
        method,
        path,
        options as TransportOptions,
        true,
      );
      if (
        !response.headers
          .get("Content-Type")
          ?.startsWith("text/event-stream") ||
        !response.body
      ) {
        throw new ApiClientError(response.status, {
          code: "INVALID_STREAM",
          message: "Streaming response is not available.",
          details: null,
          request_id: response.headers.get("X-Request-ID") ?? "unknown",
        });
      }
      return response.body;
    },
  };
}

export const api = createApiClient(config.apiBaseUrl);
