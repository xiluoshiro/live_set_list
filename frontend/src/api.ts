export type DbHealthResponse = {
  ok: boolean;
  result: number | null;
};

const BASE_URL = "http://localhost:8000";

export async function checkDbHealth(): Promise<DbHealthResponse> {
  const response = await fetch(`${BASE_URL}/api/health/db`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as DbHealthResponse;
}
