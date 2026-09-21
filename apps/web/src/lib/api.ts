import { MAIL_EVENT_TYPES, type ApiError, type DraftRequest, type MailEvent, type SendRequest } from "@ionnet/shared";

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

/** `onProgress` reports the upload as 0–1; only worth passing when there are attachments. */
export function sendMail(payload: SendRequest, files: File[], onProgress?: (fraction: number) => void): Promise<{ ok: true; messageId: string }> {
  if (!onProgress) return api.multipart("POST", "/api/mail/send", payload, files);
  // fetch can't report upload progress, XMLHttpRequest can
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    for (const f of files) fd.append("files", f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/mail/send");
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as { ok: true; messageId: string });
      const err = (body ?? {}) as Partial<ApiError>;
      reject(new ApiClientError(xhr.status, { error: err.error ?? "http_error", message: err.message ?? `${xhr.status} ${xhr.statusText}`, details: err.details }));
    };
    xhr.send(fd);
  });
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

/**
 * Subscribe to mail events. Returns an unsubscribe function.
 *
 * `onStatus` fires on every connect/disconnect: events that arrive while the
 * stream is down are lost, so callers should resync their cache on reconnect.
 */
export function subscribeMailEvents(onEvent: (e: MailEvent) => void, onStatus?: (connected: boolean) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const handle = (ev: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(ev.data) as MailEvent);
    } catch {
      // ignore malformed
    }
  };

  const connect = () => {
    if (closed) return;
    const src = new EventSource("/api/mail/events", { withCredentials: true });
    es = src;
    src.onopen = () => {
      retry = 1000;
      onStatus?.(true);
    };
    // The server tags each frame with its event type, so `onmessage` — which only
    // sees frames without an `event:` line — never fires. Subscribe by name.
    for (const type of MAIL_EVENT_TYPES) src.addEventListener(type, handle);
    src.onmessage = handle;
    src.onerror = () => {
      if (es !== src) return;
      onStatus?.(false);
      src.close();
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
    es = null;
  };
}
