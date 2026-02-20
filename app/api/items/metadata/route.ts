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
const MAX_IMAGE_RETURN = 8;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 600;
const AMAZON_HOST_REGEX = /(^|\.)amazon\./i;

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

function cleanJsonLd(raw: string): string {
  return raw
    .trim()
    .replace(/^<!--/, "")
    .replace(/-->$/, "")
    .replace(/^\s*\/\/<!\[CDATA\[/, "")
    .replace(/\/\/\]\]>\s*$/, "")
    .trim();
}

type JsonLdPriceCandidate = {
  raw: string;
  path: string;
};

function collectJsonLdPriceCandidates(value: unknown, path: string, out: JsonLdPriceCandidate[]) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectJsonLdPriceCandidates(entry, `${path}[${index}]`, out);
    });
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const keyLower = key.toLowerCase();
    const nextPath = path ? `${path}.${keyLower}` : keyLower;

    if (
      (keyLower === "price" || keyLower === "lowprice" || keyLower === "highprice") &&
      (typeof entry === "string" || typeof entry === "number")
    ) {
      out.push({ raw: String(entry), path: nextPath });
    }

    collectJsonLdPriceCandidates(entry, nextPath, out);
  }
}

function scoreJsonLdPricePath(path: string): number {
  const normalizedPath = path.toLowerCase();
  let score = 0;
  if (normalizedPath.includes("offers.price")) score += 6;
  if (normalizedPath.endsWith(".price")) score += 3;
  if (normalizedPath.includes("lowprice")) score += 2;
  if (normalizedPath.includes("highprice")) score += 1;
  if (normalizedPath.includes("shipping")) score -= 5;
  if (normalizedPath.includes("listprice")) score -= 1;
  return score;
}

function extractPriceCentsFromJsonLd(html: string): number | null {
  const blocks = extractAll(
    html,
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  let best: { cents: number; score: number } | null = null;

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanJsonLd(block));
    } catch {
      continue;
    }

    const candidates: JsonLdPriceCandidate[] = [];
    collectJsonLdPriceCandidates(parsed, "", candidates);

    for (const candidate of candidates) {
      const cents = parsePriceToCents(candidate.raw);
      if (cents === null || cents < 50 || cents > 50_000_000) continue;
      const score = scoreJsonLdPricePath(candidate.path);
      if (!best || score > best.score) {
        best = { cents, score };
      }
    }
  }

  return best?.cents ?? null;
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
  const compact = raw.replace(/\s+/g, "").replace(/[^\d.,]/g, "");
  if (!compact) return null;

  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  let normalized = compact;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalIndex = Math.max(lastDot, lastComma);
    const intPart = compact.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fracPart = compact.slice(decimalIndex + 1).replace(/[.,]/g, "");
    if (!intPart || fracPart.length === 0 || fracPart.length > 2) {
      normalized = compact.replace(/[.,]/g, "");
    } else {
      normalized = `${intPart}.${fracPart}`;
    }
  } else if (lastComma >= 0) {
    const intPart = compact.slice(0, lastComma).replace(/[.,]/g, "");
    const fracPart = compact.slice(lastComma + 1).replace(/[.,]/g, "");
    if (intPart && fracPart.length === 2) {
      normalized = `${intPart}.${fracPart}`;
    } else {
      normalized = compact.replace(/,/g, "");
    }
  } else if (lastDot >= 0) {
    const intPart = compact.slice(0, lastDot).replace(/[.,]/g, "");
    const fracPart = compact.slice(lastDot + 1).replace(/[.,]/g, "");
    if (intPart && fracPart.length === 2) {
      normalized = `${intPart}.${fracPart}`;
    } else if (fracPart.length === 3) {
      normalized = `${intPart}${fracPart}`;
    } else if (fracPart.length === 0) {
      normalized = intPart;
    } else {
      normalized = `${intPart}.${fracPart}`;
    }
  } else {
    normalized = compact;
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const price = Number(normalized);
  if (!Number.isFinite(price) || price < 0) return null;
  return Math.round(price * 100);
}

function parseNumberPriceToCents(raw: number | null): number | null {
  if (raw === null) return null;
  if (!Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw * 100);
}

function isLikelyRoundedFromHint(aiPriceCents: number, hintPriceCents: number): boolean {
  if (aiPriceCents % 100 !== 0) return false;
  if (hintPriceCents % 100 === 0) return false;
  return Math.trunc(aiPriceCents / 100) === Math.trunc(hintPriceCents / 100);
}

function shouldTrustAiPrice(aiPriceCents: number | null, baselinePriceCents: number | null): boolean {
  if (aiPriceCents === null) return false;
  if (baselinePriceCents === null) return true;

  if (isLikelyRoundedFromHint(aiPriceCents, baselinePriceCents)) {
    return false;
  }

  const delta = Math.abs(aiPriceCents - baselinePriceCents);
  if (delta <= 49) return true;

  const ratio = aiPriceCents / baselinePriceCents;
  return ratio >= 0.9 && ratio <= 1.1;
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

function looksLikeMarketplaceOnlyText(value: string | null, parsed: URL): boolean {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return true;
  const host = parsed.hostname.toLowerCase();

  if (AMAZON_HOST_REGEX.test(host)) {
    return normalized === "amazon" || normalized === "amazon.com";
  }

  return false;
}

function sanitizeMarketplaceTitle(value: string | null, parsed: URL): string | null {
  if (!value) return null;
  let normalized = value.trim();
  const host = parsed.hostname.toLowerCase();

  if (AMAZON_HOST_REGEX.test(host)) {
    normalized = normalized.replace(/^amazon\.com:\s*/i, "");
    const categoryDivider = normalized.lastIndexOf(" : ");
    if (categoryDivider > 8) {
      normalized = normalized.slice(0, categoryDivider).trim();
    }
    if (/^amazon(\.com)?$/i.test(normalized)) {
      return null;
    }
  }

  return cleanTitle(normalized);
}

function pickBestTitle(primary: string | null, fallback: string | null): string | null {
  const safePrimary = cleanTitle(primary);
  const safeFallback = cleanTitle(fallback);
  if (!safePrimary) return safeFallback;
  if (!safeFallback) return safePrimary;

  // If AI returns a short slug-like title but fallback has richer product wording, keep fallback.
  if (safePrimary.length < 42 && safeFallback.length - safePrimary.length >= 14) {
    return safeFallback;
  }

  return safePrimary;
}

function titleFromPathSlug(parsed: URL): string | null {
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const dpIndex = segments.findIndex((segment) => segment.toLowerCase() === "dp");
  const rawSlug = dpIndex > 0 ? segments[dpIndex - 1] : segments[segments.length - 1];
  if (!rawSlug) return null;
  if (/^[A-Z0-9]{10}$/i.test(rawSlug)) return null;

  const normalized = decodeURIComponent(rawSlug)
    .replace(/\+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleanTitle(normalized);
}

function extractPriceCentsFromText(text: string): number | null {
  const candidates: Array<{ cents: number; score: number; index: number }> = [];
  const frequency = new Map<number, number>();
  const negativeContext = /\b(delivery|shipping|tax|coupon|discount|save|off|points|review|rating|month|monthly|installment|pack)\b/i;
  const positiveContext = /\b(price|our price|buy now|add to cart|subtotal|in stock|sale)\b/i;

  const matches = [
    ...Array.from(
      text.matchAll(
        /(US?\$|\$|€|£|USD|EUR|GBP|CAD|AUD|JPY)\s*([0-9]{1,6}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)/gi,
      ),
    ).map((match) => ({ match, rawAmount: match[2] })),
    ...Array.from(
      text.matchAll(
        /([0-9]{1,6}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)\s*(USD|EUR|GBP|CAD|AUD|JPY|€|£)/gi,
      ),
    ).map((match) => ({ match, rawAmount: match[1] })),
  ];

  for (const { match, rawAmount } of matches) {
    const cents = parsePriceToCents(rawAmount);
    if (cents === null || cents < 50 || cents > 50_000_000) continue;

    const index = typeof match.index === "number" ? match.index : 0;
    const start = Math.max(0, index - 70);
    const end = Math.min(text.length, index + 120);
    const context = text.slice(start, end);

    let score = 0;
    if (positiveContext.test(context)) score += 4;
    if (negativeContext.test(context)) score -= 5;
    if (cents % 100 !== 0) score += 1;
    if (cents >= 500 && cents <= 2_000_000) score += 1;

    frequency.set(cents, (frequency.get(cents) || 0) + 1);
    candidates.push({ cents, score, index });
  }

  let best: { cents: number; score: number; index: number } | null = null;
  for (const candidate of candidates) {
    const occurrenceBonus = (frequency.get(candidate.cents) || 1) - 1;
    const finalScore = candidate.score + occurrenceBonus * 3;

    if (!best) {
      best = { ...candidate, score: finalScore };
      continue;
    }

    if (finalScore > best.score) {
      best = { ...candidate, score: finalScore };
      continue;
    }

    if (finalScore === best.score && candidate.index < best.index) {
      best = { ...candidate, score: finalScore };
    }
  }

  return best?.cents ?? null;
}

function isLikelyDecorativeImageUrl(imageUrl: string): boolean {
  const lower = imageUrl.toLowerCase();
  if (lower.includes("sprite")) return true;
  if (lower.includes("logo")) return true;
  if (lower.includes("icon")) return true;
  if (lower.includes("pixel")) return true;
  if (lower.includes("tracking")) return true;
  if (lower.includes("fls-na.amazon.com")) return true;
  if (lower.endsWith(".svg")) return true;
  return false;
}

function rankCandidateImageUrls(urls: string[], pageUrl: URL): string[] {
  const filtered = urls.filter((url) => !isLikelyDecorativeImageUrl(url));
  if (filtered.length === 0) return urls;

  const host = pageUrl.hostname.toLowerCase();
  if (!AMAZON_HOST_REGEX.test(host)) {
    return filtered;
  }

  const amazonProductImages = filtered.filter((url) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.toLowerCase() !== "m.media-amazon.com") return false;
      if (!/\/images\/i\//i.test(parsed.pathname)) return false;
      if (!/\.(jpe?g|webp)$/i.test(parsed.pathname)) return false;
      return true;
    } catch {
      return false;
    }
  });

  if (amazonProductImages.length === 0) {
    return filtered;
  }

  return [...amazonProductImages].sort((a, b) => {
    const aScore = /_ac_sx\d+_/i.test(a) || /_ac_sy\d+_/i.test(a) ? 2 : /_ac_us100_/i.test(a) ? 0 : 1;
    const bScore = /_ac_sx\d+_/i.test(b) || /_ac_sy\d+_/i.test(b) ? 2 : /_ac_us100_/i.test(b) ? 0 : 1;
    return bScore - aScore;
  });
}

function isLikelyBotBlockPage(html: string, parsed: URL, fallbackTitle: string | null): boolean {
  if (!AMAZON_HOST_REGEX.test(parsed.hostname)) return false;
  const lowerHtml = html.toLowerCase();
  const lowerTitle = (fallbackTitle || "").trim().toLowerCase();

  if (lowerTitle === "amazon.com" || lowerTitle === "amazon") return true;
  if (lowerHtml.includes("opfcaptcha.amazon.com")) return true;
  if (lowerHtml.includes("errors/validatecaptcha")) return true;
  if (lowerHtml.includes("continue shopping")) return true;
  if (lowerHtml.includes("automated access to amazon data")) return true;
  return false;
}

function buildReaderMirrorUrl(sourceUrl: string): string {
  return `https://r.jina.ai/http://${sourceUrl.replace(/^https?:\/\//i, "")}`;
}

async function fetchMirrorMarkdown(sourceUrl: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildReaderMirrorUrl(sourceUrl), {
      method: "GET",
      signal: controller.signal,
      headers: {
        "user-agent": "WWishListBot/1.0 (+metadata)",
      },
    });

    if (!response.ok) return null;
    const text = await response.text();
    return text.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackMetadataFromMirror(markdown: string, pageUrl: URL) {
  const titleMatch = markdown.match(/^Title:\s*(.+)$/im);
  const title = titleMatch?.[1]?.trim() || null;

  const aboutSection =
    markdown.match(/\nAbout this item\s*\n=+\s*\n([\s\S]{0,2600})/i)?.[1] ||
    markdown.match(/\nAbout this item\s*\n([\s\S]{0,2600})/i)?.[1] ||
    "";
  const aboutBullets = Array.from(aboutSection.matchAll(/^\*\s+(.+)$/gm))
    .map((match) => match[1].trim())
    .filter(
      (line) =>
        line.length >= 24 &&
        !/^See more product details/i.test(line) &&
        !/\[[^\]]+\]\(http/i.test(line),
    );
  const descriptionFromBullets =
    aboutBullets.length > 0 ? cleanDescription(aboutBullets.slice(0, 2).join(" ")) : null;
  const buyLineDescription =
    markdown.match(/\bBuy\s+(.+?)\s*:\s*[^-\n]+-\s*Amazon\.com/i)?.[1]?.trim() || null;
  const description = cleanDescription(descriptionFromBullets || buyLineDescription);

  const imageCandidates = [
    ...Array.from(markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)).map((match) => match[1]),
    ...Array.from(markdown.matchAll(/https?:\/\/[^\s)]+/g)).map((match) => match[0]),
  ];

  return {
    title: sanitizeMarketplaceTitle(title, pageUrl),
    description,
    priceCents: extractPriceCentsFromText(markdown),
    imageUrls: rankCandidateImageUrls(normalizeImageUrls(imageCandidates, pageUrl), pageUrl),
    sourceText: markdown.slice(0, MAX_TEXT_CHARS),
  };
}

function fallbackMetadata(html: string, pageUrl: URL) {
  const title =
    extractMeta(html, /<meta\s+name=["']title["']\s+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<title[^>]*>([^<]+)<\/title>/i) ||
    extractMeta(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i);

  const description =
    extractMeta(html, /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
    null;

  const priceFromMeta =
    extractMeta(html, /<meta\s+property=["']product:price:amount["']\s+content=["']([^"']+)["']/i) ||
    extractMeta(html, /<meta\s+itemprop=["']price["']\s+content=["']([^"']+)["']/i) ||
    null;
  const priceCentsFromJsonLd = extractPriceCentsFromJsonLd(html);

  const imageCandidates = [
    ...extractAll(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/gi),
    ...extractAll(html, /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/gi),
    ...extractAll(html, /<img[^>]+src=["']([^"']+)["']/gi),
    ...extractAll(html, /<img[^>]+data-src=["']([^"']+)["']/gi),
  ];

  const cleanedDescription = looksLikeMarketplaceOnlyText(description, pageUrl)
    ? null
    : cleanDescription(description);

  return {
    title: sanitizeMarketplaceTitle(title, pageUrl),
    description: cleanedDescription,
    priceCents: parsePriceToCents(priceFromMeta) ?? priceCentsFromJsonLd,
    imageUrls: rankCandidateImageUrls(normalizeImageUrls(imageCandidates, pageUrl), pageUrl),
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
              "Extract product metadata from the provided webpage data. Return null for unknown fields. Do not invent facts. For imageUrls, prefer actual product photos from candidateImageUrls. For price, return the exact product price with cents as shown on the page; never round (19.99 must stay 19.99). Ignore shipping, coupons, monthly payments, and accessory prices.",
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
    let sourceText = htmlToText(html);
    let titleHint = fallback.title || titleFromPathSlug(parsed);
    let descriptionHint = fallback.description;
    let priceHintCents = fallback.priceCents ?? extractPriceCentsFromText(sourceText);
    let candidateImageUrls = fallback.imageUrls.slice(0, MAX_IMAGE_CANDIDATES);

    const shouldUseMirror =
      AMAZON_HOST_REGEX.test(parsed.hostname) ||
      isLikelyBotBlockPage(html, parsed, fallback.title);

    if (shouldUseMirror) {
      const mirrorMarkdown = await fetchMirrorMarkdown(parsed.toString(), 6500);
      if (mirrorMarkdown) {
        const mirrorFallback = fallbackMetadataFromMirror(mirrorMarkdown, parsed);
        sourceText = mirrorFallback.sourceText || sourceText;
        titleHint = mirrorFallback.title || titleHint || titleFromPathSlug(parsed);
        descriptionHint = mirrorFallback.description || descriptionHint;
        priceHintCents = mirrorFallback.priceCents ?? priceHintCents;
        if (mirrorFallback.imageUrls.length > 0) {
          candidateImageUrls = mirrorFallback.imageUrls.slice(0, MAX_IMAGE_CANDIDATES);
        }
      }
    }

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
      pageText: sourceText,
      candidateImageUrls,
      fallbackTitle: titleHint,
      fallbackDescription: descriptionHint,
      fallbackPriceCents: priceHintCents,
    });

    if (!aiMetadata) {
      logMetadataFailure({
        requestId,
        host: sanitizeHostForLog(parsed, logMode),
        stage: "openai_failed",
      });
    }

    const aiImageUrls =
      aiMetadata && aiMetadata.imageUrls.length > 0
        ? rankCandidateImageUrls(normalizeImageUrls(aiMetadata.imageUrls, parsed), parsed)
        : [];
    const mergedImageUrls = normalizeImageUrls(
      aiImageUrls.length > 0 ? aiImageUrls : candidateImageUrls,
      parsed,
    ).slice(0, MAX_IMAGE_RETURN);

    const fallbackTitle = titleHint || titleFromPathSlug(parsed);
    const title = pickBestTitle(sanitizeMarketplaceTitle(aiMetadata?.title || null, parsed), fallbackTitle);

    const rawDescription = aiMetadata?.description || descriptionHint;
    const description = looksLikeMarketplaceOnlyText(rawDescription, parsed) ? null : cleanDescription(rawDescription);

    const textExtractedPriceCents = extractPriceCentsFromText(sourceText);
    const baselinePriceCents = priceHintCents ?? textExtractedPriceCents;
    const aiPriceCents = parseNumberPriceToCents(aiMetadata?.price ?? null);
    const priceCents = shouldTrustAiPrice(aiPriceCents, baselinePriceCents)
      ? aiPriceCents
      : baselinePriceCents ?? aiPriceCents;

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
