export type ApiResult<T> = T & { ok: boolean };

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PUT ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function openLogStream(onMessage: (line: string) => void): EventSource {
  const source = new EventSource("/api/logs/stream");
  source.addEventListener("log", (event) => {
    if (event instanceof MessageEvent) {
      onMessage(event.data);
    }
  });
  return source;
}
