import { NextRequest, NextResponse } from "next/server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_OPENAI_TIMEOUT_MS = 8000;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const TITLE_MAX = 120;
const TITLE_WORD_MAX = 6;
const DESCRIPTION_MAX = 600;
const DESCRIPTION_BULLET_MAX = 5;
const DESCRIPTION_BULLET_LINE_MAX = 120;
const MAX_DRAFT_TEXT_CHARS = 4000;

type ApiErrorCode = "AUTH_REQUIRED" | "VALIDATION_ERROR" | "AI_CONFIG_MISSING" | "INTERNAL_ERROR";

type ParsedDraftPayload = {
  title: string | null;
  descriptionBullets: string[];
  priceCents: number | null;
  priceNeedsReview: boolean;
};

function errorResponse(status: number, code: ApiErrorCode, message: string, fieldErrors?: Record<string, string>) {
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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
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
    if (intPart && fracPart.length <= 2) {
      normalized = `${intPart}.${fracPart}`;
    } else {
      normalized = `${intPart}${fracPart}`;
    }
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function trimWords(value: string, maxWords: number): string {
  const words = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function cleanTitle(value: string | null): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, TITLE_MAX);
}

function buildConciseTitle(value: string | null): string | null {
  const cleaned = cleanTitle(value);
  if (!cleaned) return null;
  return cleanTitle(trimWords(cleaned, TITLE_WORD_MAX));
}

function normalizeBulletLine(value: string): string | null {
  const normalized = value
    .replace(/^\s*(?:[-*•●▪◦]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, DESCRIPTION_BULLET_LINE_MAX);
}

function normalizeBullets(lines: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const normalized = normalizeBulletLine(line);
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    next.push(normalized);
    if (next.length >= DESCRIPTION_BULLET_MAX) break;
  }
  return next;
}

function bulletsToDescription(lines: string[]): string | null {
  const normalized = normalizeBullets(lines);
  if (normalized.length === 0) return null;
  return normalized
    .map((line) => `• ${line}`)
    .join("\n")
    .slice(0, DESCRIPTION_MAX);
}

function extractPriceCentsFromText(text: string): number | null {
  const match = text.match(
    /(US?\$|\$|€|£|USD|EUR|GBP|CAD|AUD|JPY)\s*([0-9]{1,6}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)|([0-9]{1,6}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)\s*(USD|EUR|GBP|CAD|AUD|JPY|€|£)/i,
  );
  if (!match) return null;
  const raw = match[2] || match[3] || null;
  return parsePriceToCents(raw);
}

function fallbackParseDraftText(draftText: string) {
  const lines = draftText
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const titleCandidate =
    lines
      .map((line) => line.replace(/^title\s*:\s*/i, "").trim())
      .find((line) => line.length > 0 && !/^price\s*:/i.test(line)) || null;

  const descriptionCandidates = lines
    .map((line) => line.replace(/^description\s*:\s*/i, "").trim())
    .filter((line) => line.length > 0 && !/^title\s*:/i.test(line) && !/^price\s*:/i.test(line));

  const priceCents = extractPriceCentsFromText(draftText);

  return {
    title: buildConciseTitle(titleCandidate),
    description: bulletsToDescription(descriptionCandidates),
    priceCents,
  };
}

function extractChatContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const firstChoice = choices[0] as { message?: { content?: unknown } };
  const content = firstChoice?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const joined = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");

  return joined || null;
}

function parseAiPayload(raw: string): ParsedDraftPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ParsedDraftPayload>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : null,
      descriptionBullets: Array.isArray(parsed.descriptionBullets)
        ? parsed.descriptionBullets.filter((entry): entry is string => typeof entry === "string")
        : [],
      priceCents: Number.isInteger(parsed.priceCents) && (parsed.priceCents || 0) >= 0 ? (parsed.priceCents as number) : null,
      priceNeedsReview: Boolean(parsed.priceNeedsReview),
    };
  } catch {
    return null;
  }
}

async function inferDraftFieldsWithOpenAi(input: {
  openAiApiKey: string;
  openAiModel: string;
  timeoutMs: number;
  draftText: string;
}): Promise<ParsedDraftPayload | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

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
            name: "draft_item_parser",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: ["string", "null"] },
                descriptionBullets: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: DESCRIPTION_BULLET_MAX,
                },
                priceCents: { type: ["integer", "null"] },
                priceNeedsReview: { type: "boolean" },
              },
              required: ["title", "descriptionBullets", "priceCents", "priceNeedsReview"],
            },
          },
        },
        messages: [
          {
            role: "system",
            content:
              "Parse mixed user text into item fields. Keep title concise (max 6 words). Put key features/specs into up to 5 short bullets. Detect item price as integer cents when present, otherwise null. Mark priceNeedsReview true if missing or uncertain.",
          },
          {
            role: "user",
            content: JSON.stringify({
              draftText: input.draftText,
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as unknown;
    const content = extractChatContent(payload);
    if (!content) return null;
    return parseAiPayload(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to parse item text.");
  }

  const payload = (await request.json().catch(() => null)) as { draftText?: string } | null;
  const draftText = (payload?.draftText || "").trim();
  if (!draftText) {
    return errorResponse(422, "VALIDATION_ERROR", "Enter item text to parse.", {
      draftText: "Enter item text.",
    });
  }

  if (draftText.length > MAX_DRAFT_TEXT_CHARS) {
    return errorResponse(
      422,
      "VALIDATION_ERROR",
      `Item text is too long. Keep it under ${MAX_DRAFT_TEXT_CHARS} characters.`,
      {
        draftText: `Keep item text under ${MAX_DRAFT_TEXT_CHARS} characters.`,
      },
    );
  }

  const openAiApiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!openAiApiKey) {
    return errorResponse(500, "AI_CONFIG_MISSING", "OPENAI_API_KEY is not configured on the server.");
  }

  const openAiModel = (process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();
  const timeoutMs = parsePositiveInt(process.env.OPENAI_TIMEOUT_MS, DEFAULT_OPENAI_TIMEOUT_MS);

  try {
    const aiParsed = await inferDraftFieldsWithOpenAi({
      openAiApiKey,
      openAiModel,
      timeoutMs,
      draftText,
    });
    const fallbackParsed = fallbackParseDraftText(draftText);

    const title = buildConciseTitle(aiParsed?.title || fallbackParsed.title);
    const description =
      bulletsToDescription(aiParsed?.descriptionBullets || []) || fallbackParsed.description || null;
    const priceCents = aiParsed?.priceCents ?? fallbackParsed.priceCents;
    const priceNeedsReview = Boolean(aiParsed?.priceNeedsReview) || priceCents === null;
    const priceReviewMessage = priceCents === null
      ? "Price was not detected. Please verify before saving."
      : priceNeedsReview
        ? "Parsed price may be inaccurate. Please verify."
        : null;

    return NextResponse.json({
      ok: true as const,
      parsed: {
        title,
        description,
        priceCents,
      },
      priceNeedsReview,
      priceReviewMessage,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to parse item text right now.");
  }
}

