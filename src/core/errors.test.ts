import { test } from "node:test";
import assert from "node:assert";
import {
  P2PError,
  classifyError,
  registerRevertSelectors,
  lookupRevertSelector,
  noEligibleMerchantsError,
  missingRoutingInputsError,
  encryptionPreflightError,
} from "./errors.ts";

// Silence the structured `console.error` that the classifier's logger emits
// during these tests — they're unit-tests for classification, not for log
// output, and the noise drowns out node:test's progress reporter.
const realConsoleError = console.error;
console.error = () => {};

// ─── classifyError: wallet rejection ────────────────────────────────

test("classifyError: detects viem-shaped UserRejectedRequestError by .name", () => {
  const err = { name: "UserRejectedRequestError", message: "User rejected" };
  const p = classifyError(err);
  assert.strictEqual(p.code, "WALLET_USER_REJECTED");
  assert.strictEqual(p.category, "wallet");
  assert.ok(p.userMessage.includes("Transaction was rejected"));
});

test("classifyError: detects EIP-1193 4001 rejection code", () => {
  const err = { code: 4001, message: "Request was denied" };
  const p = classifyError(err);
  assert.strictEqual(p.code, "WALLET_USER_REJECTED");
});

test("classifyError: detects ACTION_REJECTED string code", () => {
  const err = { code: "ACTION_REJECTED", message: "rejected" };
  const p = classifyError(err);
  assert.strictEqual(p.code, "WALLET_USER_REJECTED");
});

test("classifyError: detects rejection by message regex on nested cause", () => {
  const err = { message: "wrap", cause: { message: "User rejected the request." } };
  const p = classifyError(err);
  assert.strictEqual(p.code, "WALLET_USER_REJECTED");
});

// ─── classifyError: insufficient funds ──────────────────────────────

test("classifyError: detects insufficient funds via message", () => {
  const err = { shortMessage: "Insufficient funds for transfer" };
  const p = classifyError(err);
  assert.strictEqual(p.code, "WALLET_INSUFFICIENT_FUNDS");
  assert.strictEqual(p.category, "wallet");
});

// ─── classifyError: known revert ────────────────────────────────────

test("classifyError: maps a known revert selector to its registered name", () => {
  // B2BProxyAddressMismatch — the exact selector that the bug-report was about.
  const err = {
    message: "Execution reverted for an unknown reason",
    data: "0x746c8c18",
  };
  const p = classifyError(err);
  assert.strictEqual(p.code, "REVERT_KNOWN");
  assert.strictEqual(p.category, "revert");
  assert.strictEqual(p.revertSelector, "0x746c8c18");
  assert.strictEqual(p.revertName, "B2BProxyAddressMismatch");
  assert.ok(p.userMessage.length > 0);
  assert.ok(p.hint && p.hint.length > 0);
  assert.strictEqual(p.retryable, false);
});

test("classifyError: walks the cause chain to find revert data on inner errors (viem ContractFunctionRevertedError shape)", () => {
  const err = {
    name: "ContractFunctionExecutionError",
    shortMessage: "The contract function reverted",
    cause: {
      name: "ContractFunctionRevertedError",
      raw: "0xee5603c8aaaa", // B2BIntegratorInactive + dummy padding
    },
  };
  const p = classifyError(err);
  assert.strictEqual(p.code, "REVERT_KNOWN");
  assert.strictEqual(p.revertName, "B2BIntegratorInactive");
});

test("classifyError: unknown revert selector classifies as REVERT_UNKNOWN with hint", () => {
  const err = { data: "0xabcdef1200" };
  const p = classifyError(err);
  assert.strictEqual(p.code, "REVERT_UNKNOWN");
  assert.strictEqual(p.revertSelector, "0xabcdef12");
  assert.ok(p.hint && p.hint.includes("cast 4byte"));
  assert.ok(p.hint && p.hint.includes("registerRevertSelectors"));
});

test("classifyError: selector matching is case-insensitive", () => {
  const err = { data: "0xEE5603C8" };
  const p = classifyError(err);
  assert.strictEqual(p.revertName, "B2BIntegratorInactive");
});

// ─── classifyError: network errors ──────────────────────────────────

test("classifyError: detects viem TimeoutError as NETWORK_TIMEOUT", () => {
  const err = { name: "TimeoutError", message: "Request timed out" };
  const p = classifyError(err);
  assert.strictEqual(p.code, "NETWORK_TIMEOUT");
});

test("classifyError: detects HttpRequestError as NETWORK_RPC_UNREACHABLE", () => {
  const err = { name: "HttpRequestError", message: "Failed to fetch" };
  const p = classifyError(err);
  assert.strictEqual(p.code, "NETWORK_RPC_UNREACHABLE");
});

test("classifyError: detects 'Failed to fetch' string as RPC unreachable", () => {
  const err = new Error("Failed to fetch");
  const p = classifyError(err);
  assert.strictEqual(p.code, "NETWORK_RPC_UNREACHABLE");
});

// ─── classifyError: P2PError pass-through ───────────────────────────

test("classifyError: returns the same instance when given a P2PError with no extra context", () => {
  const original = new P2PError({
    code: "WALLET_USER_REJECTED",
    category: "wallet",
    userMessage: "msg",
  });
  const out = classifyError(original);
  assert.strictEqual(out, original);
});

test("classifyError: merges extra context onto an existing P2PError without losing fields", () => {
  const original = new P2PError({
    code: "REVERT_KNOWN",
    category: "revert",
    userMessage: "...",
    revertSelector: "0xdeadbeef",
    revertName: "Custom",
    retryable: false,
    context: { flow: "place-buy" },
  });
  const out = classifyError(original, { orderId: "42" });
  assert.notStrictEqual(out, original);
  assert.strictEqual(out.code, "REVERT_KNOWN");
  assert.strictEqual(out.revertSelector, "0xdeadbeef");
  assert.strictEqual(out.revertName, "Custom");
  assert.strictEqual(out.retryable, false);
  assert.strictEqual(out.context.flow, "place-buy");
  assert.strictEqual(out.context.orderId, "42");
});

// ─── classifyError: unknown fallthrough ─────────────────────────────

test("classifyError: falls through to UNKNOWN with the original message", () => {
  const p = classifyError(new Error("Something weird"));
  assert.strictEqual(p.code, "UNKNOWN");
  assert.strictEqual(p.category, "unknown");
  assert.strictEqual(p.userMessage, "Something weird");
});

test("classifyError: tolerates undefined / null / string inputs", () => {
  assert.strictEqual(classifyError(undefined).code, "UNKNOWN");
  assert.strictEqual(classifyError(null).code, "UNKNOWN");
  assert.strictEqual(classifyError("plain string").userMessage, "plain string");
});

// ─── Selector registry extensibility ────────────────────────────────

test("registerRevertSelectors: hosts can extend the registry at runtime", () => {
  registerRevertSelectors({
    "0xc0ffee00": { name: "BrewError", userMessage: "Out of coffee.", retryable: false },
  });
  const entry = lookupRevertSelector("0xc0ffee00");
  assert.ok(entry);
  assert.strictEqual(entry!.name, "BrewError");

  const p = classifyError({ data: "0xc0ffee00aaaa" });
  assert.strictEqual(p.code, "REVERT_KNOWN");
  assert.strictEqual(p.revertName, "BrewError");
  assert.strictEqual(p.userMessage, "Out of coffee.");
  assert.strictEqual(p.retryable, false);
});

test("registerRevertSelectors: re-registering overrides the prior entry", () => {
  registerRevertSelectors({
    "0xdeadbeef": { name: "First", userMessage: "first" },
  });
  registerRevertSelectors({
    "0xdeadbeef": { name: "Second", userMessage: "second" },
  });
  const entry = lookupRevertSelector("0xdeadbeef");
  assert.strictEqual(entry!.name, "Second");
});

// ─── Pre-built constructors (sanity) ────────────────────────────────

test("noEligibleMerchantsError: builds a routing P2PError with the SDK error on cause", () => {
  const sdkErr = new Error("No eligible circles");
  const p = noEligibleMerchantsError({ flow: "place-buy" }, sdkErr);
  assert.strictEqual(p.code, "ROUTING_NO_MERCHANTS");
  assert.strictEqual(p.category, "routing");
  assert.strictEqual(p.cause, sdkErr);
  assert.ok(!p.userMessage.toLowerCase().includes("circle"));
  assert.strictEqual(p.retryable, false);
});

test("missingRoutingInputsError: classifies as validation, non-retryable", () => {
  const p = missingRoutingInputsError("needs subgraphUrl", { flow: "place-sell" });
  assert.strictEqual(p.code, "ROUTING_MISSING_INPUTS");
  assert.strictEqual(p.category, "validation");
  assert.strictEqual(p.retryable, false);
});

test("encryptionPreflightError: classifies as encryption with a user-friendly message", () => {
  const p = encryptionPreflightError("crypto.subtle missing", { flow: "place-sell" });
  assert.strictEqual(p.code, "ENCRYPTION_PREFLIGHT_FAILED");
  assert.strictEqual(p.category, "encryption");
  // dev message preserved
  assert.ok(p.message.includes("crypto.subtle"));
  // user-facing message is jargon-free
  assert.ok(!p.userMessage.includes("crypto.subtle"));
});

// ─── P2PError instance basics ──────────────────────────────────────

test("P2PError: is an Error subclass with stable .name", () => {
  const p = new P2PError({
    code: "UNKNOWN",
    category: "unknown",
    userMessage: "x",
  });
  assert.ok(p instanceof Error);
  assert.ok(p instanceof P2PError);
  assert.strictEqual(p.name, "P2PError");
});

test("P2PError: devMessage falls back to userMessage when omitted", () => {
  const p = new P2PError({
    code: "UNKNOWN",
    category: "unknown",
    userMessage: "to the user",
  });
  assert.strictEqual(p.message, "to the user");
});

// Restore console.error so subsequent test files (if any) see normal output.
test("teardown: restore console.error", () => {
  console.error = realConsoleError;
});
