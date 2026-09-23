import {
  type Catalog,
  type ComponentCalibration,
  type CompileStats,
  type Mode,
  type PhraseBank,
  type SystemOneClient,
  swapSurfaceLocale,
} from "@orcawhisperer/lathe-core";
import { SHADCN_CATALOG, SHADCN_PHRASE_BANK } from "@orcawhisperer/lathe-shadcn";
import { type GuardReport } from "@orcawhisperer/lathe-guard";
import { type AgUiEvent, LatheAgUiMiddleware } from "@orcawhisperer/lathe-ag-ui";
import { renderSurfaceToHtml } from "@orcawhisperer/lathe-react";

export interface McpToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}

export interface McpContentItem {
  readonly type: "text" | "image" | "resource";
  readonly text?: string;
}

export interface McpCallToolResult {
  readonly toolName: string;
  readonly structuredContent?: Record<string, unknown>;
  readonly content?: readonly McpContentItem[];
  readonly isError?: boolean;
}

export interface CompileMcpToolOptions {
  readonly result: McpCallToolResult;
  readonly readTool?: McpToolDefinition;
  readonly actionTool?: McpToolDefinition;
  readonly intent?: string;
  readonly locale?: string;
  readonly enableShapeCache?: boolean;
  readonly mode?: Mode;
}

export interface CompiledMcpSurface {
  readonly surfaceId: string;
  readonly toolName: string;
  readonly shapeHash: string;
  readonly cached: boolean;
  readonly locale: string;
  readonly state: Record<string, unknown>;
  readonly schema: Record<string, unknown>;
  readonly messages: ReadonlyArray<Record<string, unknown>>;
  readonly agUiEvents: ReadonlyArray<AgUiEvent>;
  readonly guardReport: GuardReport;
  readonly stats: CompileStats;
  readonly calibration: Readonly<Record<string, ComponentCalibration>>;
  readonly html: string;
}

/**
 * Extract structured JSON state from an MCP `CallToolResult` (`structuredContent` or JSON `content[0].text`).
 */
export function extractMcpToolState(result: McpCallToolResult): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return structuredClone(result.structuredContent);
  }
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === "text" && typeof item.text === "string") {
        const trimmed = item.text.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed)) {
            return { rows: parsed };
          }
          if (typeof parsed === "object" && parsed !== null) {
            return parsed as Record<string, unknown>;
          }
        }
      }
    }
  }
  return {};
}

/**
 * Merge a read tool's `outputSchema` with an optional follow-up `actionTool.inputSchema`
 * so the compiled UI surface displays both read-only tool data and interactive action form controls.
 */
export function mergeMcpSchemas(
  readTool?: McpToolDefinition,
  actionTool?: McpToolDefinition,
): Record<string, unknown> {
  const baseProps: Record<string, unknown> = {};
  const outProps = readTool?.outputSchema?.["properties"];
  if (typeof outProps === "object" && outProps !== null) {
    Object.assign(baseProps, outProps);
  }
  const inProps = actionTool?.inputSchema?.["properties"];
  if (typeof inProps === "object" && inProps !== null) {
    baseProps["resolution"] = {
      type: "object",
      properties: inProps,
    };
  }
  return {
    type: "object",
    properties: baseProps,
  };
}

export interface ActionValidationError {
  readonly field: string;
  readonly message: string;
}

export interface ActionValidationResult {
  readonly ok: boolean;
  readonly errors: readonly ActionValidationError[];
  readonly payload: Record<string, unknown>;
}

export interface McpActionReceipt {
  readonly actionToolName: string;
  readonly status: "executed" | "rejected";
  readonly summary: string;
  readonly validatedPayload: Record<string, unknown>;
  readonly errors: readonly ActionValidationError[];
}

export interface ExecuteMcpActionResult {
  readonly receipt: McpActionReceipt;
  readonly surface: CompiledMcpSurface;
}

/**
 * Validate `/resolution` form inputs against `actionTool.inputSchema` before executing an MCP action tool.
 */
export function validateActionPayload(
  actionTool: McpToolDefinition | undefined,
  resolutionState: unknown,
): ActionValidationResult {
  const payload: Record<string, unknown> =
    typeof resolutionState === "object" && resolutionState !== null
      ? { ...(resolutionState as Record<string, unknown>) }
      : {};
  const errors: ActionValidationError[] = [];
  const props = actionTool?.inputSchema?.["properties"];
  if (typeof props !== "object" || props === null) {
    return { ok: true, errors, payload };
  }

  for (const [key, rawDef] of Object.entries(props as Record<string, unknown>)) {
    if (typeof rawDef !== "object" || rawDef === null) continue;
    const def = rawDef as Record<string, unknown>;
    const val = payload[key];

    if (Array.isArray(def["enum"])) {
      const allowed = (def["enum"] as unknown[]).map((v) => String(v));
      if (val !== undefined && !allowed.includes(String(val))) {
        errors.push({
          field: key,
          message: `Value "${String(val)}" is not in allowed enum [${allowed.join(", ")}]`,
        });
      }
    }
    if (typeof def["minimum"] === "number" && typeof val === "number" && val < def["minimum"]) {
      errors.push({
        field: key,
        message: `Value ${val} is below minimum ${def["minimum"]}`,
      });
    }
    if (typeof def["maximum"] === "number" && typeof val === "number" && val > def["maximum"]) {
      errors.push({
        field: key,
        message: `Value ${val} exceeds maximum ${def["maximum"]}`,
      });
    }
  }

  return { ok: errors.length === 0, errors, payload };
}

function applyPresetActionTransition(
  preset: McpToolPreset,
  currentState: Record<string, unknown>,
  validatedPayload: Record<string, unknown>,
): { nextState: Record<string, unknown>; summary: string } {
  const next = structuredClone(currentState);
  next["resolution"] = validatedPayload;

  if (preset.id === "stripe_dispute") {
    const decision = String(validatedPayload["decision"] ?? "approve_full_refund");
    const pct = Number(validatedPayload["refund_pct"] ?? 100);
    const memo = String(validatedPayload["memo"] ?? "").trim() || "Verified by supervisor";
    const order = (next["order"] ?? {}) as Record<string, unknown>;
    const amount = Number(order["duplicate_amount_usd"] ?? 149);
    const refundedUsd = Number(((amount * pct) / 100).toFixed(2));
    order["duplicate_amount_usd"] = refundedUsd;
    order["status"] =
      decision === "escalate_fraud_review" ? "escalated_fraud_hold" : "refund_disbursed";
    order["risk_score"] = 0.04;
    next["order"] = order;
    const summary = `Executed stripe.resolve_dispute: ${decision} (${pct}% = $${refundedUsd} USD). Memo: ${memo}`;
    next["compliance"] = { warning_message: summary };
    return { nextState: next, summary };
  }

  if (preset.id === "github_pr_review") {
    const verdict = String(validatedPayload["verdict"] ?? "approve_and_merge");
    const autoMerge = Boolean(validatedPayload["auto_merge"]);
    const comment = String(validatedPayload["review_comment"] ?? "").trim() || "LGTM — verified";
    const pr = (next["pr"] ?? {}) as Record<string, unknown>;
    pr["ci_status"] =
      verdict === "approve_and_merge" && autoMerge ? "merged_to_main" : `review_${verdict}`;
    pr["coverage_ratio"] = 0.98;
    next["pr"] = pr;
    const summary = `Executed github.submit_review: verdict=${verdict}, auto_merge=${autoMerge}. Note: ${comment}`;
    next["advisory"] = { security_note: summary };
    return { nextState: next, summary };
  }

  if (preset.id === "postgres_slow_query") {
    const method = String(validatedPayload["index_method"] ?? "btree_composite_idx");
    const timeout = Number(validatedPayload["statement_timeout_sec"] ?? 30);
    const note = String(validatedPayload["migration_note"] ?? "").trim() || "Online DDL complete";
    const db = (next["db"] ?? {}) as Record<string, unknown>;
    db["p99_latency_ms"] = 14;
    db["lock_status"] = "index_active_healthy";
    db["cache_hit_ratio"] = 0.99;
    if (Array.isArray(db["slow_queries"])) {
      db["slow_queries"] = (db["slow_queries"] as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        mean_exec_ms: Math.max(2, Math.round(Number(row["mean_exec_ms"] ?? 100) / 50)),
        scan_type: `Index Scan (${method})`,
      }));
    }
    next["db"] = db;
    const summary = `Executed postgres.create_concurrent_index: method=${method}, timeout=${timeout}s. P99 dropped to 14ms (${note}).`;
    next["dba_notice"] = { warning: summary };
    return { nextState: next, summary };
  }

  // k8s_pod_incident
  const action = String(validatedPayload["mitigation_action"] ?? "rollback_previous_revision");
  const replicas = Number(validatedPayload["target_replicas"] ?? 8);
  const note = String(validatedPayload["incident_note"] ?? "").trim() || "Cluster stabilized";
  const k8s = (next["k8s"] ?? {}) as Record<string, unknown>;
  k8s["oom_restarts"] = 0;
  k8s["cluster_state"] = "healthy_running";
  k8s["memory_saturation"] = 0.42;
  if (Array.isArray(k8s["pods"])) {
    k8s["pods"] = (k8s["pods"] as Array<Record<string, unknown>>).map((pod) => ({
      ...pod,
      restarts: 0,
      rss_mb: 380,
      phase: `Running (${replicas} replicas)`,
    }));
  }
  next["k8s"] = k8s;
  const summary = `Executed kubernetes.execute_mitigation: action=${action}, replicas=${replicas}. Memory saturation at 42% (${note}).`;
  next["alert"] = { summary };
  return { nextState: next, summary };
}

export class LatheMcpBridge {
  readonly #middleware: LatheAgUiMiddleware;
  readonly #phraseBank: PhraseBank;

  constructor(options: {
    readonly client: SystemOneClient;
    readonly catalog?: Catalog;
    readonly phraseBank?: PhraseBank;
  }) {
    this.#phraseBank = options.phraseBank ?? SHADCN_PHRASE_BANK;
    this.#middleware = new LatheAgUiMiddleware({
      client: options.client,
      catalog: options.catalog ?? SHADCN_CATALOG,
      phraseBank: this.#phraseBank,
    });
  }

  get cacheSize(): number {
    return this.#middleware.cacheSize;
  }

  async compileToolResult(options: CompileMcpToolOptions): Promise<CompiledMcpSurface> {
    const state = extractMcpToolState(options.result);
    const schema = mergeMcpSchemas(options.readTool, options.actionTool);
    const surfaceId = `mcp-${options.result.toolName.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const locale = options.locale ?? "en";

    const bundle = await this.#middleware.compile({
      surfaceId,
      state,
      schema,
      intent:
        options.intent ??
        `Inspect the ${options.result.toolName} MCP tool output and complete any required resolution or action controls.`,
      enableShapeCache: options.enableShapeCache ?? true,
      groupBlocks: true,
      mode: options.mode ?? "staged",
    });

    const messages =
      locale !== "en"
        ? swapSurfaceLocale(bundle.guardReport.sanitizedMessages, this.#phraseBank, locale)
        : bundle.guardReport.sanitizedMessages;

    const html = renderSurfaceToHtml({
      messages,
      state,
      calibration: bundle.compileResult.calibration,
    });

    return {
      surfaceId,
      toolName: options.result.toolName,
      shapeHash: bundle.shapeHash,
      cached: bundle.cached,
      locale,
      state,
      schema,
      messages,
      agUiEvents: bundle.events,
      guardReport: bundle.guardReport,
      stats: bundle.compileResult.stats,
      calibration: bundle.compileResult.calibration,
      html,
    };
  }

  /**
   * Execute an interactive A2UI `<Button>` action against the preset's follow-up MCP `actionTool`,
   * validate `/resolution` form inputs against `actionTool.inputSchema`, apply the state transition,
   * and re-render via the 0ms normalized shape cache.
   */
  async executeAction(options: {
    readonly presetId: McpPresetId;
    readonly state: Record<string, unknown>;
    readonly locale?: string;
  }): Promise<ExecuteMcpActionResult> {
    const preset = MCP_TOOL_PRESETS[options.presetId] ?? MCP_TOOL_PRESETS.stripe_dispute;
    const validation = validateActionPayload(preset.actionTool, options.state["resolution"]);

    if (!validation.ok) {
      const errSummary = `Action rejected by ${preset.actionTool.name} schema guard: ${validation.errors.map((e) => `${e.field} (${e.message})`).join("; ")}`;
      const surface = await this.compileToolResult({
        result: {
          toolName: preset.result.toolName,
          structuredContent: options.state,
        },
        readTool: preset.readTool,
        actionTool: preset.actionTool,
        intent: preset.intent,
        locale: options.locale ?? "en",
        enableShapeCache: true,
      });
      return {
        receipt: {
          actionToolName: preset.actionTool.name,
          status: "rejected",
          summary: errSummary,
          validatedPayload: validation.payload,
          errors: validation.errors,
        },
        surface,
      };
    }

    const { nextState, summary } = applyPresetActionTransition(
      preset,
      options.state,
      validation.payload,
    );

    const surface = await this.compileToolResult({
      result: {
        toolName: preset.result.toolName,
        structuredContent: nextState,
      },
      readTool: preset.readTool,
      actionTool: preset.actionTool,
      intent: preset.intent,
      locale: options.locale ?? "en",
      enableShapeCache: true,
    });

    return {
      receipt: {
        actionToolName: preset.actionTool.name,
        status: "executed",
        summary,
        validatedPayload: validation.payload,
        errors: [],
      },
      surface,
    };
  }
}

export type McpPresetId =
  | "stripe_dispute"
  | "github_pr_review"
  | "postgres_slow_query"
  | "k8s_pod_incident";

export interface McpToolPreset {
  readonly id: McpPresetId;
  readonly title: string;
  readonly badge: string;
  readonly intent: string;
  readonly readTool: McpToolDefinition;
  readonly actionTool: McpToolDefinition;
  readonly result: McpCallToolResult;
}

export const MCP_TOOL_PRESETS: Readonly<Record<McpPresetId, McpToolPreset>> = {
  stripe_dispute: {
    id: "stripe_dispute",
    title: "Stripe Chargeback & Dispute Triage",
    badge: "stripe.get_dispute",
    intent:
      "Triage the disputed Stripe charge, review line items and compliance warnings, fill out the resolution decision, refund split slider, and reviewer memo, and approve the refund.",
    readTool: {
      name: "stripe.get_dispute",
      description: "Fetch Stripe dispute charge details, fraud telemetry, and line items.",
      outputSchema: {
        type: "object",
        properties: {
          order: {
            type: "object",
            properties: {
              duplicate_amount_usd: { type: "number", title: "Charged Amount (USD)" },
              status: { type: "string", title: "Fulfillment Status" },
              risk_score: { type: "number", title: "Fraud Risk Index" },
              line_items: {
                type: "array",
                title: "Order Line Items",
                items: {
                  type: "object",
                  properties: {
                    sku: { type: "string", title: "SKU" },
                    qty: { type: "number", title: "Quantity" },
                    unit_price_usd: { type: "number", title: "Unit Price (USD)" },
                  },
                },
              },
            },
          },
          compliance: {
            type: "object",
            properties: {
              warning_message: { type: "string", title: "Policy Advisory" },
            },
          },
          actions: {
            type: "object",
            properties: {
              approve_refund: { type: "boolean", title: "Issue Immediate Refund" },
              submit_review: { type: "boolean", title: "Submit Pull Request Review" },
              apply_index: { type: "boolean", title: "Create Concurrent Index" },
              execute_mitigation: { type: "boolean", title: "Execute Cluster Mitigation" },
            },
          },
        },
      },
    },
    actionTool: {
      name: "stripe.resolve_dispute",
      description: "Submit a dispute resolution decision and refund split.",
      inputSchema: {
        type: "object",
        properties: {
          decision: {
            type: "string",
            title: "Resolution Decision",
            enum: ["approve_full_refund", "approve_partial_credit", "escalate_fraud_review"],
          },
          refund_pct: {
            type: "number",
            title: "Refund Split Percentage",
            minimum: 0,
            maximum: 100,
          },
          memo: {
            type: "string",
            title: "Reviewer Resolution Memo",
            multiline: true,
            maxLength: 500,
          },
        },
      },
    },
    result: {
      toolName: "stripe.get_dispute",
      structuredContent: {
        order: {
          duplicate_amount_usd: 149.0,
          status: "duplicate_charge_confirmed",
          risk_score: 0.82,
          line_items: [
            { sku: "PRO-ANNUAL-SEAT", qty: 2, unit_price_usd: 69.5 },
            { sku: "PRIORITY-SLA-ADDON", qty: 1, unit_price_usd: 10.0 },
          ],
        },
        compliance: {
          warning_message:
            "Refunds above $100 require supervisor verification and trigger an immutable ledger audit entry.",
        },
        resolution: {
          decision: "approve_full_refund",
          refund_pct: 100,
          memo: "",
        },
        actions: {
          approve_refund: true,
        },
      },
    },
  },

  github_pr_review: {
    id: "github_pr_review",
    title: "GitHub Pull Request Security & Diff Review",
    badge: "github.get_pull_request",
    intent:
      "Review the GitHub Pull Request metrics, CI status, diff coverage, changed files table, and security advisory, then select a review verdict, write a review summary, and submit.",
    readTool: {
      name: "github.get_pull_request",
      description: "Inspect GitHub Pull Request diff metrics, CI status, and modified files.",
      outputSchema: {
        type: "object",
        properties: {
          pr: {
            type: "object",
            properties: {
              lines_changed: { type: "number", title: "Total Lines Changed" },
              ci_status: { type: "string", title: "CI Pipeline Status" },
              coverage_ratio: { type: "number", title: "Diff Test Coverage" },
              changed_files: {
                type: "array",
                title: "Changed Files in Pull Request",
                items: {
                  type: "object",
                  properties: {
                    file_path: { type: "string", title: "File Path" },
                    additions: { type: "number", title: "Additions" },
                    deletions: { type: "number", title: "Deletions" },
                    status: { type: "string", title: "Status" },
                  },
                },
              },
            },
          },
          advisory: {
            type: "object",
            properties: {
              security_note: { type: "string", title: "Policy Advisory" },
            },
          },
          actions: {
            type: "object",
            properties: {
              submit_review: { type: "string", title: "Submit Pull Request Review" },
            },
          },
        },
      },
    },
    actionTool: {
      name: "github.submit_review",
      description: "Submit a formal review verdict and comment on the Pull Request.",
      inputSchema: {
        type: "object",
        properties: {
          verdict: {
            type: "string",
            title: "Resolution Decision",
            enum: ["approve_and_merge", "request_changes", "comment_only"],
          },
          auto_merge: {
            type: "boolean",
            title: "Automatic Refund Approval",
          },
          review_comment: {
            type: "string",
            title: "Reviewer Resolution Memo",
            multiline: true,
            maxLength: 600,
          },
        },
      },
    },
    result: {
      toolName: "github.get_pull_request",
      structuredContent: {
        pr: {
          lines_changed: 342,
          ci_status: "checks_passed",
          coverage_ratio: 0.94,
          changed_files: [
            { file_path: "packages/core/src/compiler.ts", additions: 218, deletions: 14, status: "modified" },
            { file_path: "packages/guard/src/index.ts", additions: 96, deletions: 8, status: "modified" },
            { file_path: "SPEC.md", additions: 89, deletions: 0, status: "added" },
          ],
        },
        advisory: {
          security_note:
            "This PR modifies core compiler pointer bindings; ensure all 4 @lathe/guard verification tiers pass before enabling auto-merge.",
        },
        resolution: {
          verdict: "approve_and_merge",
          auto_merge: true,
          review_comment: "",
        },
        actions: {
          submit_review: true,
        },
      },
    },
  },

  postgres_slow_query: {
    id: "postgres_slow_query",
    title: "Postgres Slow Query & Index Advisor",
    badge: "postgres.inspect_slow_queries",
    intent:
      "Analyze P99 query latency, buffer cache hit ratio, and top slow query digests, then pick an indexing strategy, set the statement timeout slider, and create the concurrent index.",
    readTool: {
      name: "postgres.inspect_slow_queries",
      description: "Fetch pg_stat_statements slow query telemetry and buffer hit ratios.",
      outputSchema: {
        type: "object",
        properties: {
          db: {
            type: "object",
            properties: {
              p99_latency_ms: { type: "number", title: "P99 Query Latency (ms)" },
              lock_status: { type: "string", title: "Fulfillment Status" },
              cache_hit_ratio: { type: "number", title: "Shared Buffer Cache Hit Ratio" },
              slow_queries: {
                type: "array",
                title: "Top Slow Query Digests",
                items: {
                  type: "object",
                  properties: {
                    query_id: { type: "string", title: "Query ID" },
                    mean_exec_ms: { type: "number", title: "Mean Exec (ms)" },
                    calls_per_min: { type: "number", title: "Calls / Min" },
                    scan_type: { type: "string", title: "Scan Type" },
                  },
                },
              },
            },
          },
          dba_notice: {
            type: "object",
            properties: {
              warning: { type: "string", title: "Policy Advisory" },
            },
          },
          actions: {
            type: "object",
            properties: {
              apply_index: { type: "boolean", title: "Create Concurrent Index" },
            },
          },
        },
      },
    },
    actionTool: {
      name: "postgres.create_concurrent_index",
      description: "Create a non-blocking concurrent index and update statement timeout.",
      inputSchema: {
        type: "object",
        properties: {
          index_method: {
            type: "string",
            title: "Resolution Decision",
            enum: ["btree_composite_idx", "gin_jsonb_path_ops", "brin_timestamp_idx"],
          },
          statement_timeout_sec: {
            type: "number",
            title: "Refund Split Percentage",
            minimum: 5,
            maximum: 120,
          },
          migration_note: {
            type: "string",
            title: "Reviewer Resolution Memo",
            multiline: true,
            maxLength: 400,
          },
        },
      },
    },
    result: {
      toolName: "postgres.inspect_slow_queries",
      structuredContent: {
        db: {
          p99_latency_ms: 1840,
          lock_status: "seq_scan_bottleneck",
          cache_hit_ratio: 0.71,
          slow_queries: [
            { query_id: "Q-9012-ORDERS", mean_exec_ms: 1420, calls_per_min: 310, scan_type: "Seq Scan" },
            { query_id: "Q-4410-LEDGER", mean_exec_ms: 680, calls_per_min: 145, scan_type: "Bitmap Heap" },
          ],
        },
        dba_notice: {
          warning:
            "Sequential scan on `orders(customer_id, created_at)` is saturating IOPS; always use CREATE INDEX CONCURRENTLY in production.",
        },
        resolution: {
          index_method: "btree_composite_idx",
          statement_timeout_sec: 30,
          migration_note: "",
        },
        actions: {
          apply_index: true,
        },
      },
    },
  },

  k8s_pod_incident: {
    id: "k8s_pod_incident",
    title: "Kubernetes OOMKilled Pod Incident Triage",
    badge: "kubernetes.get_namespace_incident",
    intent:
      "Triage the Kubernetes namespace OOMKilled incident, inspect container restarts, memory saturation, and affected pods, choose a mitigation strategy and replica scale target, and execute mitigation.",
    readTool: {
      name: "kubernetes.get_namespace_incident",
      description: "Inspect Kubernetes namespace pod health, OOM restarts, and memory pressure.",
      outputSchema: {
        type: "object",
        properties: {
          k8s: {
            type: "object",
            properties: {
              oom_restarts: { type: "number", title: "Container OOM Restarts (1h)" },
              cluster_state: { type: "string", title: "Fulfillment Status" },
              memory_saturation: { type: "number", title: "Node Memory Saturation" },
              pods: {
                type: "array",
                title: "Affected Namespace Pods",
                items: {
                  type: "object",
                  properties: {
                    pod_name: { type: "string", title: "Pod Name" },
                    restarts: { type: "number", title: "Restarts" },
                    rss_mb: { type: "number", title: "RSS (MB)" },
                    phase: { type: "string", title: "Phase" },
                  },
                },
              },
            },
          },
          alert: {
            type: "object",
            properties: {
              summary: { type: "string", title: "Policy Advisory" },
            },
          },
          actions: {
            type: "object",
            properties: {
              execute_mitigation: { type: "boolean", title: "Execute Cluster Mitigation" },
            },
          },
        },
      },
    },
    actionTool: {
      name: "kubernetes.execute_mitigation",
      description: "Rollback or scale the affected Deployment and record an incident note.",
      inputSchema: {
        type: "object",
        properties: {
          mitigation_action: {
            type: "string",
            title: "Resolution Decision",
            enum: ["rollback_previous_revision", "bump_memory_limit_2gi", "drain_and_cordon_node"],
          },
          target_replicas: {
            type: "number",
            title: "Refund Split Percentage",
            minimum: 1,
            maximum: 32,
          },
          incident_note: {
            type: "string",
            title: "Reviewer Resolution Memo",
            multiline: true,
            maxLength: 500,
          },
        },
      },
    },
    result: {
      toolName: "kubernetes.get_namespace_incident",
      structuredContent: {
        k8s: {
          oom_restarts: 19,
          cluster_state: "crashloop_backoff",
          memory_saturation: 0.96,
          pods: [
            { pod_name: "checkout-worker-7c9d8-x2k9p", restarts: 11, rss_mb: 1022, phase: "CrashLoopBackOff" },
            { pod_name: "checkout-worker-7c9d8-m4v1q", restarts: 8, rss_mb: 1018, phase: "OOMKilled" },
          ],
        },
        alert: {
          summary:
            "Deployment `checkout-worker` exceeded its 1Gi cgroup memory limit after revision v2.14.3 rollout 18 minutes ago.",
        },
        resolution: {
          mitigation_action: "rollback_previous_revision",
          target_replicas: 8,
          incident_note: "",
        },
        actions: {
          execute_mitigation: true,
        },
      },
    },
  },
};
