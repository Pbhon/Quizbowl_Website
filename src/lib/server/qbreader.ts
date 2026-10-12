export async function qbreader(
  endpoint: string,
  params: URLSearchParams,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://www.qbreader.org/api/${endpoint}?${params}`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "QBReader is busy. Please wait a moment and retry."
        : "QBReader is unavailable. Please retry.",
    );
  return response.json();
}
