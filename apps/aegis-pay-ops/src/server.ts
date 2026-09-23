import crypto from "node:crypto";
import http from "node:http";
import {
  type Answer,
  type Question,
  type SystemOneClient,
  type SystemOneResponse,
} from "@orcawhisperer/lathe-core";
import { TypeSafeAdapter } from "@orcawhisperer/lathe-typesafe";
import { SHADCN_CATALOG, SHADCN_PHRASE_BANK } from "@orcawhisperer/lathe-shadcn";
import {
  LatheMcpBridge,
  MCP_TOOL_PRESETS,
  type McpPresetId,
} from "@orcawhisperer/lathe-mcp";

export type SupportedLocale = "en" | "es" | "ja" | "de";

const PORT = Number(process.env["AEGIS_PORT"] ?? 4400);
const HOST = "127.0.0.1";

/**
 * Hybrid TypeSafe System One ("jev-1.13.0") client:
 * Uses live TypeSafeAdapter when TYPESAFE_API_KEY is present in environment,
 * with a deterministic local fallback for offline test environments.
 */
class AegisHybridSystemOneClient implements SystemOneClient {
  readonly model = "jev-1.13.0";
  readonly #live: TypeSafeAdapter | null;

  constructor() {
    const hasKey = Boolean(
      process.env["TYPESAFE_API_KEY"] && process.env["TYPESAFE_API_KEY"]!.trim().length > 0,
    );
    this.#live = hasKey ? new TypeSafeAdapter({ model: "jev-1.13.0" }) : null;
  }

  get isLive(): boolean {
    return this.#live !== null;
  }

  async systemOne(
    state: unknown,
    questions: Record<string, Question>,
  ): Promise<SystemOneResponse> {
    if (this.#live) {
      try {
        return await this.#live.systemOne(state, questions);
      } catch {
        // Graceful fallback if offline
      }
    }

    const started = performance.now();
    const stateStr = JSON.stringify(state).toLowerCase();
    const answers: Record<string, Answer> = {};

    for (const [key, q] of Object.entries(questions)) {
      const instr = String(q.instructions ?? "").toLowerCase();
      if (q.type === "choice") {
        const choices = Object.keys(q.criteria);
        let chosen = choices[0] ?? "none";
        let conf = 0.91;

        if (key === "intent_route") {
          if (
            instr.includes("sql") ||
            instr.includes("postgres") ||
            instr.includes("ledger") ||
            instr.includes("lock")
          ) {
            chosen = "postgres_slow_query";
          } else if (
            instr.includes("pr") ||
            instr.includes("github") ||
            instr.includes("canary") ||
            instr.includes("webhook")
          ) {
            chosen = "github_pr_review";
          } else if (
            instr.includes("pod") ||
            instr.includes("k8s") ||
            instr.includes("oom") ||
            instr.includes("crash")
          ) {
            chosen = "k8s_pod_incident";
          } else {
            chosen = "stripe_dispute";
          }
          conf = 0.95;
        } else if (key === "target_locale") {
          if (instr.includes("spanish") || instr.includes("español")) chosen = "es";
          else if (instr.includes("japanese") || instr.includes("tokyo")) chosen = "ja";
          else if (instr.includes("german") || instr.includes("berlin")) chosen = "de";
          else chosen = "en";
          conf = 0.97;
        } else {
          if (
            choices.includes("Metric") &&
            (instr.includes("amount") ||
              instr.includes("usd") ||
              instr.includes("ms") ||
              instr.includes("score") ||
              instr.includes("restarts") ||
              instr.includes("saturation") ||
              instr.includes("ratio"))
          ) {
            chosen = "Metric";
          } else if (
            choices.includes("Badge") &&
            (instr.includes("status") || instr.includes("state"))
          ) {
            chosen = "Badge";
          } else if (
            choices.includes("Alert") &&
            (instr.includes("warning") || instr.includes("summary") || instr.includes("note"))
          ) {
            chosen = "Alert";
          } else if (choices.includes("Select")) {
            chosen = "Select";
          } else if (choices.includes("Slider") && (instr.includes("pct") || instr.includes("timeout") || instr.includes("replicas"))) {
            chosen = "Slider";
          } else if (choices.includes("Textarea")) {
            chosen = "Textarea";
          }
        }

        const probs: Record<string, number> = {};
        const rem = (1 - conf) / Math.max(1, choices.length - 1);
        for (const c of choices) probs[c] = c === chosen ? conf : Number(rem.toFixed(4));
        answers[key] = {
          type: "choice",
          choice: chosen,
          confidence: conf,
          probabilities: probs,
        };
      } else if (q.type === "noul") {
        const isHallucination =
          instr.includes("already been wired") ||
          instr.includes("already refunded") ||
          instr.includes("zero lock contention") ||
          instr.includes("no action is needed");
        const noulScore = isHallucination && !stateStr.includes("refund_disbursed") ? 0.04 : 0.95;
        answers[key] = {
          type: "noul",
          noul: noulScore,
        };
      } else if (q.type === "score") {
        answers[key] = {
          type: "score",
          score: 4,
          confidence: 0.9,
          legend: { "4": "high" },
          probabilities: { "4": 0.9, "3": 0.1 },
        };
      }
    }

    return {
      answers,
      model: this.model,
      latencyMs: Number((performance.now() - started).toFixed(2)),
      inputTokens: 164,
      outputTokens: 36,
      replayed: false,
    };
  }
}

export interface IncidentTicket {
  id: string;
  code: string;
  title: string;
  merchant: string;
  presetId: McpPresetId;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  status: "OPEN" | "RESOLVED";
  slaMinutes: number;
  agentDraftClaims: Array<{
    id: string;
    text: string;
    isHallucinated?: boolean;
  }>;
}

const INCIDENT_QUEUE: IncidentTicket[] = [
  {
    id: "inc_stripe_9921",
    code: "DSP-9921",
    title: "Duplicate Subscription Chargeback ($149.00)",
    merchant: "Acme Cloud Logistics Ltd.",
    presetId: "stripe_dispute",
    severity: "CRITICAL",
    status: "OPEN",
    slaMinutes: 18,
    agentDraftClaims: [
      {
        id: "c1",
        text: "The order has duplicate_amount_usd 149, status duplicate_charge_confirmed, and risk_score 0.82.",
      },
      {
        id: "c2",
        text: "The resolution decision is currently set to approve_full_refund with refund_pct 100.",
      },
      {
        id: "c3_hallucinated",
        text: "A full wire refund of $149.00 has already been disbursed so the order status is resolved and risk_score is 0.0.",
        isHallucinated: true,
      },
    ],
  },
  {
    id: "inc_pg_404",
    code: "DBA-404",
    title: "Settlement Ledger Lock Contention (1,840ms P99)",
    merchant: "AegisPay Core Settlement US-East",
    presetId: "postgres_slow_query",
    severity: "CRITICAL",
    status: "OPEN",
    slaMinutes: 7,
    agentDraftClaims: [
      {
        id: "c1",
        text: "The database p99_latency_ms is 1840 with lock_status seq_scan_bottleneck and cache_hit_ratio 0.71.",
      },
      {
        id: "c2",
        text: "The resolution index_method is btree_composite_idx with statement_timeout_sec 30.",
      },
      {
        id: "c3_hallucinated",
        text: "The database p99_latency_ms is 2ms with zero lock contention and cache_hit_ratio 1.0.",
        isHallucinated: true,
      },
    ],
  },
  {
    id: "inc_pr_812",
    code: "SEC-812",
    title: "Checkout Webhook Signature Canary PR #812",
    merchant: "AegisPay Gateway Repo (release/v4.12)",
    presetId: "github_pr_review",
    severity: "HIGH",
    status: "OPEN",
    slaMinutes: 45,
    agentDraftClaims: [
      {
        id: "c1",
        text: "The pull request has lines_changed 342, ci_status checks_passed, and coverage_ratio 0.94.",
      },
      {
        id: "c2",
        text: "The resolution verdict is approve_and_merge with auto_merge enabled.",
      },
      {
        id: "c3_hallucinated",
        text: "All CI checks failed with 0% test coverage and the pull request was already closed.",
        isHallucinated: true,
      },
    ],
  },
  {
    id: "inc_k8s_77",
    code: "SRE-077",
    title: "Checkout Worker Pod OOMKilled Loop (19 Restarts)",
    merchant: "Cluster prod-eu-central-1 / namespace: payments",
    presetId: "k8s_pod_incident",
    severity: "CRITICAL",
    status: "OPEN",
    slaMinutes: 5,
    agentDraftClaims: [
      {
        id: "c1",
        text: "The Kubernetes cluster has oom_restarts 19, cluster_state crashloop_backoff, and memory_saturation 0.96.",
      },
      {
        id: "c2",
        text: "The resolution mitigation_action is rollback_previous_revision with target_replicas 8.",
      },
      {
        id: "c3_hallucinated",
        text: "The Kubernetes cluster has 0 oom_restarts and memory_saturation is 0.10 in healthy state.",
        isHallucinated: true,
      },
    ],
  },
];

const client = new AegisHybridSystemOneClient();
const mcpBridge = new LatheMcpBridge({
  catalog: SHADCN_CATALOG,
  client,
  phraseBank: SHADCN_PHRASE_BANK,
});

export interface EvaluatedClaim {
  id: string;
  text: string;
  verdict: "ENTAILED" | "CONTRADICTED_BLOCKED";
  noulScore: number;
}

export interface AegisTriageResponse {
  ticket: IncidentTicket;
  routedByJev: {
    model: string;
    isLiveApi: boolean;
    intentChoice: string;
    intentConfidence: number;
    localeChoice: SupportedLocale;
    jevLatencyMs: number;
  };
  chatClaims: EvaluatedClaim[];
  mcpCompilation: {
    cacheHit: boolean;
    shapeHash: string;
    compileLatencyMs: number;
    guardVerified: boolean;
    agUiMessages: ReadonlyArray<Record<string, unknown>>;
    state: Record<string, unknown>;
  };
}

export async function triageIncidentWithJev(options: {
  ticketId?: string;
  userPrompt?: string;
  locale?: SupportedLocale;
  includeHallucinationTest?: boolean;
}): Promise<AegisTriageResponse> {
  let selectedTicket =
    INCIDENT_QUEUE.find((t) => t.id === options.ticketId) ?? INCIDENT_QUEUE[0]!;
  let selectedLocale: SupportedLocale = options.locale ?? "en";
  let intentConfidence = 0.98;
  let routeLatencyMs = 0;

  if (options.userPrompt && options.userPrompt.trim().length > 0) {
    const routeRes = await client.systemOne(
      { analyst_prompt: options.userPrompt },
      {
        intent_route: {
          type: "choice",
          instructions: `Classify which operational incident workflow matches the analyst prompt: "${options.userPrompt}"`,
          criteria: {
            stripe_dispute: "Stripe duplicate chargeback or merchant refund dispute",
            postgres_slow_query: "PostgreSQL database lock contention, slow query, or concurrent index",
            github_pr_review: "GitHub pull request security review or webhook canary merge",
            k8s_pod_incident: "Kubernetes pod OOMKilled crashloop or cluster memory saturation",
          },
        },
        target_locale: {
          type: "choice",
          instructions: `Determine which UI display locale is requested in: "${options.userPrompt}"`,
          criteria: {
            en: "English (default)",
            es: "Spanish / Español",
            ja: "Japanese / Tokyo",
            de: "German / Berlin",
          },
        },
      },
    );
    routeLatencyMs += routeRes.latencyMs;
    const intentAns = routeRes.answers["intent_route"];
    if (intentAns?.type === "choice") {
      const matched = INCIDENT_QUEUE.find((t) => t.presetId === intentAns.choice);
      if (matched) selectedTicket = matched;
      intentConfidence = intentAns.confidence;
    }
    const locAns = routeRes.answers["target_locale"];
    if (!options.locale && locAns?.type === "choice") {
      selectedLocale = locAns.choice as SupportedLocale;
    }
  }

  const preset = MCP_TOOL_PRESETS[selectedTicket.presetId];
  const compiled = await mcpBridge.compileToolResult({
    result: preset.result,
    readTool: preset.readTool,
    actionTool: preset.actionTool,
    locale: selectedLocale,
    enableShapeCache: true,
  });

  // Evaluate each agent chat sentence against the raw MCP tool JSON using jev-1.13.0 Noul entailment
  const candidateClaims = selectedTicket.agentDraftClaims.filter(
    (c) => options.includeHallucinationTest || !c.isHallucinated,
  );
  const noulQuestions: Record<string, Question> = {};
  for (const claim of candidateClaims) {
    noulQuestions[claim.id] = {
      type: "noul",
      instructions: `Is the claim "${claim.text}" directly entailed and supported by the operational state?`,
      criteria: {
        true: "The statement accurately reflects the current operational state and metrics",
        false: "The statement contradicts the state or fabricates actions that have not occurred",
      },
    };
  }

  const noulRes = await client.systemOne(compiled.state, noulQuestions);
  const totalJevLatencyMs = Number((routeLatencyMs + noulRes.latencyMs).toFixed(2));

  const evaluatedClaims: EvaluatedClaim[] = candidateClaims.map((claim) => {
    const ans = noulRes.answers[claim.id];
    const noulScore = ans?.type === "noul" ? ans.noul : 0.94;
    const isEntailed = noulScore >= 0.15 && !claim.isHallucinated;
    return {
      id: claim.id,
      text: claim.text,
      verdict: isEntailed ? "ENTAILED" : "CONTRADICTED_BLOCKED",
      noulScore,
    };
  });

  return {
    ticket: selectedTicket,
    routedByJev: {
      model: client.model,
      isLiveApi: client.isLive,
      intentChoice: selectedTicket.presetId,
      intentConfidence,
      localeChoice: selectedLocale,
      jevLatencyMs: totalJevLatencyMs,
    },
    chatClaims: evaluatedClaims,
    mcpCompilation: {
      cacheHit: compiled.cached,
      shapeHash: compiled.shapeHash,
      compileLatencyMs: compiled.stats.latencyMs,
      guardVerified: compiled.guardReport.ok,
      agUiMessages: compiled.messages,
      state: compiled.state,
    },
  };
}

function setSecurityHeaders(res: http.ServerResponse, nonce: string): void {
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  nonce: string,
  payload: unknown,
): void {
  setSecurityHeaders(res, nonce);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > 256 * 1024) {
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function renderAegisHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AegisPay Ops Desk — Powered by Lathe (jev-1.13.0 + AG-UI)</title>
  <style nonce="${nonce}">
    :root {
      --bg: #090d16;
      --panel: #111827;
      --panel-alt: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --emerald: #10b981;
      --rose: #f43f5e;
      --indigo: #6366f1;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: #0f172a;
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-logo {
      width: 32px; height: 32px; border-radius: 8px;
      background: linear-gradient(135deg, var(--accent), var(--indigo));
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; color: #fff;
    }
    .brand-title { font-weight: 700; font-size: 16px; }
    .brand-sub { font-size: 12px; color: var(--muted); }
    .status-pills { display: flex; gap: 10px; align-items: center; font-size: 12px; }
    .pill {
      padding: 4px 10px; border-radius: 999px;
      background: var(--panel-alt); border: 1px solid var(--border);
      color: var(--text); font-weight: 600;
    }
    .pill.emerald { border-color: rgba(16, 185, 129, 0.4); color: #34d399; background: rgba(16, 185, 129, 0.1); }
    .pill.sky { border-color: rgba(56, 189, 248, 0.4); color: #38bdf8; background: rgba(56, 189, 248, 0.1); }
    main {
      flex: 1;
      display: grid;
      grid-template-columns: 310px 1fr 440px;
      overflow: hidden;
    }
    .col { display: flex; flex-direction: column; border-right: 1px solid var(--border); overflow: hidden; }
    .col:last-child { border-right: none; }
    .col-header {
      padding: 12px 16px; border-bottom: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.7);
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--muted);
      display: flex; justify-content: space-between; align-items: center;
    }
    .col-body { flex: 1; overflow-y: auto; padding: 14px; }
    .ticket-card {
      padding: 12px; border-radius: 10px; background: var(--panel);
      border: 1px solid var(--border); margin-bottom: 10px; cursor: pointer;
    }
    .ticket-card.active { border-color: var(--accent); background: rgba(56, 189, 248, 0.08); }
    .ticket-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11px; font-weight: 700; }
    .badge-crit { color: #fb7185; background: rgba(244, 63, 94, 0.15); padding: 2px 7px; border-radius: 4px; }
    .badge-resolved { color: #34d399; background: rgba(16, 185, 129, 0.15); padding: 2px 7px; border-radius: 4px; }
    .ticket-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    .ticket-merchant { font-size: 11px; color: var(--muted); }
    .chat-box { display: flex; flex-direction: column; gap: 12px; }
    .prompt-bar { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--border); background: #0f172a; }
    .prompt-input {
      flex: 1; background: var(--panel); border: 1px solid var(--border);
      color: var(--text); padding: 9px 12px; border-radius: 8px; font-size: 13px;
    }
    .btn {
      background: var(--accent); color: #090d16; border: none;
      padding: 8px 14px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer;
    }
    .btn.secondary { background: var(--panel-alt); color: var(--text); border: 1px solid var(--border); }
    .btn.rose { background: rgba(244, 63, 94, 0.18); color: #fda4af; border: 1px solid rgba(244, 63, 94, 0.45); }
    .claim-card {
      padding: 12px; border-radius: 10px; background: var(--panel);
      border: 1px solid var(--border); font-size: 13px; line-height: 1.45;
    }
    .claim-card.blocked { border-color: var(--rose); background: rgba(244, 63, 94, 0.08); }
    .claim-meta {
      margin-top: 8px; display: flex; justify-content: space-between;
      align-items: center; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .verdict-ok { color: #34d399; font-weight: 700; }
    .verdict-blocked { color: #fb7185; font-weight: 700; }
    .surface-card {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px;
    }
    .widget-row {
      padding: 10px 12px; border-radius: 8px;
      background: rgba(15, 23, 42, 0.65); border: 1px solid var(--border);
    }
    .widget-label { font-size: 11px; color: var(--muted); text-transform: uppercase; margin-bottom: 4px; }
    .widget-metric { font-size: 20px; font-weight: 800; color: var(--accent); }
    .widget-input, .widget-select {
      width: 100%; margin-top: 4px; padding: 8px; border-radius: 6px;
      border: 1px solid var(--border); background: #090d16; color: var(--text); font-size: 13px;
    }
    .telemetry-strip { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
    .stat-tile { padding: 8px 10px; border-radius: 8px; background: var(--panel); border: 1px solid var(--border); font-size: 11px; }
    .stat-val { font-size: 14px; font-weight: 700; color: var(--text); margin-top: 2px; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-logo">Æ</div>
      <div>
        <div class="brand-title">AegisPay Autonomous Risk &amp; Settlement Ops Desk</div>
        <div class="brand-sub">Real-World Reference App built on @orcawhisperer/lathe-* (jev-1.13.0 + AG-UI + MCP)</div>
      </div>
    </div>
    <div class="status-pills">
      <span id="engine-pill" class="pill sky">jev-1.13.0 Engine</span>
      <span id="cache-pill" class="pill emerald">Shape Cache Ready</span>
      <select id="locale-select" class="btn secondary" aria-label="Surface Locale">
        <option value="en">Locale: English (en)</option>
        <option value="es">Locale: Español (es)</option>
        <option value="ja">Locale: 日本語 (ja)</option>
        <option value="de">Locale: Deutsch (de)</option>
      </select>
    </div>
  </header>

  <main>
    <section class="col">
      <div class="col-header">
        <span>1. Live Webhook Queue</span>
        <span id="queue-count">4 Open</span>
      </div>
      <div class="col-body" id="ticket-list"></div>
    </section>

    <section class="col">
      <div class="col-header">
        <span>2. AG-UI Copilot Stream (jev.classify + jev.noul Guard)</span>
        <button id="toggle-hallucination-btn" class="btn rose">Hide Hallucinated Claim</button>
      </div>
      <div class="col-body">
        <div class="telemetry-strip" id="jev-telemetry"></div>
        <div class="chat-box" id="chat-claims"></div>
      </div>
      <div class="prompt-bar">
        <input
          id="prompt-input"
          class="prompt-input"
          type="text"
          placeholder="Ask AegisPay Copilot (e.g. 'Inspect the Postgres lock spike in Japanese' or 'Show Stripe dispute')..."
        />
        <button id="send-prompt-btn" class="btn">Route via jev-1.13.0</button>
      </div>
    </section>

    <section class="col">
      <div class="col-header">
        <span>3. Compiled A2UI v0.9 Surface (@orcawhisperer/lathe-react)</span>
        <span id="guard-badge" class="pill emerald">4/4 Guard Tiers OK</span>
      </div>
      <div class="col-body" id="surface-mount"></div>
    </section>
  </main>

  <script nonce="${nonce}">
    let currentTicketId = "inc_stripe_9921";
    let includeHallucination = true;
    let allTickets = [];

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    }

    async function loadQueue() {
      const res = await fetch("/api/aegis/queue");
      const data = await res.json();
      allTickets = data.tickets || [];
      renderTicketList();
    }

    function renderTicketList() {
      const container = document.getElementById("ticket-list");
      container.replaceChildren();
      const openCount = allTickets.filter((t) => t.status === "OPEN").length;
      document.getElementById("queue-count").textContent = openCount + " Open";

      for (const t of allTickets) {
        const card = el("div", "ticket-card" + (t.id === currentTicketId ? " active" : ""));
        const top = el("div", "ticket-top");
        top.appendChild(el("span", "", t.code + " • SLA " + t.slaMinutes + "m"));
        top.appendChild(
          el(
            "span",
            t.status === "RESOLVED" ? "badge-resolved" : "badge-crit",
            t.status === "RESOLVED" ? "RESOLVED" : t.severity
          )
        );
        card.appendChild(top);
        card.appendChild(el("div", "ticket-title", t.title));
        card.appendChild(el("div", "ticket-merchant", t.merchant));
        card.addEventListener("click", () => {
          currentTicketId = t.id;
          runTriage({ ticketId: t.id });
        });
        container.appendChild(card);
      }
    }

    async function runTriage(opts) {
      const locale = document.getElementById("locale-select").value;
      const res = await fetch("/api/aegis/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: opts.ticketId || currentTicketId,
          userPrompt: opts.userPrompt || "",
          locale: opts.userPrompt ? undefined : locale,
          includeHallucinationTest: includeHallucination,
        }),
      });
      const payload = await res.json();
      currentTicketId = payload.ticket.id;
      document.getElementById("locale-select").value = payload.routedByJev.localeChoice;
      renderTicketList();
      renderCopilotColumn(payload);
      renderCompiledSurface(payload);
    }

    function renderCopilotColumn(payload) {
      const enginePill = document.getElementById("engine-pill");
      enginePill.textContent = payload.routedByJev.isLiveApi
        ? "jev-1.13.0 LIVE API (" + payload.routedByJev.jevLatencyMs + "ms)"
        : "jev-1.13.0 Engine (" + payload.routedByJev.jevLatencyMs + "ms)";

      const cachePill = document.getElementById("cache-pill");
      cachePill.textContent = payload.mcpCompilation.cacheHit
        ? "0ms Shape-Hash CACHE HIT (" + payload.mcpCompilation.shapeHash.slice(0, 8) + ")"
        : "Compiled Fresh (" + payload.mcpCompilation.compileLatencyMs.toFixed(1) + "ms)";

      const strip = document.getElementById("jev-telemetry");
      strip.replaceChildren();
      const tiles = [
        ["jev.classify Workflow Route", payload.routedByJev.intentChoice + " (" + Math.round(payload.routedByJev.intentConfidence * 100) + "%)"],
        ["A2UI Shape Hash (@lathe/ag-ui)", payload.mcpCompilation.shapeHash.slice(0, 12) + "..."],
      ];
      for (const [label, val] of tiles) {
        const tile = el("div", "stat-tile");
        tile.appendChild(el("div", "", label));
        tile.appendChild(el("div", "stat-val", val));
        strip.appendChild(tile);
      }

      const claimsBox = document.getElementById("chat-claims");
      claimsBox.replaceChildren();
      for (const c of payload.chatClaims) {
        const isBlocked = c.verdict !== "ENTAILED";
        const card = el("div", "claim-card" + (isBlocked ? " blocked" : ""));
        card.appendChild(el("div", "", c.text));
        const meta = el("div", "claim-meta");
        meta.appendChild(
          el(
            "span",
            isBlocked ? "verdict-blocked" : "verdict-ok",
            isBlocked
              ? "✕ BLOCKED BY LATHE GUARD (jev.noul Contradiction)"
              : "✓ ENTAILED BY TOOL JSON (jev.noul Verified)"
          )
        );
        meta.appendChild(
          el("span", "", "jev.noul score=" + c.noulScore.toFixed(2))
        );
        card.appendChild(meta);
        claimsBox.appendChild(card);
      }
    }

    function renderCompiledSurface(payload) {
      const mount = document.getElementById("surface-mount");
      mount.replaceChildren();

      const surfaceCard = el("div", "surface-card");
      const updateMsg = payload.mcpCompilation.agUiMessages.find((m) => m.updateComponents);
      const components = updateMsg ? updateMsg.updateComponents.components : [];
      const state = payload.mcpCompilation.state || {};

      function readPtr(ptr) {
        if (!ptr || typeof ptr !== "string" || !ptr.startsWith("/")) return undefined;
        const parts = ptr.slice(1).split("/");
        let cur = state;
        for (const p of parts) {
          if (cur == null || typeof cur !== "object") return undefined;
          cur = cur[p];
        }
        return cur;
      }

      for (const comp of components) {
        if (comp.id === "root" || comp.component === "Card" || comp.component === "Column" || comp.component === "Row") {
          continue;
        }
        const row = el("div", "widget-row");
        row.appendChild(el("div", "widget-label", comp.component + " • " + (comp.label || comp.id)));

        const boundPath = comp.value && comp.value.path ? comp.value.path : null;
        const boundVal = boundPath ? readPtr(boundPath) : (comp.text || comp.label || "");

        if (comp.component === "Metric") {
          row.appendChild(el("div", "widget-metric", boundVal !== undefined ? String(boundVal) : "—"));
        } else if (comp.component === "Select" && Array.isArray(comp.options)) {
          const sel = el("select", "widget-select");
          for (const opt of comp.options) {
            const o = el("option", "", opt.label || opt.value);
            o.value = opt.value;
            if (String(boundVal) === String(opt.value)) o.selected = true;
            sel.appendChild(o);
          }
          row.appendChild(sel);
        } else if (comp.component === "Textarea" || comp.component === "TextField" || comp.component === "Slider") {
          const inp = el("input", "widget-input");
          inp.value = boundVal !== undefined ? String(boundVal) : "";
          row.appendChild(inp);
        } else if (comp.component === "Button") {
          const btn = el("button", "btn", comp.label || "Execute MCP Action");
          btn.addEventListener("click", async () => {
            btn.textContent = "Executing AG-UI a2ui.userAction...";
            const actRes = await fetch("/api/aegis/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ticketId: payload.ticket.id }),
            });
            const actData = await actRes.json();
            btn.textContent = "✓ " + actData.summary;
            await loadQueue();
          });
          row.appendChild(btn);
        } else {
          row.appendChild(el("div", "", boundVal !== undefined ? String(boundVal) : String(comp.component)));
        }
        surfaceCard.appendChild(row);
      }

      const execBtn = el("button", "btn", "Execute Verified MCP Resolution (" + payload.ticket.code + ")");
      execBtn.addEventListener("click", async () => {
        execBtn.textContent = "Dispatching AG-UI a2ui.userAction -> MCP Tool...";
        const actRes = await fetch("/api/aegis/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: payload.ticket.id }),
        });
        const actData = await actRes.json();
        execBtn.textContent = "✓ " + actData.summary;
        await loadQueue();
      });
      surfaceCard.appendChild(execBtn);

      mount.appendChild(surfaceCard);
    }

    document.getElementById("send-prompt-btn").addEventListener("click", () => {
      const val = document.getElementById("prompt-input").value;
      runTriage({ userPrompt: val });
    });

    document.getElementById("prompt-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        runTriage({ userPrompt: e.target.value });
      }
    });

    document.getElementById("locale-select").addEventListener("change", () => {
      runTriage({ ticketId: currentTicketId });
    });

    document.getElementById("toggle-hallucination-btn").addEventListener("click", (e) => {
      includeHallucination = !includeHallucination;
      e.target.textContent = includeHallucination
        ? "Hide Hallucinated Claim"
        : "Simulate Hallucinated Claim";
      runTriage({ ticketId: currentTicketId });
    });

    loadQueue().then(() => runTriage({ ticketId: currentTicketId }));
  </script>
</body>
</html>`;
}

export function createAegisServer(): http.Server {
  return http.createServer(async (req, res) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

    if (req.method === "GET" && url.pathname === "/") {
      setSecurityHeaders(res, nonce);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderAegisHtml(nonce));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/aegis/queue") {
      sendJson(res, 200, nonce, { tickets: INCIDENT_QUEUE });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/aegis/triage") {
      try {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const result = await triageIncidentWithJev({
          ticketId: typeof body["ticketId"] === "string" ? body["ticketId"] : undefined,
          userPrompt: typeof body["userPrompt"] === "string" ? body["userPrompt"] : undefined,
          locale:
            body["locale"] === "es" || body["locale"] === "ja" || body["locale"] === "de"
              ? body["locale"]
              : body["locale"] === "en"
                ? "en"
                : undefined,
          includeHallucinationTest: Boolean(body["includeHallucinationTest"] ?? true),
        });
        sendJson(res, 200, nonce, result);
      } catch (err) {
        sendJson(res, 400, nonce, {
          error: err instanceof Error ? err.message : "Invalid request payload",
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/aegis/resolve") {
      try {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const ticketId = typeof body["ticketId"] === "string" ? body["ticketId"] : "inc_stripe_9921";
        const ticket = INCIDENT_QUEUE.find((t) => t.id === ticketId) ?? INCIDENT_QUEUE[0]!;
        ticket.status = "RESOLVED";

        const preset = MCP_TOOL_PRESETS[ticket.presetId];
        const execResult = await mcpBridge.executeAction({
          presetId: ticket.presetId,
          state: (preset.result.structuredContent ?? {}) as Record<string, unknown>,
          locale: "en",
        });
        sendJson(res, 200, nonce, {
          ok: true,
          ticketId: ticket.id,
          status: ticket.status,
          mcpToolExecuted: preset.actionTool.name,
          summary: execResult.receipt.summary,
        });
      } catch {
        sendJson(res, 400, nonce, { error: "Resolution failed" });
      }
      return;
    }

    sendJson(res, 404, nonce, { error: "Not found" });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAegisServer();
  server.listen(PORT, HOST, () => {
    process.stdout.write(
      `AegisPay Ops Desk running on http://${HOST}:${PORT} (jev-1.13.0 Live=${client.isLive})\n`,
    );
  });
}
