// Typed HTTP layer over the bridge's user routes (`/me/*`). Used by
// `UserSupportPanel`. Mirrors `opsBridge` but for the order's owner: the
// bridge gates each route on `session.sub === order.user`, so a wallet can
// only read/post on its own orders' conversations. Every call attaches the
// user bearer and trims a trailing slash on `bridgeUrl`.
//
// This is the read/write path that replaces the website-SDK + HMAC merge:
// the user reads and writes the SAME per-order conversation ops uses, proxied
// through the bridge under the shared admin token. On a 401 the panel must
// invalidate its session and re-sign-in; `UserBridgeError.status` carries the
// HTTP status so the panel can branch on it.

import type { SupportP2PTag, SupportChatStatus } from "../types";

function trim(url: string): string {
  return url.replace(/\/$/, "");
}

/** Error thrown by every user-bridge call on a non-2xx response. Carries the
 *  HTTP `status` (so the panel can detect 401 → invalidate) and the bridge's
 *  `reason` string when present. */
export class UserBridgeError extends Error {
  readonly status: number;
  readonly reason?: string;
  constructor(status: number, reason?: string) {
    super(`user bridge request failed (${status})${reason ? `: ${reason}` : ""}`);
    this.name = "UserBridgeError";
    this.status = status;
    this.reason = reason;
  }
}

interface UserAuthedOpts {
  bridgeUrl: string;
  sessionToken: string;
  orderId: string;
}

async function userFetch(
  url: string,
  init: RequestInit,
  sessionToken: string,
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${sessionToken}`,
    },
  });
  if (!res.ok) {
    let reason: string | undefined;
    try {
      const body = (await res.json()) as { reason?: string };
      reason = body?.reason;
    } catch {
      // non-JSON body; leave reason undefined
    }
    throw new UserBridgeError(res.status, reason);
  }
  return res.json();
}

export interface UserThreadMessage {
  id: number;
  content: string;
  direction: "user" | "ops";
  createdAt: number;
  senderName: string | null;
}

export interface UserThread {
  ok: true;
  status: SupportChatStatus | null;
  p2pTag: SupportP2PTag | null;
  conversationId: number | null;
  messages: UserThreadMessage[];
}

/** One-shot read of the order's support thread. */
export async function fetchUserThread(
  opts: UserAuthedOpts,
): Promise<UserThread> {
  return (await userFetch(
    `${trim(opts.bridgeUrl)}/me/orders/${opts.orderId}/thread`,
    { method: "GET" },
    opts.sessionToken,
  )) as UserThread;
}

export interface UserMessageResult {
  ok: true;
  id: number;
}

/** Post the user's own reply. The bridge posts it as an `incoming` message. */
export async function postUserMessage(
  opts: UserAuthedOpts & { content: string },
): Promise<UserMessageResult> {
  return (await userFetch(
    `${trim(opts.bridgeUrl)}/me/orders/${opts.orderId}/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: opts.content }),
    },
    opts.sessionToken,
  )) as UserMessageResult;
}
