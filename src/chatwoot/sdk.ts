// Thin wrapper around Chatwoot's website SDK loader. The SDK is a
// page-level singleton bound to one `websiteToken` (inbox). Per D-006-v2
// each circle has its own inbox, and per D-029 the binding inbox is
// resolved fresh on every Support click. When the user opens Support on
// an order in a different circle than the previously-active one, the
// SDK has to reboot against the new inbox's websiteToken. We track the
// active inbox in module state and tear down + re-run when it changes.

export interface ChatwootSession {
  baseUrl: string;
  websiteToken: string;
  identifier: string;
  identifierHash: string;
}

declare global {
  interface Window {
    chatwootSDK?: {
      run: (opts: { websiteToken: string; baseUrl: string }) => void;
    };
    $chatwoot?: {
      setUser: (
        identifier: string,
        attrs: { identifier_hash: string; name?: string; email?: string },
      ) => void;
      toggle: (state?: "open" | "close") => void;
      reset: () => void;
    };
  }
}

const SCRIPT_ID = "support-widget-chatwoot-sdk";
const IFRAME_ID = "chatwoot_live_chat_widget";
const loadedFor = new Map<string, Promise<void>>();

interface ActiveInbox {
  baseUrl: string;
  websiteToken: string;
  identifier: string;
}
let active: ActiveInbox | null = null;

function injectScript(baseUrl: string): Promise<void> {
  const cached = loadedFor.get(baseUrl);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("chatwoot sdk requires a browser document"));
      return;
    }
    if (window.chatwootSDK) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `${baseUrl.replace(/\/$/, "")}/packs/js/sdk.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed to load chatwoot sdk.js"));
    document.head.appendChild(script);
  });
  loadedFor.set(baseUrl, promise);
  return promise;
}

/**
 * Boot or rebind the Chatwoot website widget for the given session. Safe
 * to call repeatedly:
 *
 * - same inbox, same user → no-op (the SDK is already bound).
 * - same inbox, different user → re-setUser only.
 * - different inbox → reset the SDK, drop the existing iframe, re-run
 *   the loader against the new websiteToken, then setUser.
 */
export async function bootChatwoot(session: ChatwootSession): Promise<void> {
  await injectScript(session.baseUrl);
  if (!window.chatwootSDK) throw new Error("chatwootSDK missing after load");

  const sameInbox =
    active?.baseUrl === session.baseUrl &&
    active?.websiteToken === session.websiteToken;
  const sameUser = sameInbox && active?.identifier === session.identifier;
  if (sameUser) return;

  if (!sameInbox) {
    resetChatwootInstance();
    window.chatwootSDK.run({
      websiteToken: session.websiteToken,
      baseUrl: session.baseUrl,
    });
  }

  await waitForReady();
  // Chatwoot's setUser requires at least one of { name, email, avatar_url }.
  // We pin "Customer" per D-003-v2's neutral-vocabulary contract: the
  // merchant-side surface labels the user that way regardless. No real
  // name, email, or avatar leaves the bridge.
  window.$chatwoot?.setUser(session.identifier, {
    identifier_hash: session.identifierHash,
    name: "Customer",
  });
  active = {
    baseUrl: session.baseUrl,
    websiteToken: session.websiteToken,
    identifier: session.identifier,
  };
}

export function openChatwoot(): void {
  window.$chatwoot?.toggle("open");
}

export function closeChatwoot(): void {
  window.$chatwoot?.toggle("close");
}

/**
 * Tear down the current Chatwoot instance so a fresh `run()` can bind to
 * a different inbox. Best-effort: the SDK was not designed for mid-page
 * inbox switching, so we lean on the public reset() plus iframe removal.
 */
function resetChatwootInstance(): void {
  try {
    window.$chatwoot?.reset();
  } catch {
    // ignore; reset is documented but version-dependent
  }
  if (typeof document !== "undefined") {
    const iframe = document.getElementById(IFRAME_ID);
    iframe?.parentElement?.removeChild(iframe);
  }
  // Drop the singleton so waitForReady polls until the new run() rehydrates
  // it. The SDK reassigns window.$chatwoot on every run().
  try {
    delete (window as { $chatwoot?: unknown }).$chatwoot;
  } catch {
    (window as { $chatwoot?: unknown }).$chatwoot = undefined;
  }
  active = null;
}

/** Test-only helper. Resets the module state without touching the DOM. */
export function __resetChatwootForTests(): void {
  active = null;
  loadedFor.clear();
}

async function waitForReady(timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.$chatwoot) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("$chatwoot did not become ready");
}
