import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { triageIncidentWithJev } from "./server.js";

describe("AegisPay Ops Desk — Real-World Lathe (jev-1.13.0 + AG-UI + MCP) Integration", () => {
  it("routes natural language analyst prompts via jev-1.13.0, catches hallucinated claims with jev.noul, and hits 0ms Shape-Hash Cache", async () => {
    const res1 = await triageIncidentWithJev({
      userPrompt: "Inspect the Postgres ledger lock spike in Japanese",
      includeHallucinationTest: true,
    });

    assert.equal(res1.routedByJev.intentChoice, "postgres_slow_query");
    assert.equal(res1.routedByJev.localeChoice, "ja");
    assert.equal(res1.mcpCompilation.guardVerified, true);

    const entailedClaims = res1.chatClaims.filter((c) => c.verdict === "ENTAILED");
    const blockedClaims = res1.chatClaims.filter(
      (c) => c.verdict === "CONTRADICTED_BLOCKED",
    );
    assert.equal(entailedClaims.length, 2);
    assert.equal(blockedClaims.length, 1);
    assert.ok(blockedClaims[0]!.noulScore < 0.5);

    const res2 = await triageIncidentWithJev({
      ticketId: "inc_pg_404",
      locale: "es",
      includeHallucinationTest: false,
    });
    assert.equal(res2.mcpCompilation.cacheHit, true);
    assert.equal(res2.routedByJev.localeChoice, "es");
  });
});
