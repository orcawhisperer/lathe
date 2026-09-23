import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Answer,
  type Question,
  type SystemOneClient,
  type SystemOneResponse,
} from "@lathe/core";
import {
  LatheMcpBridge,
  MCP_TOOL_PRESETS,
  extractMcpToolState,
  mergeMcpSchemas,
} from "../src/index.ts";

class DeterministicMcpClient implements SystemOneClient {
  callCount = 0;

  async systemOne(
    _state: unknown,
    questions: Record<string, Question>,
  ): Promise<SystemOneResponse> {
    this.callCount++;
    const answers: Record<string, Answer> = {};
    for (const [qid, q] of Object.entries(questions)) {
      const instrText = JSON.stringify(q.instructions);
      if (q.type === "noul") {
        answers[qid] = {
          type: "noul",
          noul: 0.96,
        };
      } else if (q.type === "choice") {
        const opts = Object.keys(q.criteria);
        let chosen = opts[0]!;
        if (qid.startsWith("comp_")) {
          if (opts.includes("DataTable")) chosen = "DataTable";
          else if (opts.includes("Select") && instrText.includes("verdict")) chosen = "Select";
          else if (opts.includes("Textarea") && instrText.includes("review_comment")) chosen = "Textarea";
          else if (opts.includes("Progress") && instrText.includes("coverage_ratio")) chosen = "Progress";
          else if (opts.includes("Badge") && instrText.includes("ci_status")) chosen = "Badge";
          else if (opts.includes("Button") && instrText.includes("submit_review")) chosen = "Button";
          else if (opts.includes("Stat")) chosen = "Stat";
        } else if (qid.includes("_label") && opts.includes("pr.lines_changed")) {
          chosen = "pr.lines_changed";
        }
        const probs: Record<string, number> = {};
        for (const k of opts) probs[k] = k === chosen ? 0.95 : 0.05 / Math.max(1, opts.length - 1);
        answers[qid] = {
          type: "choice",
          choice: chosen,
          confidence: 0.95,
          probabilities: probs,
        };
      } else {
        answers[qid] = {
          type: "score",
          score: 0.5,
          legend: {},
          confidence: 0.9,
          probabilities: { sm: 0.05, md: 0.9, lg: 0.05 },
        };
      }
    }
    return {
      model: "test",
      latencyMs: 1,
      inputTokens: 10,
      outputTokens: 5,
      replayed: true,
      answers,
    };
  }
}

describe("@lathe/mcp Auto-UI Bridge & Presets", () => {
  it("extracts structured state from both structuredContent and JSON text content", () => {
    const fromStructured = extractMcpToolState(MCP_TOOL_PRESETS.github_pr_review.result);
    assert.equal((fromStructured["pr"] as Record<string, unknown>)["lines_changed"], 342);

    const fromText = extractMcpToolState({
      toolName: "postgres.query",
      content: [
        {
          type: "text",
          text: JSON.stringify([{ query_id: "Q1", mean_exec_ms: 412 }]),
        },
      ],
    });
    assert.ok(Array.isArray(fromText["rows"]));
  });

  it("merges readTool.outputSchema with actionTool.inputSchema under /resolution", () => {
    const preset = MCP_TOOL_PRESETS.k8s_pod_incident;
    const merged = mergeMcpSchemas(preset.readTool, preset.actionTool);
    const props = merged["properties"] as Record<string, unknown>;
    assert.ok("k8s" in props);
    assert.ok("resolution" in props);
  });

  it("compiles an MCP tool preset, hits 0ms shape cache on subsequent calls, and switches locales", async () => {
    const client = new DeterministicMcpClient();
    const bridge = new LatheMcpBridge({ client });
    const preset = MCP_TOOL_PRESETS.github_pr_review;

    const first = await bridge.compileToolResult({
      result: preset.result,
      readTool: preset.readTool,
      actionTool: preset.actionTool,
      intent: preset.intent,
      locale: "es",
    });

    assert.equal(first.cached, false);
    assert.equal(first.guardReport.ok, true);
    assert.ok(first.html.includes("lathe-datatable"), "Expected DataTable for changed_files");
    assert.ok(
      first.html.includes("Total de Líneas Modificadas"),
      "Expected Spanish phrase translation for pr.lines_changed",
    );
    const callsAfterFirst = client.callCount;
    assert.ok(callsAfterFirst > 0);

    // Second call with a 5-file PR array of identical schema shape -> 0 model calls!
    const secondState = structuredClone(preset.result.structuredContent)!;
    ((secondState["pr"] as Record<string, unknown>)["changed_files"] as unknown[]).push({
      file_path: "README.md",
      additions: 50,
      deletions: 2,
      status: "modified",
    });
    const second = await bridge.compileToolResult({
      result: {
        toolName: preset.result.toolName,
        structuredContent: secondState,
      },
      readTool: preset.readTool,
      actionTool: preset.actionTool,
      intent: preset.intent,
      locale: "ja",
    });

    assert.equal(second.cached, true);
    assert.equal(client.callCount, callsAfterFirst, "Expected 0 model calls on shape cache hit");
    assert.ok(
      second.html.includes("変更行数合計"),
      "Expected Japanese phrase translation on cached surface",
    );

    // 3. Closed-loop executeAction: validates /resolution against actionTool.inputSchema & re-renders in 0ms
    const actionRes = await bridge.executeAction({
      presetId: "github_pr_review",
      state: {
        ...secondState,
        resolution: {
          verdict: "approve_and_merge",
          auto_merge: true,
          review_comment: "All 4 guard tiers verified.",
        },
      },
    });
    assert.equal(actionRes.receipt.status, "executed");
    assert.equal(actionRes.receipt.actionToolName, "github.submit_review");
    assert.equal(actionRes.surface.cached, true, "Post-action re-render must hit 0ms shape cache");
    assert.equal(
      (actionRes.surface.state["pr"] as Record<string, unknown>)["ci_status"],
      "merged_to_main",
    );

    // 4. Rejects invalid enum value in /resolution via actionTool.inputSchema guard
    const invalidRes = await bridge.executeAction({
      presetId: "github_pr_review",
      state: {
        ...secondState,
        resolution: {
          verdict: "force_push_secret_bypass",
          auto_merge: true,
          review_comment: "",
        },
      },
    });
    assert.equal(invalidRes.receipt.status, "rejected");
    assert.equal(invalidRes.receipt.errors.length, 1);
  });
});
