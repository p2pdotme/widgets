// Typed HTTP layer over the bridge's general (order-less) support routes
// (`/tickets/*`). Used by `GeneralSupportPanel`. Unlike `userBridge` there is no
// order to own — authorization is the wallet session alone, and a thread is
// addressed by its ticket (conversation) id.
//
// The key behavioural difference from the dispute path: a general thread is one
// continuous thread per wallet. Opening returns the wallet's existing thread
// (reopening it if it was resolved), and posting a reply to a resolved thread
// reopens it. So this client never has to "create a new thread" from the UI —
// it opens once, then reads/writes that ticket id.

import { UserBridgeError, type UserThreadMessage } from "./userBridge";

export { UserBridgeError } from "./userBridge";
export type { UserThreadMessage } from "./userBridge";

function trim(url: string): string {
  return url.replace(/\/$/, "");
}

async function bridgeFetch(
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

export interface OpenGeneralTicketResult {
  ok: true;
  ticketId: number;
  tier: "proven" | "unverified";
  created: boolean;
}

/**
 * Open (or reuse/reopen) this wallet's general support thread. `currency` and
 * `locale` are routing hints for the ops queue; the bridge trusts neither for
 * authorization. Returns the ticket id to read and post against.
 */
export async function openGeneralTicket(opts: {
  bridgeUrl: string;
  sessionToken: string;
  currency?: string;
  locale?: string;
  message?: string;
}): Promise<OpenGeneralTicketResult> {
  const body: Record<string, string> = {};
  if (opts.currency) body.currency = opts.currency;
  if (opts.locale) body.locale = opts.locale;
  if (opts.message) body.message = opts.message;
  return (await bridgeFetch(
    `${trim(opts.bridgeUrl)}/tickets`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    opts.sessionToken,
  )) as OpenGeneralTicketResult;
}

export interface GeneralThread {
  ok: true;
  status: "open" | "pending" | "snoozed" | "resolved" | null;
  messages: UserThreadMessage[];
}

/** One-shot read of a general thread the wallet owns. */
export async function fetchGeneralThread(opts: {
  bridgeUrl: string;
  sessionToken: string;
  ticketId: number;
}): Promise<GeneralThread> {
  return (await bridgeFetch(
    `${trim(opts.bridgeUrl)}/tickets/${opts.ticketId}/thread`,
    { method: "GET" },
    opts.sessionToken,
  )) as GeneralThread;
}

export interface GeneralMessageResult {
  ok: true;
}

/**
 * Post the user's own reply into their general thread. The bridge posts it as an
 * `incoming` message and reopens the thread if it was resolved — which is why,
 * unlike the dispute panel, this composer is never locked on a resolved status.
 */
export async function postGeneralMessage(opts: {
  bridgeUrl: string;
  sessionToken: string;
  ticketId: number;
  content: string;
}): Promise<GeneralMessageResult> {
  return (await bridgeFetch(
    `${trim(opts.bridgeUrl)}/tickets/${opts.ticketId}/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: opts.content }),
    },
    opts.sessionToken,
  )) as GeneralMessageResult;
}
