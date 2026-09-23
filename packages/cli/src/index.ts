import { readFileSync, writeFileSync } from "node:fs";
import {
  BASIC_CATALOG,
  Catalog,
  type ComponentSpecInit,
  type Mode,
  type Recording,
  ReplayClient,
  compileSurface,
  lintCatalog,
  swapSurfaceLocale,
} from "@orcawhisperer/lathe-core";
import { SHADCN_CATALOG, SHADCN_PHRASE_BANK } from "@orcawhisperer/lathe-shadcn";
import { verifySurface } from "@orcawhisperer/lathe-guard";
import { renderSurfaceToHtml } from "@orcawhisperer/lathe-react";
import { TypeSafeAdapter } from "@orcawhisperer/lathe-typesafe";
import { LatheMcpBridge, MCP_TOOL_PRESETS, type McpPresetId } from "@orcawhisperer/lathe-mcp";

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function parseFlags(args: readonly string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function resolveCatalog(spec: string | boolean | undefined): Catalog {
  if (!spec || spec === "shadcn" || spec === true) return SHADCN_CATALOG;
  if (spec === "basic") return BASIC_CATALOG;
  const raw = JSON.parse(readFileSync(String(spec), "utf-8")) as {
    catalogId: string;
    components: ComponentSpecInit[];
  };
  return new Catalog(raw.catalogId, raw.components);
}

function extractDataModel(messages: readonly Record<string, unknown>[]): Record<string, unknown> {
  for (const m of messages) {
    const udm = m["updateDataModel"] as Record<string, unknown> | undefined;
    if (udm && typeof udm["value"] === "object" && udm["value"] !== null) {
      return udm["value"] as Record<string, unknown>;
    }
  }
  return {};
}

const HELP_TEXT = `Lathe CLI v0.1.0 — Non-Generative A2UI v0.9 Compiler & Verifier

Usage:
  lathe <command> [flags]

Commands:
  lint      Static criteria linter for component catalogs
            Flags: [--catalog shadcn|basic|<file.json>] [--json]

  compile   Compile a JSON state (and optional JSON Schema) into an A2UI v0.9 surface
            Flags: --state <state.json> [--schema <schema.json>] [--catalog shadcn|basic]
                   [--mode staged|speculative] [--locale en|es|ja|de]
                   [--replay <recording.json>] [--out <surface.json>]

  verify    Run @lathe/guard 4-tier verification on an A2UI v0.9 surface JSON
            Flags: --surface <surface.json> [--catalog shadcn|basic] [--json]

  render    Render an A2UI v0.9 surface JSON to standalone HTML (with zero-call locale swap)
            Flags: --surface <surface.json> [--locale en|es|ja|de] [--out <page.html>]
`;

export async function runCli(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<CliResult> {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);

  if (!command || command === "help" || command === "--help" || flags["help"]) {
    return { exitCode: 0, stdout: HELP_TEXT, stderr: "" };
  }

  try {
    if (command === "lint") {
      const catalog = resolveCatalog(flags["catalog"]);
      const report = lintCatalog(catalog);
      const errorCount = report.findings.filter((f) => f.severity === "error").length;
      const warningCount = report.findings.filter((f) => f.severity === "warning").length;
      if (flags["json"]) {
        return {
          exitCode: report.ok ? 0 : 1,
          stdout: JSON.stringify({ ...report, errorCount, warningCount }, null, 2) + "\n",
          stderr: "",
        };
      }
      const lines: string[] = [
        `Lathe Catalog Linter — ${report.catalogId}`,
        `Status: ${report.ok ? "PASS" : "FAIL"} (${errorCount} errors, ${warningCount} warnings)`,
      ];
      for (const f of report.findings) {
        lines.push(`  [${f.severity.toUpperCase()}] ${f.code} (${f.component ?? "catalog"}): ${f.message}`);
      }
      return {
        exitCode: report.ok ? 0 : 1,
        stdout: lines.join("\n") + "\n",
        stderr: "",
      };
    }

    if (command === "compile") {
      const statePath = flags["state"];
      if (!statePath || typeof statePath !== "string") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Error: --state <file.json> is required for `lathe compile`.\n",
        };
      }
      const state = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
      const schema =
        typeof flags["schema"] === "string"
          ? (JSON.parse(readFileSync(flags["schema"], "utf-8")) as Record<string, unknown>)
          : undefined;
      const catalog = resolveCatalog(flags["catalog"]);
      const mode: Mode = flags["mode"] === "speculative" ? "speculative" : "staged";
      const locale = typeof flags["locale"] === "string" ? flags["locale"] : "en";
      const surfaceId = typeof flags["surface-id"] === "string" ? flags["surface-id"] : "main";

      let client;
      if (typeof flags["replay"] === "string") {
        const raw = JSON.parse(readFileSync(flags["replay"], "utf-8")) as Record<string, unknown>;
        const stagedObj = raw["staged"] as Record<string, unknown> | undefined;
        const recording = ("calls" in raw
          ? raw
          : "recording" in raw
            ? raw["recording"]
            : stagedObj?.["recording"]) as unknown as Recording;
        client = new ReplayClient(recording);
      } else {
        const apiKey = env["TYPESAFE_API_KEY"];
        if (!apiKey) {
          return {
            exitCode: 1,
            stdout: "",
            stderr:
              "Error: Set TYPESAFE_API_KEY in environment or pass --replay <recording.json>.\n",
          };
        }
        client = new TypeSafeAdapter({ apiKey });
      }

      const compiled = await compileSurface({
        state,
        catalog,
        client,
        surfaceId,
        mode,
        phraseBank: catalog === SHADCN_CATALOG ? SHADCN_PHRASE_BANK : undefined,
        schema,
      });

      const guard = await verifySurface({
        messages: compiled.messages,
        state,
        catalog,
        phraseBank: SHADCN_PHRASE_BANK,
      });
      const localizedMessages =
        locale !== "en"
          ? swapSurfaceLocale(guard.sanitizedMessages, SHADCN_PHRASE_BANK, locale)
          : guard.sanitizedMessages;

      const payload = {
        surfaceId,
        locale,
        stats: compiled.stats,
        guard: {
          ok: guard.ok,
          findings: guard.findings,
        },
        messages: localizedMessages,
      };
      const outJson = JSON.stringify(payload, null, 2);
      if (typeof flags["out"] === "string") {
        writeFileSync(flags["out"], outJson, "utf-8");
      }
      return { exitCode: 0, stdout: outJson + "\n", stderr: "" };
    }

    if (command === "verify") {
      const surfacePath = flags["surface"];
      if (!surfacePath || typeof surfacePath !== "string") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Error: --surface <surface.json> is required for `lathe verify`.\n",
        };
      }
      const raw = JSON.parse(readFileSync(surfacePath, "utf-8")) as
        | Record<string, unknown>[]
        | { messages: Record<string, unknown>[] };
      const messages = Array.isArray(raw) ? raw : raw.messages;
      const catalog = resolveCatalog(flags["catalog"]);
      const state = extractDataModel(messages);
      const report = await verifySurface({
        messages,
        state,
        catalog,
        phraseBank: SHADCN_PHRASE_BANK,
      });

      if (flags["json"]) {
        return {
          exitCode: report.ok ? 0 : 1,
          stdout: JSON.stringify(report, null, 2) + "\n",
          stderr: "",
        };
      }
      const lines = [
        `Lathe Guard Verification`,
        `Status: ${report.ok ? "PASS" : "FAIL"} (${report.findings.length} findings)`,
      ];
      for (const f of report.findings) {
        lines.push(`  [${f.tier}] (${f.componentId ?? "surface"}): ${f.message}`);
      }
      return {
        exitCode: report.ok ? 0 : 1,
        stdout: lines.join("\n") + "\n",
        stderr: "",
      };
    }

    if (command === "render") {
      const surfacePath = flags["surface"];
      if (!surfacePath || typeof surfacePath !== "string") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Error: --surface <surface.json> is required for `lathe render`.\n",
        };
      }
      const raw = JSON.parse(readFileSync(surfacePath, "utf-8")) as
        | Record<string, unknown>[]
        | { messages: Record<string, unknown>[] };
      const rawMessages = Array.isArray(raw) ? raw : raw.messages;
      const locale = typeof flags["locale"] === "string" ? flags["locale"] : "en";
      const messages =
        locale !== "en"
          ? swapSurfaceLocale(rawMessages, SHADCN_PHRASE_BANK, locale)
          : rawMessages;
      const state = extractDataModel(messages);
      const html = renderSurfaceToHtml({ messages, state });
      if (typeof flags["out"] === "string") {
        writeFileSync(flags["out"], html, "utf-8");
      }
      return { exitCode: 0, stdout: html + "\n", stderr: "" };
    }

    if (command === "mcp") {
      if (flags["list"] || !flags["preset"]) {
        const lines = ["Available @lathe/mcp Tool Presets:"];
        for (const [id, p] of Object.entries(MCP_TOOL_PRESETS)) {
          lines.push(`  - ${id}: ${p.title} (${p.readTool.name} -> ${p.actionTool.name})`);
        }
        return { exitCode: 0, stdout: lines.join("\n") + "\n", stderr: "" };
      }
      const presetId = String(flags["preset"]) as McpPresetId;
      const preset = MCP_TOOL_PRESETS[presetId];
      if (!preset) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Error: Unknown MCP preset "${presetId}". Use --list to view presets.\n`,
        };
      }
      const apiKey = env["TYPESAFE_API_KEY"];
      if (!apiKey) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Error: Set TYPESAFE_API_KEY in environment to compile MCP presets live.\n",
        };
      }
      const bridge = new LatheMcpBridge({
        client: new TypeSafeAdapter({ apiKey }),
      });
      const compiled = await bridge.compileToolResult({
        result: preset.result,
        readTool: preset.readTool,
        actionTool: preset.actionTool,
        intent: preset.intent,
        locale: typeof flags["locale"] === "string" ? flags["locale"] : "en",
      });
      const outJson = JSON.stringify(compiled, null, 2);
      if (typeof flags["out"] === "string") {
        writeFileSync(flags["out"], outJson, "utf-8");
      }
      return { exitCode: 0, stdout: outJson + "\n", stderr: "" };
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown command: ${command}\n\n${HELP_TEXT}`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    };
  }
}
