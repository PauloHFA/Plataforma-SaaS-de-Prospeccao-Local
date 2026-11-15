export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(
      /\/$/,
      '',
    );
  }
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('plataforma_token');
}

export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem('plataforma_token', token);
  } else {
    window.localStorage.removeItem('plataforma_token');
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = any>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const token = getStoredToken();
  const headers = new Headers(init.headers);

  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const resp = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

  const text = await resp.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!resp.ok) {
    throw new ApiError(data?.error || `Erro HTTP ${resp.status}`, resp.status);
  }
  return data as T;
}
