import { NextResponse } from "next/server";

const DEFAULT_BACKEND_URL = "http://localhost:3001";

function backendUrl(): string {
  return (process.env.QTRUST_BACKEND_URL ?? process.env.NEXT_PUBLIC_QTRUST_API_URL ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
}

function backendHeaders(): Headers {
  const headers = new Headers();
  headers.set("accept", "application/json");
  const apiKey = process.env.QTRUST_API_KEY ?? process.env.QTRUST_API_KEYS?.split(",")[0]?.trim();
  if (apiKey) headers.set("x-api-key", apiKey);
  return headers;
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const pathName = `/${path.join("/")}`;
  if (!pathName.startsWith("/v1/") && pathName !== "/health") {
    return NextResponse.json({ error: "API path is not available through this proxy" }, { status: 404 });
  }

  const headers = backendHeaders();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(65_000),
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  try {
    const response = await fetch(`${backendUrl()}${pathName}${new URL(request.url).search}`, init);
    const responseHeaders = new Headers();
    const responseType = response.headers.get("content-type");
    if (responseType) responseHeaders.set("content-type", responseType);
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json({ error: "Backend API unavailable" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const OPTIONS = proxy;
