// Lightweight UA-based platform detection for choosing the UPI launch surface.
// The UA is an injectable param so the pure logic is testable under node:test
// (no jsdom); at runtime it defaults to navigator.userAgent, SSR-guarded.
//
// Known limitation: iPadOS 13+ Safari reports a desktop ("Macintosh") UA, so an
// iPad falls through to the desktop QR. Acceptable — UPI on iPad is negligible.

function ua(): string {
  return typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "";
}

export function isIOS(s: string = ua()): boolean {
  return /iPhone|iPad|iPod/i.test(s);
}

export function isAndroid(s: string = ua()): boolean {
  return /Android/i.test(s);
}
