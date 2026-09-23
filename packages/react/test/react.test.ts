import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyPointerPatch, renderSurfaceToHtml } from "../src/index.ts";

describe("@lathe/react renderer & two-way RFC 6901 pointer patching", () => {
  it("immutably patches nested and escaped RFC 6901 JSON Pointers", () => {
    const initial = {
      order: { amount_usd: 149.0 },
      "a/b": { "c~d": "initial" },
    };

    const next1 = applyPointerPatch(initial, "/order/amount_usd", 220.5);
    assert.equal(initial.order.amount_usd, 149.0);
    assert.equal(next1.order.amount_usd, 220.5);

    const next2 = applyPointerPatch(next1, "/a~1b/c~0d", "updated");
    assert.equal(next2["a/b"]["c~d"], "updated");
  });

  it("renders high-confidence components, runner-up swap chips, and low-confidence fallbacks", () => {
    const state = {
      order: {
        amount_usd: 184.5,
        status: "DISPUTED",
        mystery_code: "<script>alert(1)</script>",
      },
    };

    const messages = [
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Stack", direction: "column", children: ["c_high", "c_mid", "c_low"] },
            {
              id: "c_high",
              component: "Stat",
              value: { path: "/order/amount_usd" },
              label: "Charged Amount (USD)",
              format: "currency",
            },
            {
              id: "c_mid",
              component: "Badge",
              text: { path: "/order/status" },
              label: "Status",
              variant: "destructive",
            },
            {
              id: "c_low",
              component: "Input",
              value: { path: "/order/mystery_code" },
              label: "Mystery",
              inputType: "text",
            },
          ],
        },
      },
    ];

    const html = renderSurfaceToHtml({
      messages,
      state,
      calibration: {
        c_high: {
          componentId: "c_high",
          blockId: "B000",
          pointer: "/order/amount_usd",
          component: "Stat",
          confidence: 0.96,
          probabilities: { Stat: 0.96, Progress: 0.04 },
          runnerUp: "Progress",
          runnerUpProbability: 0.04,
          props: {},
        },
        c_mid: {
          componentId: "c_mid",
          blockId: "B001",
          pointer: "/order/status",
          component: "Badge",
          confidence: 0.72,
          probabilities: { Badge: 0.72, Alert: 0.28 },
          runnerUp: "Alert",
          runnerUpProbability: 0.28,
          props: {},
        },
        c_low: {
          componentId: "c_low",
          blockId: "B002",
          pointer: "/order/mystery_code",
          component: "Input",
          confidence: 0.41,
          probabilities: { Input: 0.41, Badge: 0.35, Alert: 0.24 },
          runnerUp: "Badge",
          runnerUpProbability: 0.35,
          props: {},
        },
      },
    });

    assert.ok(html.includes("$184.50"), "High-confidence Stat should render formatted currency");
    assert.ok(
      html.includes('data-lathe-runner-up="Alert"'),
      "Medium-confidence (0.72) Badge should render runner-up swap chip for Alert",
    );
    assert.ok(
      html.includes("lathe-degraded-card"),
      "Low-confidence (0.41) component should degrade to read-only fallback card",
    );
    assert.ok(
      !html.includes("<script>alert(1)</script>") && html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
      "Text values must be HTML-escaped",
    );
  });
});
