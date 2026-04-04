export type DbHealthResponse = {
  ok: boolean;
  result: number | null;
};

export type LiveItem = {
  live_id: number;
  live_date: string;
  live_title: string;
  bands: Array<number | string>;
  url: string | null;
};

export type LivesResponse = {
  items: LiveItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
};

const BASE_URL = "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 10000;

async function fetchWithTimeout(input: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkDbHealth(): Promise<DbHealthResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/health/db`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as DbHealthResponse;
}

export async function getLives(page: number, pageSize: 15 | 20): Promise<LivesResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const response = await fetchWithTimeout(`${BASE_URL}/api/lives?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as LivesResponse;
}
