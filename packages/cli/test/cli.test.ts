import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "../../../spec/conformance/fixtures");

describe("@orcawhisperer/lathe-cli", () => {
  it("lathe lint passes SHADCN_CATALOG with 0 errors and 0 warnings", async () => {
    const res = await runCli(["lint", "--catalog", "shadcn"]);
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("Status: PASS (0 errors, 0 warnings)"));
  });

  it("lathe compile, verify, and render with zero-call multi-locale switching (en -> es -> ja)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "lathe-cli-test-"));
    try {
      const statePath = join(tmp, "state.json");
      const surfacePath = join(tmp, "surface.json");
      const tamperedPath = join(tmp, "tampered.json");
      const fixturePath = join(FIXTURES_DIR, "scalars_mixed.json");
      const fixture = JSON.parse(
        (await import("node:fs")).readFileSync(fixturePath, "utf-8"),
      ) as { input: { state: Record<string, unknown>; mode: string } };

      writeFileSync(statePath, JSON.stringify(fixture.input.state), "utf-8");

      // 1. Compile with replay fixture
      const compileRes = await runCli([
        "compile",
        "--state",
        statePath,
        "--catalog",
        "basic",
        "--mode",
        fixture.input.mode,
        "--replay",
        fixturePath,
        "--out",
        surfacePath,
      ]);
      assert.equal(compileRes.exitCode, 0, compileRes.stderr);
      const compiled = JSON.parse(compileRes.stdout) as {
        guard: { ok: boolean };
        messages: Record<string, unknown>[];
      };
      assert.equal(compiled.guard.ok, true);

      // 2. Verify clean surface
      const verifyRes = await runCli([
        "verify",
        "--surface",
        surfacePath,
        "--catalog",
        "basic",
      ]);
      assert.equal(verifyRes.exitCode, 0);
      assert.ok(verifyRes.stdout.includes("Status: PASS"));

      // 3. Inject phrase selectionTrace and render in Spanish (es) & Japanese (ja) with 0 model calls
      const msgWithPhrase = structuredClone(compiled.messages);
      const compMsg = msgWithPhrase.find((m) => "updateComponents" in m) as {
        updateComponents: { components: Record<string, unknown>[] };
      };
      const firstScalar = compMsg.updateComponents.components.find(
        (c) => c["id"] !== "root",
      )!;
      const blockId = String(firstScalar["id"]);
      firstScalar["component"] = "Stat";
      firstScalar["label"] = "Charged Amount (USD)";
      firstScalar["_lathe"] = {
        ...(firstScalar["_lathe"] as Record<string, unknown>),
        selectionTrace: {
          [`prop_phrase_${blockId}_label`]: {
            choice: "order.amount_usd",
            confidence: 0.99,
          },
        },
      };
      writeFileSync(surfacePath, JSON.stringify({ messages: msgWithPhrase }), "utf-8");

      const renderEs = await runCli([
        "render",
        "--surface",
        surfacePath,
        "--locale",
        "es",
      ]);
      assert.equal(renderEs.exitCode, 0);
      assert.ok(
        renderEs.stdout.includes("Monto Cobrado (USD)"),
        "Expected Spanish phrase translation in rendered HTML",
      );

      const renderJa = await runCli([
        "render",
        "--surface",
        surfacePath,
        "--locale",
        "ja",
      ]);
      assert.equal(renderJa.exitCode, 0);
      assert.ok(
        renderJa.stdout.includes("請求金額 (USD)"),
        "Expected Japanese phrase translation in rendered HTML",
      );

      // 4. Verify tampered surface with XSS payload exits non-zero
      const tampered = structuredClone(msgWithPhrase);
      const tamperedCompMsg = tampered.find((m) => "updateComponents" in m) as {
        updateComponents: { components: Record<string, unknown>[] };
      };
      tamperedCompMsg.updateComponents.components[1]!["label"] =
        "<script>alert(1)</script>";
      writeFileSync(tamperedPath, JSON.stringify({ messages: tampered }), "utf-8");

      const verifyFail = await runCli([
        "verify",
        "--surface",
        tamperedPath,
        "--catalog",
        "shadcn",
      ]);
      assert.equal(verifyFail.exitCode, 1);
      assert.ok(verifyFail.stdout.includes("Status: FAIL"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
