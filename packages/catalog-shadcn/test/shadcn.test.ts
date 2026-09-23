import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lintCatalog,
  compileSurface,
  ReplayClient,
  humanizePointer,
  schemaTitleForPointer,
} from "@lathe/core";
import { SHADCN_CATALOG, SHADCN_PHRASE_BANK } from "../src/index.ts";

describe("@lathe/shadcn catalog & M1/M2 features", () => {
  it("passes lintCatalog with zero errors and zero warnings", () => {
    const report = lintCatalog(SHADCN_CATALOG);
    assert.equal(
      report.ok,
      true,
      `Expected SHADCN_CATALOG to pass linter, got findings: ${JSON.stringify(report.findings, null, 2)}`,
    );
    assert.equal(
      report.findings.length,
      0,
      `Expected zero findings (including warnings), got: ${JSON.stringify(report.findings, null, 2)}`,
    );
  });

  it("resolves PhraseBank labels, JSON Schema titles, humanizePointer fallback, and Card layout grouping", async () => {
    const state = {
      order: {
        duplicate_amount_usd: 149.0,
        status: "DISPUTED",
      },
      customer: {
        email: "maya@acme.io",
      },
    };

    const schema = {
      type: "object",
      properties: {
        customer: {
          type: "object",
          properties: {
            email: {
              type: "string",
              title: "Verified Contact Email",
            },
          },
        },
      },
    };

    // Build a ReplayClient with deterministic answers for SHADCN_CATALOG + groupBlocks: true (staged mode)
    const replay = new ReplayClient({
      answers: {
        // Block B000 (/order/duplicate_amount_usd -> Stat)
        include_B000: { type: "noul", noul: 0.99, probabilities: { yes: 0.99, no: 0.01 } },
        component_B000: {
          type: "choice",
          choice: "Stat",
          confidence: 0.96,
          probabilities: { Stat: 0.96, Progress: 0.04 },
        },
        prop_B000_Stat_value: {
          type: "choice",
          choice: "/order/duplicate_amount_usd",
          confidence: 0.99,
          probabilities: { "/order/duplicate_amount_usd": 0.99 },
        },
        prop_B000_Stat_label: {
          type: "choice",
          choice: "order.amount_usd",
          confidence: 0.94,
          probabilities: { "order.amount_usd": 0.94, __auto__: 0.06 },
        },
        prop_B000_Stat_format: {
          type: "choice",
          choice: "currency",
          confidence: 0.98,
          probabilities: { currency: 0.98, integer: 0.01, decimal: 0.01 },
        },
        stated_B000_Stat_format: {
          type: "noul",
          noul: 0.95,
          probabilities: { yes: 0.95, no: 0.05 },
        },

        // Block B001 (/order/status -> Badge, with __auto__ fallback to humanizePointer)
        include_B001: { type: "noul", noul: 0.98, probabilities: { yes: 0.98, no: 0.02 } },
        component_B001: {
          type: "choice",
          choice: "Badge",
          confidence: 0.95,
          probabilities: { Badge: 0.95, Alert: 0.05 },
        },
        prop_B001_Badge_text: {
          type: "choice",
          choice: "/order/status",
          confidence: 0.99,
          probabilities: { "/order/status": 0.99 },
        },
        prop_B001_Badge_label: {
          type: "choice",
          choice: "__auto__",
          confidence: 0.91,
          probabilities: { __auto__: 0.91 },
        },
        prop_B001_Badge_variant: {
          type: "choice",
          choice: "destructive",
          confidence: 0.93,
          probabilities: { destructive: 0.93, default: 0.07 },
        },
        stated_B001_Badge_variant: {
          type: "noul",
          noul: 0.94,
          probabilities: { yes: 0.94, no: 0.06 },
        },

        // Block B002 (/customer/email -> Input, with __auto__ fallback to JSON Schema title)
        include_B002: { type: "noul", noul: 0.97, probabilities: { yes: 0.97, no: 0.03 } },
        component_B002: {
          type: "choice",
          choice: "Input",
          confidence: 0.94,
          probabilities: { Input: 0.94, Badge: 0.06 },
        },
        prop_B002_Input_value: {
          type: "choice",
          choice: "/customer/email",
          confidence: 0.99,
          probabilities: { "/customer/email": 0.99 },
        },
        prop_B002_Input_label: {
          type: "choice",
          choice: "__auto__",
          confidence: 0.92,
          probabilities: { __auto__: 0.92 },
        },
        prop_B002_Input_inputType: {
          type: "choice",
          choice: "email",
          confidence: 0.98,
          probabilities: { email: 0.98, text: 0.02 },
        },
        stated_B002_Input_inputType: {
          type: "noul",
          noul: 0.96,
          probabilities: { yes: 0.96, no: 0.04 },
        },

        // M2 Adjacent-pair grouping: group B000 and B001 together into a Card, keep B002 separate
        group_B000_B001: { type: "noul", noul: 0.91, probabilities: { yes: 0.91, no: 0.09 } },
        group_B001_B002: { type: "noul", noul: 0.12, probabilities: { yes: 0.12, no: 0.88 } },
      },
    });

    const compiled = await compileSurface({
      state,
      surfaceId: "dispute-triage",
      catalog: SHADCN_CATALOG,
      client: replay,
      phraseBank: SHADCN_PHRASE_BANK,
      schema,
      groupBlocks: true,
      mode: "staged",
    });

    const updateMsg = compiled.messages.find((m) => "updateComponents" in m) as
      | { updateComponents: { components: Array<Record<string, unknown>> } }
      | undefined;
    assert.ok(updateMsg);
    const components = updateMsg.updateComponents.components;

    // 1. Check PhraseBank match on B000 (Stat)
    const statBlock = components.find((c) => c["id"] === "c_b000");
    assert.ok(statBlock);
    assert.equal(statBlock["label"], "Charged Amount (USD)");

    // 2. Check humanizePointer fallback on B001 (Badge)
    const badgeBlock = components.find((c) => c["id"] === "c_b001");
    assert.ok(badgeBlock);
    assert.equal(badgeBlock["label"], humanizePointer("/order/status"));

    // 3. Check JSON Schema title fallback on B002 (Input)
    const inputBlock = components.find((c) => c["id"] === "c_b002");
    assert.ok(inputBlock);
    assert.equal(inputBlock["label"], "Verified Contact Email");
    assert.equal(schemaTitleForPointer(schema, "/customer/email"), "Verified Contact Email");

    // 4. Check M2 Card grouping: c_b000 and c_b001 should be wrapped inside group_1
    const cardContainer = components.find((c) => c["id"] === "group_1");
    assert.ok(cardContainer, "Expected group_1 Card container to be emitted when group_B000_B001 is yes");
    assert.equal(cardContainer["component"], "Card");
    assert.deepEqual(cardContainer["children"], ["c_b000", "c_b001"]);

    const rootContainer = components.find((c) => c["id"] === "root");
    assert.ok(rootContainer);
    assert.deepEqual(rootContainer["children"], ["group_1", "c_b002"]);
  });

  it("compiles a homogeneous array of objects into a single DataTable with typed column formats", async () => {
    const state = {
      order: {
        duplicate_amount_usd: 284.5,
      },
      line_items: [
        { sku: "PRO-SEAT", qty: 5, unit_price_usd: 49.0 },
        { sku: "API-OVERAGE", qty: 1, unit_price_usd: 39.5 },
      ],
    };

    const replay = new ReplayClient({
      answers: {
        // Scalar block B000 (/order/duplicate_amount_usd -> Stat)
        include_B000: { type: "noul", noul: 0.99, probabilities: { yes: 0.99, no: 0.01 } },
        component_B000: {
          type: "choice",
          choice: "Stat",
          confidence: 0.96,
          probabilities: { Stat: 0.96, Progress: 0.04 },
        },
        prop_B000_Stat_label: {
          type: "choice",
          choice: "order.amount_usd",
          confidence: 0.94,
          probabilities: { "order.amount_usd": 0.94, __auto__: 0.06 },
        },
        prop_B000_Stat_format: {
          type: "choice",
          choice: "currency",
          confidence: 0.98,
          probabilities: { currency: 0.98, integer: 0.01, decimal: 0.01 },
        },
        stated_B000_Stat_format: {
          type: "noul",
          noul: 0.95,
          probabilities: { yes: 0.95, no: 0.05 },
        },

        // Collection block B001 (/line_items -> DataTable)
        include_B001: { type: "noul", noul: 0.99, probabilities: { yes: 0.99, no: 0.01 } },
        component_B001: {
          type: "choice",
          choice: "DataTable",
          confidence: 0.97,
          probabilities: { DataTable: 0.97, DataList: 0.03 },
        },
        prop_B001_DataTable_title: {
          type: "choice",
          choice: "order.line_items",
          confidence: 0.95,
          probabilities: { "order.line_items": 0.95, __auto__: 0.05 },
        },
        prop_B001_DataTable_density: {
          type: "choice",
          choice: "comfortable",
          confidence: 0.92,
          probabilities: { comfortable: 0.92, compact: 0.08 },
        },
        stated_B001_DataTable_density: {
          type: "noul",
          noul: 0.91,
          probabilities: { yes: 0.91, no: 0.09 },
        },
        col_format_B001_sku: {
          type: "choice",
          choice: "badge",
          confidence: 0.94,
          probabilities: { badge: 0.94, text: 0.06 },
        },
        col_format_B001_qty: {
          type: "choice",
          choice: "integer",
          confidence: 0.97,
          probabilities: { integer: 0.97, currency: 0.02, decimal: 0.01 },
        },
        col_format_B001_unit_price_usd: {
          type: "choice",
          choice: "currency",
          confidence: 0.99,
          probabilities: { currency: 0.99, decimal: 0.01, integer: 0.0 },
        },
      },
    });

    const compiled = await compileSurface({
      state,
      surfaceId: "invoice-items",
      catalog: SHADCN_CATALOG,
      client: replay,
      phraseBank: SHADCN_PHRASE_BANK,
      mode: "staged",
    });

    // Should have exactly 2 blocks (B000 scalar + B001 collection), NOT 1 + 6 scalar blocks!
    assert.equal(compiled.stats.blocks, 2);
    assert.equal(compiled.stats.rendered, 2);

    const updateMsg = compiled.messages.find((m) => "updateComponents" in m) as {
      updateComponents: { components: Array<Record<string, unknown>> };
    };
    const tableComp = updateMsg.updateComponents.components.find((c) => c["id"] === "c_b001");
    assert.ok(tableComp);
    assert.equal(tableComp["component"], "DataTable");
    assert.deepEqual(tableComp["rows"], { path: "/line_items" });
    assert.equal(tableComp["title"], "Order Line Items");
    assert.deepEqual(tableComp["columns"], [
      { key: "sku", label: "SKU", format: "badge" },
      { key: "qty", label: "Quantity", format: "integer" },
      { key: "unit_price_usd", label: "Unit Price (USD)", format: "currency" },
    ]);
  });

  it("recovers empty strings and applies JSON Schema enum/range constraints for Select, Slider, and Textarea", async () => {
    const state = {
      resolution: {
        decision: "APPROVE_FULL",
        refund_split_pct: 50,
        reviewer_memo: "",
      },
    };

    const schema = {
      type: "object",
      properties: {
        resolution: {
          type: "object",
          properties: {
            decision: {
              type: "string",
              enum: ["APPROVE_FULL", "PARTIAL_CREDIT", "REJECT_DISPUTE"],
            },
            refund_split_pct: {
              type: "number",
              minimum: 0,
              maximum: 100,
            },
            reviewer_memo: {
              type: "string",
              multiline: true,
              description: "Enter audit justification for the card network...",
            },
          },
        },
      },
    };

    const replay = new ReplayClient({
      answers: {
        include_B000: { type: "noul", noul: 0.99, probabilities: { yes: 0.99, no: 0.01 } },
        component_B000: {
          type: "choice",
          choice: "Select",
          confidence: 0.96,
          probabilities: { Select: 0.96, Badge: 0.04 },
        },
        prop_B000_Select_label: {
          type: "choice",
          choice: "resolution.decision",
          confidence: 0.95,
          probabilities: { "resolution.decision": 0.95, __auto__: 0.05 },
        },

        include_B001: { type: "noul", noul: 0.98, probabilities: { yes: 0.98, no: 0.02 } },
        component_B001: {
          type: "choice",
          choice: "Slider",
          confidence: 0.95,
          probabilities: { Slider: 0.95, Progress: 0.05 },
        },
        prop_B001_Slider_label: {
          type: "choice",
          choice: "resolution.refund_pct",
          confidence: 0.94,
          probabilities: { "resolution.refund_pct": 0.94, __auto__: 0.06 },
        },

        include_B002: { type: "noul", noul: 0.97, probabilities: { yes: 0.97, no: 0.03 } },
        component_B002: {
          type: "choice",
          choice: "Textarea",
          confidence: 0.96,
          probabilities: { Textarea: 0.96, Input: 0.04 },
        },
        prop_B002_Textarea_label: {
          type: "choice",
          choice: "resolution.memo",
          confidence: 0.95,
          probabilities: { "resolution.memo": 0.95, __auto__: 0.05 },
        },
        prop_B002_Textarea_size: {
          type: "choice",
          choice: "expanded",
          confidence: 0.92,
          probabilities: { expanded: 0.92, compact: 0.08 },
        },
        stated_B002_Textarea_size: {
          type: "noul",
          noul: 0.93,
          probabilities: { yes: 0.93, no: 0.07 },
        },
      },
    });

    const compiled = await compileSurface({
      state,
      schema,
      surfaceId: "resolution-form",
      catalog: SHADCN_CATALOG,
      client: replay,
      phraseBank: SHADCN_PHRASE_BANK,
      mode: "staged",
    });

    assert.equal(compiled.stats.blocks, 3, "Should include the empty reviewer_memo string block");
    assert.equal(compiled.stats.rendered, 3);

    const updateMsg = compiled.messages.find((m) => "updateComponents" in m) as {
      updateComponents: { components: Array<Record<string, unknown>> };
    };
    const comps = updateMsg.updateComponents.components;

    const selectComp = comps.find((c) => c["id"] === "c_b000");
    assert.ok(selectComp);
    assert.equal(selectComp["component"], "Select");
    assert.deepEqual(selectComp["options"], ["APPROVE_FULL", "PARTIAL_CREDIT", "REJECT_DISPUTE"]);

    const sliderComp = comps.find((c) => c["id"] === "c_b001");
    assert.ok(sliderComp);
    assert.equal(sliderComp["component"], "Slider");
    assert.equal(sliderComp["min"], 0);
    assert.equal(sliderComp["max"], 100);

    const textareaComp = comps.find((c) => c["id"] === "c_b002");
    assert.ok(textareaComp);
    assert.equal(textareaComp["component"], "Textarea");
    assert.equal(
      textareaComp["placeholder"],
      "Enter audit justification for the card network...",
    );
  });
});
