import type { ApiError, DraftRequest, MailEvent, SendRequest } from "@ionnet/shared";

export class ApiClientError extends Error {
  status: number;
  error: string;
  details: unknown;
  constructor(status: number, body: ApiError) {
    super(body.message || body.error || `Request failed (${status})`);
    this.name = "ApiClientError";
    this.status = status;
    this.error = body.error;
    this.details = body.details;
  }
}

export function isApiError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError;
}

export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parseError(res: Response): Promise<ApiClientError> {
  let body: ApiError = { error: "http_error", message: `${res.status} ${res.statusText}` };
  try {
    const j = (await res.json()) as Partial<ApiError>;
    if (j && typeof j === "object") {
      body = {
        error: j.error ?? "http_error",
        message: j.message ?? body.message,
        details: j.details,
      };
    }
  } catch {
    // ignore
  }
  return new ApiClientError(res.status, body);
}

async function request<T>(method: string, path: string, init: { body?: unknown; query?: Query; headers?: Record<string, string>; raw?: BodyInit } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(init.headers ?? {}) };
  let body: BodyInit | undefined;
  if (init.raw !== undefined) {
    body = init.raw;
  } else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(withQuery(path, init.query), { method, headers, body, credentials: "include" });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get<T>(path: string, query?: Query, headers?: Record<string, string>): Promise<T> {
    return request<T>("GET", path, { query, headers });
  },
  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return request<T>("POST", path, { body, headers });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>("PATCH", path, { body });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>("PUT", path, { body });
  },
  del<T>(path: string): Promise<T> {
    return request<T>("DELETE", path);
  },
  multipart<T>(method: "POST" | "PUT", path: string, payload: unknown, files: File[]): Promise<T> {
    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    for (const f of files) fd.append("files", f, f.name);
    return request<T>(method, path, { raw: fd });
  },
};

export function sendMail(payload: SendRequest, files: File[]): Promise<{ ok: true; messageId: string }> {
  return api.multipart("POST", "/api/mail/send", payload, files);
}

export function saveDraft(payload: DraftRequest, files: File[]): Promise<{ uid: number }> {
  return api.multipart("PUT", "/api/mail/drafts", payload, files);
}

export function attachmentUrl(folder: string, uid: number, partId: string): string {
  return `/api/mail/messages/${encodeURIComponent(folder)}/${uid}/attachments/${encodeURIComponent(partId)}`;
}

export function rawMessageUrl(folder: string, uid: number): string {
  return `/api/mail/messages/${encodeURIComponent(folder)}/${uid}/raw`;
}

/** Subscribe to mail events. Returns an unsubscribe function. */
export function subscribeMailEvents(onEvent: (e: MailEvent) => void, onStatus?: (connected: boolean) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    es = new EventSource("/api/mail/events", { withCredentials: true });
    es.onopen = () => {
      retry = 1000;
      onStatus?.(true);
    };
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as MailEvent;
        onEvent(data);
      } catch {
        // ignore malformed
      }
    };
    es.onerror = () => {
      onStatus?.(false);
      es?.close();
      es = null;
      if (!closed) {
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      }
    };
  };
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    es?.close();
  };
}
