import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\//i;
const REQUEST_ID_REGEX = /^[a-zA-Z0-9._:-]{6,120}$/;
const DEFAULT_METADATA_TIMEOUT_MS = 5000;
const DEFAULT_OPENAI_TIMEOUT_MS = 9000;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const MAX_TEXT_CHARS = 12_000;
const MAX_IMAGE_CANDIDATES = 30;
const MAX_IMAGE_RETURN = 10;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 600;

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

function requestIdFromRequest(request: NextRequest): string {
  const raw = request.headers.get("x-request-id")?.trim() || "";
  if (REQUEST_ID_REGEX.test(raw)) return raw;
  return randomUUID();
}

function redactionModeFromEnv(raw: string | undefined): "strict" | "off" {
  return raw?.trim().toLowerCase() === "off" ? "off" : "strict";
}

function sanitizeHostForLog(parsed: URL, mode: "strict" | "off"): string {
  if (mode === "off") return parsed.host;
  return parsed.hostname;
}

function logMetadataFailure(input: {
  requestId: string;
  host: string;
  stage:
    | "blocked_private_host"
    | "fetch_failed"
    | "unsupported_content"
    | "timeout_or_network"
    | "openai_missing_key"
    | "openai_failed";
  status?: number;
}) {
  console.warn("metadata_fetch_failure", {
    requestId: input.requestId,
    host: input.host,
    stage: input.stage,
    status: input.status ?? null,
  });
}

function extractMeta(content: string, pattern: RegExp): string | null {
  const match = content.match(pattern);
  return match?.[1]?.trim() || null;
}

function extractAll(content: string, pattern: RegExp): string[] {
  return Array.from(content.matchAll(pattern)).map((match) => (match[1] || "").trim()).filter(Boolean);
}

function toAbsoluteHttpUrl(value: string, baseUrl: URL): string | null {
  try {
    const candidate = new URL(value, baseUrl.toString());
    if (candidate.protocol !== "http:" && candidate.protocol !== "https:") return null;
    return candidate.toString();
  } catch {
    return null;
  }
}

function normalizeImageUrls(candidates: string[], baseUrl: URL): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of candidates) {
    if (!raw) continue;
    const absolute = toAbsoluteHttpUrl(raw, baseUrl);
    if (!absolute || seen.has(absolute)) continue;
    seen.add(absolute);
    normalized.push(absolute);
    if (normalized.length >= MAX_IMAGE_CANDIDATES) break;
  }

  return normalized;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  )
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function parsePriceToCents(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const price = Number(cleaned);
  if (!Number.isFinite(price) || price < 0) return null;
  return Math.round(price * 100);
}

function parseNumberPriceToCents(raw: number | null): number | null {
  if (raw === null) return null;
  if (!Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw * 100);
}

function cleanTitle(value: string | null): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, TITLE_MAX);
}

function cleanDescription(value: string | null): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, DESCRIPTION_MAX);
}

function fallbackMetadata(html: string, pageUrl: URL) {
  const title =
    extractMeta(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<title[^>]*>([^<]+)<\/title>/i);

  const description =
    extractMeta(html, /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
    null;

  const priceFromMeta =
    extractMeta(html, /<meta\s+property=["']product:price:amount["']\s+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<meta\s+itemprop=["']price["']\s+content=["']([^"']+)["']/i) ||
    null;

  const imageCandidates = [
    ...extractAll(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/gi),
    ...extractAll(html, /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/gi),
    ...extractAll(html, /<img[^>]+src=["']([^"']+)["']/gi),
    ...extractAll(html, /<img[^>]+data-src=["']([^"']+)["']/gi),
  ];

  return {
    title: cleanTitle(title),
    description: cleanDescription(description),
    priceCents: parsePriceToCents(priceFromMeta),
    imageUrls: normalizeImageUrls(imageCandidates, pageUrl),
  };
}

type AiMetadata = {
  title: string | null;
  description: string | null;
  price: number | null;
  imageUrls: string[];
};

function extractChatContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const maybeChoices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) return null;

  const firstChoice = maybeChoices[0] as { message?: { content?: unknown } };
  const content = firstChoice?.message?.content;
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
    return joined || null;
  }

  return null;
}

function parseAiMetadata(content: string): AiMetadata | null {
  try {
    const parsed = JSON.parse(content) as Partial<AiMetadata>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : null,
      description: typeof parsed.description === "string" ? parsed.description : null,
      price: typeof parsed.price === "number" ? parsed.price : null,
      imageUrls: Array.isArray(parsed.imageUrls)
        ? parsed.imageUrls.filter((value): value is string => typeof value === "string")
        : [],
    };
  } catch {
    return null;
  }
}

async function inferMetadataWithOpenAi(input: {
  openAiApiKey: string;
  openAiModel: string;
  openAiTimeoutMs: number;
  sourceUrl: string;
  pageText: string;
  candidateImageUrls: string[];
  fallbackTitle: string | null;
  fallbackDescription: string | null;
  fallbackPriceCents: number | null;
}): Promise<AiMetadata | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.openAiTimeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: input.openAiModel,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "product_metadata",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: ["string", "null"] },
                description: { type: ["string", "null"] },
                price: { type: ["number", "null"] },
                imageUrls: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: MAX_IMAGE_RETURN,
                },
              },
              required: ["title", "description", "price", "imageUrls"],
            },
          },
        },
        messages: [
          {
            role: "system",
            content:
              "Extract product metadata from the provided webpage data. Return null for unknown fields. Do not invent facts. For imageUrls, prefer actual product photos from candidateImageUrls.",
          },
          {
            role: "user",
            content: JSON.stringify({
              url: input.sourceUrl,
              titleHint: input.fallbackTitle,
              descriptionHint: input.fallbackDescription,
              priceHintCents: input.fallbackPriceCents,
              candidateImageUrls: input.candidateImageUrls,
              pageText: input.pageText,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    const rawContent = extractChatContent(payload);
    if (!rawContent) return null;

    return parseAiMetadata(rawContent);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
  const requestId = requestIdFromRequest(request);
  const logMode = redactionModeFromEnv(process.env.LOG_REDACTION_MODE);
  const openAiApiKey = (process.env.OPENAI_API_KEY || "").trim();
  const openAiModel = (process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();

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
    logMetadataFailure({
      requestId,
      host: sanitizeHostForLog(parsed, logMode),
      stage: "blocked_private_host",
    });
    return errorResponse(422, "VALIDATION_ERROR", "Private-network URLs are blocked for metadata fetch.", {
      url: "Private-network URLs are not allowed.",
    });
  }

  const timeoutMs = Number(process.env.METADATA_TIMEOUT_MS || DEFAULT_METADATA_TIMEOUT_MS);
  const openAiTimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || DEFAULT_OPENAI_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_METADATA_TIMEOUT_MS,
  );

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
      logMetadataFailure({
        requestId,
        host: sanitizeHostForLog(parsed, logMode),
        stage: "fetch_failed",
        status: response.status,
      });
      return errorResponse(502, "FETCH_FAILED", "Metadata source returned an error.");
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      logMetadataFailure({
        requestId,
        host: sanitizeHostForLog(parsed, logMode),
        stage: "unsupported_content",
      });
      return errorResponse(422, "UNSUPPORTED_CONTENT", "Metadata source is not an HTML page.");
    }

    const html = await response.text();
    const fallback = fallbackMetadata(html, parsed);
    const candidateImageUrls = fallback.imageUrls.slice(0, MAX_IMAGE_CANDIDATES);
    const pageText = htmlToText(html);

    if (!openAiApiKey) {
      logMetadataFailure({
        requestId,
        host: sanitizeHostForLog(parsed, logMode),
        stage: "openai_missing_key",
      });
      return errorResponse(500, "AI_CONFIG_MISSING", "OPENAI_API_KEY is not configured on the server.");
    }

    const aiMetadata = await inferMetadataWithOpenAi({
      openAiApiKey,
      openAiModel,
      openAiTimeoutMs: Number.isFinite(openAiTimeoutMs) && openAiTimeoutMs > 0 ? openAiTimeoutMs : DEFAULT_OPENAI_TIMEOUT_MS,
      sourceUrl: parsed.toString(),
      pageText,
      candidateImageUrls,
      fallbackTitle: fallback.title,
      fallbackDescription: fallback.description,
      fallbackPriceCents: fallback.priceCents,
    });

    if (!aiMetadata) {
      logMetadataFailure({
        requestId,
        host: sanitizeHostForLog(parsed, logMode),
        stage: "openai_failed",
      });
    }

    const mergedImageUrls = normalizeImageUrls(
      aiMetadata && aiMetadata.imageUrls.length > 0 ? aiMetadata.imageUrls : candidateImageUrls,
      parsed,
    ).slice(0, MAX_IMAGE_RETURN);
    const title = cleanTitle(aiMetadata?.title || fallback.title);
    const description = cleanDescription(aiMetadata?.description || fallback.description);
    const priceCents = parseNumberPriceToCents(aiMetadata?.price ?? null) ?? fallback.priceCents;

    return NextResponse.json({
      ok: true as const,
      metadata: {
        title,
        description,
        imageUrl: mergedImageUrls[0] || null,
        imageUrls: mergedImageUrls,
        priceCents,
      },
    });
  } catch {
    logMetadataFailure({
      requestId,
      host: sanitizeHostForLog(parsed, logMode),
      stage: "timeout_or_network",
    });
    return errorResponse(504, "FETCH_TIMEOUT", "Unable to fetch metadata in time.");
  } finally {
    clearTimeout(timeout);
  }
}
