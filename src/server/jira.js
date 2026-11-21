// The Jira REST calls Wall makes, over an injected requester, so the same code
// runs in Forge (asApp or asUser) and in tests (a fake that serves fixtures).
//
// `request(path, init)` must resolve to a fetch-like response: { ok, status, json(), text() }.
// Paths are built with `path`, which URI-encodes every interpolated value.

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

/** Build a REST path; every interpolated value is URI-encoded. */
export function path(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(String(values[i])) : ''), '');
}

export class JiraError extends Error {
  constructor(status, requestPath, body) {
    super(`Jira answered ${status} for ${requestPath}`);
    this.name = 'JiraError';
    this.status = status;
    this.path = requestPath;
    this.body = body;
  }
}

async function readBody(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export function createJira(request) {
  async function call(requestPath, init) {
    const response = await request(requestPath, init);
    if (!response.ok) throw new JiraError(response.status, requestPath, await readBody(response));
    if (response.status === 204) return null;
    const text = await readBody(response);
    return text ? JSON.parse(text) : null;
  }

  return {
    get: (requestPath) => call(requestPath),
    post: (requestPath, body) => call(requestPath, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
    put: (requestPath, body) => call(requestPath, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) }),
    del: (requestPath) => call(requestPath, { method: 'DELETE' }),

    /**
     * Follow startAt/maxResults paging until isLast (or `limit` items).
     * @param {(startAt: number) => string} pageAt returns the path of the page starting at startAt
     */
    async paged(pageAt, { limit = 1000, key = 'values' } = {}) {
      const items = [];
      let startAt = 0;
      for (;;) {
        const page = await call(pageAt(startAt));
        const values = page?.[key] ?? [];
        items.push(...values);
        if (page?.isLast !== false || values.length === 0 || items.length >= limit) {
          return { items: items.slice(0, limit), complete: page?.isLast !== false && items.length <= limit };
        }
        startAt += values.length;
      }
    },
  };
}
