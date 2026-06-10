// Typed HTTP layer over the bridge's operator routes (`/ops/*`, D-027-v2).
// Used by `OpsSupportPanel`. Every call attaches the ops bearer and trims a
// trailing slash on `bridgeUrl` so consumers can pass either form.
//
// The bridge resolves the caller's role (ops or circle_admin) from the
// bearer and gates each route on circle scope. On a 401 the panel must
// invalidate its ops session and re-sign-in; `OpsBridgeError.status`
// carries the HTTP status so the panel can branch on it.

import type { SupportP2PTag, SupportChatStatus } from "../types";

function trim(url: string): string {
  return url.replace(/\/$/, "");
}

/** Error thrown by every ops-bridge call on a non-2xx response. Carries
 *  the HTTP `status` (so the panel can detect 401 → invalidate) and the
 *  bridge's `reason` string when present. */
export class OpsBridgeError extends Error {
  readonly status: number;
  readonly reason?: string;
  constructor(status: number, reason?: string) {
    super(`ops bridge request failed (${status})${reason ? `: ${reason}` : ""}`);
    this.name = "OpsBridgeError";
    this.status = status;
    this.reason = reason;
  }
}

interface OpsAuthedOpts {
  bridgeUrl: string;
  sessionToken: string;
  orderId: string;
}

async function opsFetch(
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
    throw new OpsBridgeError(res.status, reason);
  }
  return res.json();
}

export interface OpsThreadMessage {
  id: number;
  content: string;
  direction: "user" | "ops";
  createdAt: number;
  senderName: string | null;
}

export interface OpsThread {
  ok: true;
  status: SupportChatStatus | null;
  p2pTag: SupportP2PTag | null;
  conversationId: number | null;
  messages: OpsThreadMessage[];
}

/** One-shot read of the order's support thread. */
export async function fetchOpsThread(opts: OpsAuthedOpts): Promise<OpsThread> {
  return (await opsFetch(
    `${trim(opts.bridgeUrl)}/ops/orders/${opts.orderId}/thread`,
    { method: "GET" },
    opts.sessionToken,
  )) as OpsThread;
}

export interface OpsMessageResult {
  ok: true;
  id: number;
}

/** Post an operator reply. The bridge stamps `ops_address` from the bearer. */
export async function postOpsMessage(
  opts: OpsAuthedOpts & { content: string },
): Promise<OpsMessageResult> {
  return (await opsFetch(
    `${trim(opts.bridgeUrl)}/ops/orders/${opts.orderId}/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: opts.content }),
    },
    opts.sessionToken,
  )) as OpsMessageResult;
}

export interface OpsTagResult {
  ok: true;
  p2pTag: SupportP2PTag | null;
}

/** Write (or clear, with `null`) the conversation's P2P tag. */
export async function patchOpsP2pTag(
  opts: OpsAuthedOpts & { tag: SupportP2PTag | null },
): Promise<OpsTagResult> {
  return (await opsFetch(
    `${trim(opts.bridgeUrl)}/ops/orders/${opts.orderId}/p2p-tag`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag: opts.tag }),
    },
    opts.sessionToken,
  )) as OpsTagResult;
}

export interface OpsResolveResult {
  ok: true;
  status: "resolved";
}

/** Resolve (close) the conversation. */
export async function resolveOpsChat(
  opts: OpsAuthedOpts,
): Promise<OpsResolveResult> {
  return (await opsFetch(
    `${trim(opts.bridgeUrl)}/ops/orders/${opts.orderId}/resolve`,
    { method: "POST" },
    opts.sessionToken,
  )) as OpsResolveResult;
}
