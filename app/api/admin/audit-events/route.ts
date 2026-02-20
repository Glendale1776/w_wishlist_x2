import { NextRequest, NextResponse } from "next/server";

import { ItemAuditAction, listItemAuditEvents, pruneItemAuditEvents } from "@/app/_lib/item-store";
import {
  getWishlistRecordById,
  listShareLinkAuditEvents,
  pruneShareLinkAuditEvents,
  ShareLinkAuditAction,
} from "@/app/_lib/wishlist-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_RETENTION_DAYS = 180;

type ApiErrorCode = "AUTH_REQUIRED" | "FORBIDDEN" | "VALIDATION_ERROR";

type AdminAuditAction = ItemAuditAction | ShareLinkAuditAction;

const ITEM_ACTIONS = new Set<ItemAuditAction>(["create", "update", "archive", "reserve", "unreserve", "contribute"]);
const SHARE_ACTIONS = new Set<ShareLinkAuditAction>(["rotate_share_link", "disable_share_link", "enable_share_link"]);

function errorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

function parseAdminAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => EMAIL_REGEX.test(value)),
  );
}

function adminEmailFromHeader(request: NextRequest) {
  const value = request.headers.get("x-admin-email")?.trim().toLowerCase() || "";
  if (!EMAIL_REGEX.test(value)) return null;
  return value;
}

function isAuthorizedAdmin(adminEmail: string): boolean {
  const allowlist = parseAdminAllowlist(process.env.ADMIN_EMAILS);
  if (allowlist.size === 0) return false;
  return allowlist.has(adminEmail);
}

function parseRetentionDays(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETENTION_DAYS;
  return Math.min(Math.max(Math.floor(parsed), 1), 3650);
}

function parseLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(Math.max(Math.floor(parsed), 1), 500);
}

function parseAction(raw: string | null): AdminAuditAction | null {
  if (!raw) return null;
  if (ITEM_ACTIONS.has(raw as ItemAuditAction)) return raw as ItemAuditAction;
  if (SHARE_ACTIONS.has(raw as ShareLinkAuditAction)) return raw as ShareLinkAuditAction;
  return null;
}

function parseSince(raw: string | null): string | null {
  if (!raw) return null;
  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

export async function GET(request: NextRequest) {
  const adminEmail = adminEmailFromHeader(request);
  if (!adminEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Admin sign in is required.");
  }

  if (!isAuthorizedAdmin(adminEmail)) {
    return errorResponse(403, "FORBIDDEN", "Admin role is required.");
  }

  const searchParams = request.nextUrl.searchParams;
  const wishlistId = searchParams.get("wishlistId")?.trim() || undefined;
  const requestedAction = searchParams.get("action");
  const action = parseAction(requestedAction);
  if (requestedAction && !action) {
    return errorResponse(422, "VALIDATION_ERROR", "Unsupported audit action filter.");
  }

  const since = parseSince(searchParams.get("since"));
  if (searchParams.get("since") && !since) {
    return errorResponse(422, "VALIDATION_ERROR", "Invalid since timestamp.");
  }

  const limit = parseLimit(searchParams.get("limit"));
  const retentionDays = parseRetentionDays(process.env.AUDIT_RETENTION_DAYS);

  const cleanupItem = pruneItemAuditEvents({ retentionDays });
  const cleanupShare = pruneShareLinkAuditEvents({ retentionDays });

  const itemActionFilter = action && ITEM_ACTIONS.has(action as ItemAuditAction) ? (action as ItemAuditAction) : undefined;
  const shareActionFilter =
    action && SHARE_ACTIONS.has(action as ShareLinkAuditAction) ? (action as ShareLinkAuditAction) : undefined;

  const itemEvents = listItemAuditEvents({
    wishlistId,
    action: itemActionFilter,
    since: since || undefined,
    limit,
  }).map((event) => ({
    id: event.id,
    source: "item" as const,
    action: event.action,
    wishlistId: event.wishlistId,
    entityId: event.entityId,
    actorEmail: event.ownerEmail,
    createdAt: event.createdAt,
    details: null as { tokenHint: string; disabledAt: string | null } | null,
  }));

  const shareEvents = listShareLinkAuditEvents({
    wishlistId,
    action: shareActionFilter,
    since: since || undefined,
    limit,
  }).map((event) => ({
    id: event.id,
    source: "share_link" as const,
    action: event.action,
    wishlistId: event.wishlistId,
    entityId: event.wishlistId,
    actorEmail: event.actorEmail,
    createdAt: event.createdAt,
    details: event.after,
  }));

  const events = [...itemEvents, ...shareEvents]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  const wishlist = wishlistId
    ? await (async () => {
        const found = await getWishlistRecordById(wishlistId);
        if (!found) return null;
        return {
          id: found.id,
          title: found.title,
          shareTokenDisabledAt: found.shareTokenDisabledAt,
          updatedAt: found.updatedAt,
        };
      })()
    : null;

  return NextResponse.json({
    ok: true as const,
    retentionDays,
    cleanup: {
      removedItemEvents: cleanupItem.removedCount,
      removedShareLinkEvents: cleanupShare.removedCount,
    },
    wishlist,
    events,
  });
}
