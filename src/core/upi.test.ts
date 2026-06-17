import { test } from "node:test";
import assert from "node:assert";
import { buildUpiQuery, buildUpiIntent, UPI_APPS } from "./upi.ts";

test("buildUpiQuery includes pa, am and forces cu=INR", () => {
  const p = new URLSearchParams(buildUpiQuery({ pa: "merchant@okhdfc", am: "125.00" }));
  assert.strictEqual(p.get("pa"), "merchant@okhdfc");
  assert.strictEqual(p.get("am"), "125.00");
  assert.strictEqual(p.get("cu"), "INR");
});

test("buildUpiQuery omits pn, tn, tr when not provided", () => {
  const p = new URLSearchParams(buildUpiQuery({ pa: "a@b", am: "1.00" }));
  assert.strictEqual(p.has("pn"), false);
  assert.strictEqual(p.has("tn"), false);
  assert.strictEqual(p.has("tr"), false);
});

test("buildUpiQuery includes pn, tn, tr when provided", () => {
  const p = new URLSearchParams(
    buildUpiQuery({ pa: "a@b", am: "1.00", pn: "Acme Store", tn: "Order 42", tr: "42" }),
  );
  assert.strictEqual(p.get("pn"), "Acme Store");
  assert.strictEqual(p.get("tn"), "Order 42");
  assert.strictEqual(p.get("tr"), "42");
});

test("buildUpiQuery caps pn at 40 characters", () => {
  const p = new URLSearchParams(buildUpiQuery({ pa: "a@b", am: "1.00", pn: "A".repeat(60) }));
  assert.strictEqual(p.get("pn"), "A".repeat(40));
});

test("buildUpiQuery url-encodes reserved characters", () => {
  const q = buildUpiQuery({ pa: "a@b", am: "1.00", pn: "Tom & Jerry" });
  assert.ok(q.includes("pn=Tom+%26+Jerry"));
});

test("buildUpiIntent prefixes the upi://pay scheme", () => {
  const url = buildUpiIntent({ pa: "a@b", am: "1.00" });
  assert.ok(url.startsWith("upi://pay?"));
});

test("UPI_APPS build per-app deep links from a query string", () => {
  const q = buildUpiQuery({ pa: "a@b", am: "1.00" });
  const byId = Object.fromEntries(UPI_APPS.map((a) => [a.id, a.href(q)]));
  assert.ok(byId.phonepe.startsWith("phonepe://pay?"));
  assert.ok(byId.gpay.startsWith("gpay://upi/pay?"));
  assert.ok(byId.paytm.startsWith("paytmmp://pay?"));
  assert.ok(byId.bhim.startsWith("bhim://upi/pay?"));
});
