export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  }
  return data as T;
}

export function jsonRequest(body: unknown, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers || {});
  headers.set('content-type', 'application/json');
  return {
    ...init,
    headers,
    body: JSON.stringify(body)
  };
}

export function withDashboardToken(init: RequestInit | undefined, token: string): RequestInit | undefined {
  if (!token) return init;
  const headers = new Headers(init?.headers || {});
  headers.set('x-dashboard-token', token);
  return {
    ...init,
    headers
  };
}
