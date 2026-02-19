import { NextResponse } from "next/server";

import { resolvePublicWishlistReadModel } from "@/app/_lib/public-wishlist";

const DEFAULT_STREAM_HEARTBEAT_SEC = 15;

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

function encodeMessage(message: StreamMessage): Uint8Array {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  return new TextEncoder().encode(payload);
}

export async function GET(request: Request, context: { params: Promise<{ share_token: string }> }) {
  const { share_token } = await context.params;

  const initial = resolvePublicWishlistReadModel({
    shareToken: share_token,
    canonicalHost: process.env.CANONICAL_HOST,
  });

  if (!initial.ok) {
    return errorResponse(404, "NOT_FOUND", "This shared wishlist is unavailable.");
  }

  const heartbeatSec = parseHeartbeatSeconds(process.env.STREAM_HEARTBEAT_SEC);
  let lastVersion = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      let inFlight = false;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        request.signal.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          return;
        }
      };

      const emit = () => {
        if (closed || inFlight) return;
        inFlight = true;

        const resolved = resolvePublicWishlistReadModel({
          shareToken: share_token,
          canonicalHost: process.env.CANONICAL_HOST,
        });

        if (!resolved.ok) {
          controller.enqueue(encodeMessage({ type: "not_found" }));
          cleanup();
          try {
            controller.close();
          } catch {
            // Ignore stream close race.
          }
          inFlight = false;
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

        inFlight = false;
      };

      request.signal.addEventListener("abort", onAbort);
      emit();
      intervalId = setInterval(emit, heartbeatSec * 1000);
    },
    cancel() {
      // Request abort listener handles timer cleanup.
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
