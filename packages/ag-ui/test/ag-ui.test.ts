import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Catalog, PhraseBank, ReplayClient } from "@lathe/core";
import { LatheAgUiMiddleware, computeShapeHash, formatSseFrame } from "../src/index.ts";

const MINI_CATALOG = new Catalog("https://lathe.dev/catalogs/ag-ui-test/v1", [
  { name: "Stack", description: "Vertical stack.", container: true },
  {
    name: "Stat",
    description: "Numeric KPI.",
    props: [
      { name: "value", kind: "binding", valueType: "number", description: "Number." },
      { name: "label", kind: "phrase", description: "Label." },
    ],
  },
  {
    name: "LinkButton",
    description: "External link.",
    props: [
      { name: "href", kind: "binding", valueType: "string", sink: "url", description: "URL." },
      { name: "label", kind: "phrase", description: "Caption." },
    ],
  },
]);

const MINI_PHRASES = new PhraseBank([
  { key: "order.amount_usd", text: "Charged Amount (USD)" },
  { key: "order.receipt_url", text: "View Receipt" },
]);

describe("@lathe/ag-ui middleware & shape-hash cache", () => {
  it("computes identical shape hashes across varying runtime values and distinct hashes when schema changes", () => {
    const s1 = { order: { amount: 120.5, receipt: "https://acme.io/r/1" } };
    const s2 = { order: { amount: 999.0, receipt: "https://acme.io/r/2" } };
    const s3 = { order: { amount: 999.0, receipt: "https://acme.io/r/2", flagged: true } };

    assert.equal(
      computeShapeHash(s1, MINI_CATALOG.catalogId),
      computeShapeHash(s2, MINI_CATALOG.catalogId),
    );
    assert.notEqual(
      computeShapeHash(s1, MINI_CATALOG.catalogId),
      computeShapeHash(s3, MINI_CATALOG.catalogId),
    );
  });

  it("caches compiled layout by shapeHash, updates data model on cache hit, and still runs @lathe/guard on new state values", async () => {
    const replay = new ReplayClient({
      answers: {
        include_B000: { type: "noul", noul: 0.99, probabilities: { yes: 0.99, no: 0.01 } },
        component_B000: {
          type: "choice",
          choice: "Stat",
          confidence: 0.97,
          probabilities: { Stat: 0.97, LinkButton: 0.03 },
        },
        prop_B000_Stat_value: {
          type: "choice",
          choice: "/order/amount_usd",
          confidence: 0.99,
          probabilities: { "/order/amount_usd": 0.99 },
        },
        prop_B000_Stat_label: {
          type: "choice",
          choice: "order.amount_usd",
          confidence: 0.95,
          probabilities: { "order.amount_usd": 0.95 },
        },

        include_B001: { type: "noul", noul: 0.98, probabilities: { yes: 0.98, no: 0.02 } },
        component_B001: {
          type: "choice",
          choice: "LinkButton",
          confidence: 0.96,
          probabilities: { LinkButton: 0.96, Stat: 0.04 },
        },
        prop_B001_LinkButton_href: {
          type: "choice",
          choice: "/order/receipt_url",
          confidence: 0.99,
          probabilities: { "/order/receipt_url": 0.99 },
        },
        prop_B001_LinkButton_label: {
          type: "choice",
          choice: "order.receipt_url",
          confidence: 0.94,
          probabilities: { "order.receipt_url": 0.94 },
        },
      },
    });

    const middleware = new LatheAgUiMiddleware({
      catalog: MINI_CATALOG,
      client: replay,
      phraseBank: MINI_PHRASES,
    });

    // 1st call: compiles via ReplayClient
    const first = await middleware.compile({
      surfaceId: "s-order",
      state: {
        order: {
          amount_usd: 149.0,
          receipt_url: "https://acme.example.com/receipts/101",
        },
      },
      mode: "staged",
    });

    assert.equal(first.cached, false);
    assert.equal(first.guardReport.ok, true);
    assert.equal(first.events.length, 3);
    assert.ok(formatSseFrame(first.events[0]!).startsWith("event: STATE_SNAPSHOT\ndata: "));

    // 2nd call with same JSON shape but poisoned javascript: URL in state:
    // Should hit the shape cache (0 model calls) AND @lathe/guard should still catch the unsafe URL!
    const second = await middleware.compile({
      surfaceId: "s-order",
      state: {
        order: {
          amount_usd: 420.75,
          receipt_url: "javascript:alert(document.domain)",
        },
      },
      mode: "staged",
    });

    assert.equal(second.cached, true);
    assert.equal(second.compileResult.stats.roundTrips, 0);
    assert.equal(second.guardReport.ok, false);
    assert.equal(second.guardReport.findings[0]?.code, "unsafe_url_scheme");
  });
});
