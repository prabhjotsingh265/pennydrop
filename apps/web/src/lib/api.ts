/** An answer from the API that wasn't a success, with the field to blame when there is one. */
export class ApiError extends Error {
  readonly status: number;
  readonly field: string | null;
  readonly issues: { path: PropertyKey[]; message: string }[];
  readonly retryAfter: number | null;

  constructor(
    status: number,
    message: string,
    extra: { field?: string; issues?: ApiError['issues']; retryAfter?: number } = {},
  ) {
    super(message);
    this.status = status;
    this.field = extra.field ?? null;
    this.issues = extra.issues ?? [];
    this.retryAfter = extra.retryAfter ?? null;
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/** JSON to and from the API on the same origin, so the session cookie goes along. */
export async function api<T>(
  path: string,
  { method = 'GET', body, signal }: Options = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, 'We can’t reach Pennydrop right now. Check your connection.');
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof data?.error === 'string' ? data.error : 'Something went wrong on our side.',
      {
        field: typeof data?.field === 'string' ? data.field : undefined,
        issues: Array.isArray(data?.issues) ? (data.issues as ApiError['issues']) : undefined,
        retryAfter: typeof data?.retryAfter === 'number' ? data.retryAfter : undefined,
      },
    );
  }
  return data as T;
}
