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

export async function checkDbHealth(): Promise<DbHealthResponse> {
  const response = await fetch(`${BASE_URL}/api/health/db`);
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
  const response = await fetch(`${BASE_URL}/api/lives?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as LivesResponse;
}
