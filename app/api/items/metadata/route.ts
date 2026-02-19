import { NextRequest, NextResponse } from "next/server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\//i;

function errorResponse(status: number, code: string, message: string, fieldErrors?: Record<string, string>) {
  return NextResponse.json(
    {
      ok: false as const,
      error: { code, message, fieldErrors },
    },
    { status },
  );
}

function ownerEmailFromHeader(request: NextRequest) {
  const value = request.headers.get("x-owner-email")?.trim().toLowerCase() || "";
  if (!EMAIL_REGEX.test(value)) return null;
  return value;
}

function extractMeta(content: string, pattern: RegExp): string | null {
  const match = content.match(pattern);
  return match?.[1]?.trim() || null;
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".local")) return true;
  if (normalized === "127.0.0.1" || normalized === "0.0.0.0") return true;
  if (normalized === "::1") return true;

  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized)) return true;

  return false;
}

export async function POST(request: NextRequest) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to fetch metadata.");
  }

  const payload = (await request.json().catch(() => null)) as { url?: string } | null;
  const urlValue = payload?.url?.trim() || "";

  if (!urlValue || !URL_REGEX.test(urlValue)) {
    return errorResponse(422, "VALIDATION_ERROR", "Please provide a valid http/https URL.", {
      url: "URL must start with http:// or https://",
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    return errorResponse(422, "VALIDATION_ERROR", "Invalid URL format.", {
      url: "Invalid URL.",
    });
  }

  if (isPrivateHostname(parsed.hostname)) {
    return errorResponse(422, "VALIDATION_ERROR", "Private-network URLs are blocked for metadata fetch.", {
      url: "Private-network URLs are not allowed.",
    });
  }

  const timeoutMs = Number(process.env.METADATA_TIMEOUT_MS || 3500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 3500);

  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "WWishListBot/1.0 (+metadata)",
      },
    });

    if (!response.ok) {
      return errorResponse(502, "FETCH_FAILED", "Metadata source returned an error.");
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return errorResponse(422, "UNSUPPORTED_CONTENT", "Metadata source is not an HTML page.");
    }

    const html = await response.text();

    const title =
      extractMeta(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
      extractMeta(html, /<title[^>]*>([^<]+)<\/title>/i);

    const imageUrl =
      extractMeta(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) || null;

    const priceFromMeta =
      extractMeta(html, /<meta\s+property=["']product:price:amount["']\s+content=["']([^"']+)["']/i) ||
      extractMeta(html, /<meta\s+itemprop=["']price["']\s+content=["']([^"']+)["']/i);

    const price = priceFromMeta ? Number(priceFromMeta.replace(/[^\d.]/g, "")) : null;
    const priceCents = Number.isFinite(price) && price !== null ? Math.round(price * 100) : null;

    return NextResponse.json({
      ok: true as const,
      metadata: {
        title,
        imageUrl,
        priceCents,
      },
    });
  } catch {
    return errorResponse(504, "FETCH_TIMEOUT", "Unable to fetch metadata in time.");
  } finally {
    clearTimeout(timeout);
  }
}
