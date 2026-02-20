import { getSupabaseAdminClient } from "@/app/_lib/supabase-admin";
import {
  buildPublicShareUrl,
  getPublicShareTokenForWishlist,
  getWishlistRecordById,
  normalizeCanonicalHost,
} from "@/app/_lib/wishlist-store";

type ActiveReservationRow = {
  id: string;
  user_id: string;
};

type SuggestionCandidate = {
  id: string;
  title: string;
  priceCents: number | null;
};

type ArchiveNotificationRow = {
  id: string;
  wishlist_id: string;
  item_id: string;
  actor_user_id: string;
  archived_item_title: string;
  archived_item_price_cents: number | null;
  suggested_item_ids: string[] | null;
  status: "pending" | "seen";
  created_at: string;
};

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_TIMEOUT_MS = 7000;
const MAX_SUGGESTION_COUNT = 5;
const EMAIL_PREVIEW_MAX = 220;

function normalizeEmail(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function fallbackSuggestionIds(candidates: SuggestionCandidate[], targetPriceCents: number | null): string[] {
  if (candidates.length === 0) return [];

  const ranked = [...candidates].sort((left, right) => {
    const leftMissing = left.priceCents === null;
    const rightMissing = right.priceCents === null;
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;

    if (targetPriceCents !== null && left.priceCents !== null && right.priceCents !== null) {
      const leftDelta = Math.abs(left.priceCents - targetPriceCents);
      const rightDelta = Math.abs(right.priceCents - targetPriceCents);
      if (leftDelta !== rightDelta) return leftDelta - rightDelta;
    }

    if ((left.priceCents ?? Number.MAX_SAFE_INTEGER) !== (right.priceCents ?? Number.MAX_SAFE_INTEGER)) {
      return (left.priceCents ?? Number.MAX_SAFE_INTEGER) - (right.priceCents ?? Number.MAX_SAFE_INTEGER);
    }

    return left.title.localeCompare(right.title);
  });

  return ranked.slice(0, MAX_SUGGESTION_COUNT).map((candidate) => candidate.id);
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

function parseSuggestedIds(content: string, allowedIds: Set<string>): string[] {
  try {
    const parsed = JSON.parse(content) as { suggestedItemIds?: unknown };
    if (!Array.isArray(parsed.suggestedItemIds)) return [];
    const next: string[] = [];
    const seen = new Set<string>();
    for (const value of parsed.suggestedItemIds) {
      if (typeof value !== "string") continue;
      if (!allowedIds.has(value)) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      next.push(value);
      if (next.length >= MAX_SUGGESTION_COUNT) break;
    }
    return next;
  } catch {
    return [];
  }
}

async function rankSuggestionsWithAi(input: {
  archivedItemTitle: string;
  archivedItemPriceCents: number | null;
  candidates: SuggestionCandidate[];
}): Promise<string[]> {
  const openAiApiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!openAiApiKey || input.candidates.length === 0) return [];

  const openAiModel = (process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();
  const timeoutMs = parsePositiveInt(process.env.OPENAI_TIMEOUT_MS, DEFAULT_OPENAI_TIMEOUT_MS);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: openAiModel,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "replacement_item_suggestions",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                suggestedItemIds: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: MAX_SUGGESTION_COUNT,
                },
              },
              required: ["suggestedItemIds"],
            },
          },
        },
        messages: [
          {
            role: "system",
            content:
              "Rank replacement wishlist items for a guest when their reserved item was archived. Prioritize closest price first, then title similarity. Return only item IDs from candidates.",
          },
          {
            role: "user",
            content: JSON.stringify({
              archivedItem: {
                title: input.archivedItemTitle,
                priceCents: input.archivedItemPriceCents,
              },
              candidates: input.candidates.map((candidate) => ({
                id: candidate.id,
                title: candidate.title,
                priceCents: candidate.priceCents,
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return [];

    const payload = (await response.json()) as unknown;
    const rawContent = extractChatContent(payload);
    if (!rawContent) return [];

    return parseSuggestedIds(rawContent, new Set(input.candidates.map((candidate) => candidate.id)));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function listActiveReservationsForItem(itemId: string): Promise<ActiveReservationRow[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("id,user_id")
    .eq("item_id", itemId)
    .eq("status", "active");

  if (error) throw error;
  return (data || []) as ActiveReservationRow[];
}

async function releaseReservationsForItem(itemId: string, archivedAt: string) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("reservations")
    .update({ status: "released", updated_at: archivedAt })
    .eq("item_id", itemId)
    .eq("status", "active");

  if (error) throw error;
}

async function listSuggestionCandidates(input: { wishlistId: string; excludedItemId: string }) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("items")
    .select("id,title,price_cents,archived_at")
    .eq("wishlist_id", input.wishlistId)
    .is("archived_at", null)
    .neq("id", input.excludedItemId);

  if (error) throw error;

  return ((data || []) as Array<{ id: string; title: string; price_cents: number | null }>).map((row) => ({
    id: row.id,
    title: row.title,
    priceCents: row.price_cents,
  }));
}

async function resolveUserEmailById(userId: string): Promise<string | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return normalizeEmail(data.user.email);
}

async function resolveUserIdByEmail(actorEmail: string): Promise<string | null> {
  const normalizedEmail = normalizeEmail(actorEmail);
  if (!normalizedEmail) return null;

  const supabase = getSupabaseAdminClient();
  const perPage = 200;
  let page = 1;

  for (let guard = 0; guard < 200; guard += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) break;

    const users = data?.users || [];
    const found = users.find((candidate) => normalizeEmail(candidate.email) === normalizedEmail);
    if (found?.id) return found.id;

    if (!data?.nextPage || users.length === 0) break;
    page = data.nextPage;
  }

  return null;
}

async function sendArchivedReservationEmail(input: {
  toEmail: string;
  wishlistTitle: string;
  archivedItemTitle: string;
  archivedItemPriceCents: number | null;
  suggestedTitles: string[];
  shareUrl: string;
}): Promise<{ sent: boolean; errorMessage?: string }> {
  const resendApiKey = (process.env.RESEND_API_KEY || "").trim();
  const fromAddress = (process.env.NOTIFY_EMAIL_FROM || "").trim();
  if (!resendApiKey || !fromAddress) {
    return { sent: false, errorMessage: "Email provider is not configured." };
  }

  const priceText =
    input.archivedItemPriceCents === null ? "Unknown price" : `$${(input.archivedItemPriceCents / 100).toFixed(2)}`;
  const suggestionsText =
    input.suggestedTitles.length > 0
      ? input.suggestedTitles.slice(0, 3).join(", ")
      : "Open the wishlist to see similar-price suggestions.";

  const subject = `Reserved item archived in "${input.wishlistTitle}"`;
  const text = [
    `Your reserved item was archived: ${input.archivedItemTitle} (${priceText}).`,
    "",
    `Suggested alternatives: ${suggestionsText}`,
    "",
    `Open wishlist: ${input.shareUrl}`,
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [input.toEmail],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const rawError = await response.text().catch(() => "Email request failed.");
    return { sent: false, errorMessage: rawError.slice(0, EMAIL_PREVIEW_MAX) };
  }

  return { sent: true };
}

export async function processArchivedReservationNotifications(input: {
  wishlistId: string;
  itemId: string;
  archivedAt: string;
  archivedItemTitle: string;
  archivedItemPriceCents: number | null;
}) {
  const activeReservations = await listActiveReservationsForItem(input.itemId);
  if (activeReservations.length === 0) return;

  await releaseReservationsForItem(input.itemId, input.archivedAt);

  const candidates = await listSuggestionCandidates({
    wishlistId: input.wishlistId,
    excludedItemId: input.itemId,
  });

  const aiSuggestedIds = await rankSuggestionsWithAi({
    archivedItemTitle: input.archivedItemTitle,
    archivedItemPriceCents: input.archivedItemPriceCents,
    candidates,
  });

  const suggestedItemIds =
    aiSuggestedIds.length > 0
      ? aiSuggestedIds.slice(0, MAX_SUGGESTION_COUNT)
      : fallbackSuggestionIds(candidates, input.archivedItemPriceCents);

  const candidateTitleById = new Map(candidates.map((candidate) => [candidate.id, candidate.title]));
  const wishlist = await getWishlistRecordById(input.wishlistId);
  const shareToken = await getPublicShareTokenForWishlist(input.wishlistId);
  const shareUrl = shareToken
    ? buildPublicShareUrl(normalizeCanonicalHost(process.env.CANONICAL_HOST), shareToken)
    : "";

  const supabase = getSupabaseAdminClient();
  const insertedRows: ArchiveNotificationRow[] = [];
  for (const reservation of activeReservations) {
    const { data, error } = await supabase
      .from("archive_notifications")
      .insert({
        wishlist_id: input.wishlistId,
        item_id: input.itemId,
        actor_user_id: reservation.user_id,
        archived_item_title: input.archivedItemTitle,
        archived_item_price_cents: input.archivedItemPriceCents,
        suggested_item_ids: suggestedItemIds,
        status: "pending",
        created_at: input.archivedAt,
      })
      .select("id,wishlist_id,item_id,actor_user_id,archived_item_title,archived_item_price_cents,suggested_item_ids,status,created_at")
      .single();

    if (!error && data) {
      insertedRows.push(data as unknown as ArchiveNotificationRow);
    }
  }

  if (!shareUrl || !wishlist) return;

  void Promise.all(
    insertedRows.map(async (row) => {
      const actorEmail = await resolveUserEmailById(row.actor_user_id);
      if (!actorEmail) return;

      const suggestedTitles = (row.suggested_item_ids || [])
        .map((id) => candidateTitleById.get(id))
        .filter((value): value is string => Boolean(value));

      const emailResult = await sendArchivedReservationEmail({
        toEmail: actorEmail,
        wishlistTitle: wishlist.title,
        archivedItemTitle: row.archived_item_title,
        archivedItemPriceCents: row.archived_item_price_cents,
        suggestedTitles,
        shareUrl,
      });

      await supabase
        .from("archive_notifications")
        .update({
          emailed_at: emailResult.sent ? new Date().toISOString() : null,
          email_error: emailResult.sent ? null : emailResult.errorMessage || "Unable to send email.",
        })
        .eq("id", row.id);
    }),
  );
}

export type PendingArchiveAlert = {
  id: string;
  archivedItemTitle: string;
  archivedItemPriceCents: number | null;
  suggestedItemIds: string[];
  createdAt: string;
};

export async function getLatestPendingArchiveAlert(input: { wishlistId: string; actorEmail: string }) {
  const actorUserId = await resolveUserIdByEmail(input.actorEmail);
  if (!actorUserId) {
    return { error: "ACTOR_NOT_FOUND" as const };
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("archive_notifications")
    .select("id,archived_item_title,archived_item_price_cents,suggested_item_ids,created_at")
    .eq("wishlist_id", input.wishlistId)
    .eq("actor_user_id", actorUserId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return { ok: true as const, alert: null as PendingArchiveAlert | null };
  }

  return {
    ok: true as const,
    alert: {
      id: data.id,
      archivedItemTitle: data.archived_item_title,
      archivedItemPriceCents: data.archived_item_price_cents,
      suggestedItemIds: Array.isArray(data.suggested_item_ids) ? data.suggested_item_ids : [],
      createdAt: data.created_at,
    } as PendingArchiveAlert,
  };
}

export async function markArchiveAlertSeen(input: { notificationId: string; wishlistId: string; actorEmail: string }) {
  const actorUserId = await resolveUserIdByEmail(input.actorEmail);
  if (!actorUserId) {
    return { error: "ACTOR_NOT_FOUND" as const };
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("archive_notifications")
    .update({
      status: "seen",
      seen_at: new Date().toISOString(),
    })
    .eq("id", input.notificationId)
    .eq("wishlist_id", input.wishlistId)
    .eq("actor_user_id", actorUserId)
    .eq("status", "pending");

  if (error) throw error;
  return { ok: true as const };
}
