import { NextResponse } from "next/server";

import { resolvePublicWishlistReadModel } from "@/app/_lib/public-wishlist";

const DEFAULT_STREAM_HEARTBEAT_SEC = 15;
const DEFAULT_RECONNECT_WINDOW_SEC = 120;

type ApiErrorCode = "NOT_FOUND";

type StreamMessage =
  | {
      type: "snapshot";
      version: string;
      wishlist: {
        id: string;
        title: string;
        occasionDate: string | null;
        occasionNote: string | null;
        currency: string;
        shareUrl: string;
        itemCount: number;
      };
      items: Array<{
        id: string;
        title: string;
        description: string | null;
        url: string | null;
        imageUrl: string | null;
        priceCents: number | null;
        isGroupFunded: boolean;
        targetCents: number | null;
        fundedCents: number;
        progressRatio: number;
        availability: "available" | "reserved";
      }>;
    }
  | {
      type: "heartbeat";
      version: string;
    }
  | {
      type: "not_found";
    };

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

function parseHeartbeatSeconds(raw: string | undefined) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_STREAM_HEARTBEAT_SEC;
  return Math.min(Math.max(Math.floor(parsed), 5), 60);
}

function parseReconnectWindowSeconds(raw: string | undefined) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECONNECT_WINDOW_SEC;
  return Math.min(Math.max(Math.floor(parsed), 30), 3600);
}

type StreamMetricsStore = {
  totalConnections: number;
  totalDisconnects: number;
  reconnects: number;
  lastConnectedAtByToken: Record<string, number>;
};

declare global {
  // eslint-disable-next-line no-var
  var __publicWishlistStreamMetrics: StreamMetricsStore | undefined;
}

function getStreamMetricsStore(): StreamMetricsStore {
  if (!globalThis.__publicWishlistStreamMetrics) {
    globalThis.__publicWishlistStreamMetrics = {
      totalConnections: 0,
      totalDisconnects: 0,
      reconnects: 0,
      lastConnectedAtByToken: {},
    };
  }
  return globalThis.__publicWishlistStreamMetrics;
}

function tokenHint(token: string) {
  return token.slice(0, 8);
}

function reconnectRate(metrics: StreamMetricsStore) {
  if (metrics.totalConnections === 0) return 0;
  return Number((metrics.reconnects / metrics.totalConnections).toFixed(3));
}

function logStreamMetric(input: {
  event: "stream_connect" | "stream_disconnect";
  tokenHint: string;
  reason?: string;
  totalConnections: number;
  totalDisconnects: number;
  reconnects: number;
  reconnectRate: number;
}) {
  console.info("public_wishlist_stream_metric", input);
}

function encodeMessage(message: StreamMessage): Uint8Array {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  return new TextEncoder().encode(payload);
}

export async function GET(request: Request, context: { params: Promise<{ share_token: string }> }) {
  const { share_token } = await context.params;

  const initial = await resolvePublicWishlistReadModel({
    shareToken: share_token,
    canonicalHost: process.env.CANONICAL_HOST,
  });

  if (!initial.ok) {
    return errorResponse(404, "NOT_FOUND", "This shared wishlist is unavailable.");
  }

  const heartbeatSec = parseHeartbeatSeconds(process.env.STREAM_HEARTBEAT_SEC);
  const reconnectWindowSec = parseReconnectWindowSeconds(process.env.STREAM_RECONNECT_WINDOW_SEC);
  const reconnectWindowMs = reconnectWindowSec * 1000;
  let lastVersion = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      let inFlight = false;
      const metrics = getStreamMetricsStore();
      const now = Date.now();
      const previousConnectedAt = metrics.lastConnectedAtByToken[share_token];
      const reconnected = typeof previousConnectedAt === "number" && now - previousConnectedAt <= reconnectWindowMs;

      metrics.totalConnections += 1;
      if (reconnected) {
        metrics.reconnects += 1;
      }
      metrics.lastConnectedAtByToken[share_token] = now;

      logStreamMetric({
        event: "stream_connect",
        tokenHint: tokenHint(share_token),
        totalConnections: metrics.totalConnections,
        totalDisconnects: metrics.totalDisconnects,
        reconnects: metrics.reconnects,
        reconnectRate: reconnectRate(metrics),
      });

      const cleanup = (reason: string) => {
        if (closed) return;
        closed = true;
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        request.signal.removeEventListener("abort", onAbort);
        metrics.totalDisconnects += 1;
        logStreamMetric({
          event: "stream_disconnect",
          tokenHint: tokenHint(share_token),
          reason,
          totalConnections: metrics.totalConnections,
          totalDisconnects: metrics.totalDisconnects,
          reconnects: metrics.reconnects,
          reconnectRate: reconnectRate(metrics),
        });
      };

      const onAbort = () => {
        cleanup("abort");
        try {
          controller.close();
        } catch {
          return;
        }
      };

      const emit = async () => {
        if (closed || inFlight) return;
        inFlight = true;

        try {
          const resolved = await resolvePublicWishlistReadModel({
            shareToken: share_token,
            canonicalHost: process.env.CANONICAL_HOST,
          });

          if (!resolved.ok) {
            controller.enqueue(encodeMessage({ type: "not_found" }));
            cleanup("not_found");
            try {
              controller.close();
            } catch {
              // Ignore stream close race.
            }
            return;
          }

          if (resolved.model.version !== lastVersion) {
            lastVersion = resolved.model.version;
            controller.enqueue(
              encodeMessage({
                type: "snapshot",
                version: resolved.model.version,
                wishlist: resolved.model.wishlist,
                items: resolved.model.items,
              }),
            );
          } else {
            controller.enqueue(
              encodeMessage({
                type: "heartbeat",
                version: lastVersion,
              }),
            );
          }
        } finally {
          inFlight = false;
        }
      };

      request.signal.addEventListener("abort", onAbort);
      void emit();
      intervalId = setInterval(() => {
        void emit();
      }, heartbeatSec * 1000);
    },
    cancel() {
      // Request abort listener handles timer cleanup for most disconnects.
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
