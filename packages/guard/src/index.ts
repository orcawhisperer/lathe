import {
  type Catalog,
  type PhraseBank,
  type SystemOneClient,
  type Question,
  canonicalString,
  humanizePointer,
  noul,
  resolve,
  walk,
} from "@orcawhisperer/lathe-core";

export type GuardTier = "tier1_schema" | "tier1_5_trace" | "tier2_entailment" | "tier4_sink";
export type GuardSeverity = "error" | "warning";

export interface GuardFinding {
  readonly tier: GuardTier;
  readonly severity: GuardSeverity;
  readonly code:
    | "unknown_component"
    | "missing_root"
    | "dangling_child"
    | "invalid_enum_option"
    | "broken_pointer"
    | "untraced_literal"
    | "unentailed_claim"
    | "unsafe_url_scheme"
    | "unsafe_html_sink"
    | "unsafe_style_sink"
    | "unsafe_event_sink";
  readonly componentId: string;
  readonly prop?: string;
  readonly message: string;
  readonly confidence?: number;
}

export interface VerifySurfaceOptions {
  readonly messages: ReadonlyArray<Record<string, unknown>>;
  readonly state: unknown;
  readonly catalog: Catalog;
  readonly phraseBank?: PhraseBank;
  readonly schema?: Record<string, unknown>;
  /** Optional SystemOneClient to run Tier 2 calibrated entailment checks on non-phrase strings. */
  readonly client?: SystemOneClient;
  /** Minimum Noul score required for a freeform claim to pass Tier 2 entailment (default: 0.5). */
  readonly entailmentThreshold?: number;
  /** Allowed URL schemes for `sink: "url"` props (default: `["https:", "http:", "mailto:"]`). */
  readonly allowedUrlSchemes?: readonly string[];
}

export interface GuardReport {
  readonly ok: boolean;
  readonly findings: readonly GuardFinding[];
  /** Copy of `messages` with any offending components or unsafe sink props stripped. */
  readonly sanitizedMessages: Array<Record<string, unknown>>;
}

const DEFAULT_ALLOWED_SCHEMES = ["https:", "http:", "mailto:"] as const;
const SAFE_STYLE_TOKEN_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_EVENT_ID_RE = /^[a-zA-Z0-9_.:-]+$/;
const DANGEROUS_HTML_RE = /<\s*script\b|on\w+\s*=|javascript\s*:/i;

function isBindingObject(v: unknown): v is { path: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)["path"] === "string"
  );
}

/**
 * Collect all canonical scalar values and humanized pointer labels that legitimately
 * originate from `state`, `phraseBank`, or `schema`.
 */
function buildAllowedVocabulary(
  state: unknown,
  phraseBank?: PhraseBank,
  schema?: Record<string, unknown>,
): Set<string> {
  const allowed = new Set<string>(["0", "100"]);
  for (const [ptr, val] of walk(state)) {
    allowed.add(humanizePointer(ptr));
    const lastSeg = ptr.split("/").filter(Boolean).at(-1);
    if (lastSeg) allowed.add(humanizePointer(`/${lastSeg}`));
    const top = "/" + (ptr.split("/").filter(Boolean)[0] ?? "");
    if (top !== "/") allowed.add(humanizePointer(top));
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      allowed.add(canonicalString(val));
      allowed.add(String(val));
    }
  }
  if (phraseBank) {
    for (const entry of phraseBank.entries.values()) {
      allowed.add(entry.text);
    }
  }
  if (schema) {
    for (const [, val] of walk(schema)) {
      if (typeof val === "string" || typeof val === "number") {
        allowed.add(String(val));
      }
    }
  }
  return allowed;
}

function checkUrlSafety(rawUrl: string, allowedSchemes: readonly string[]): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed, "https://lathe.local");
    return allowedSchemes.includes(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Verify an A2UI message bundle across all four Lathe Guard tiers:
 * - **Tier 1 (`tier1_schema`)**: Component existence, root container, child adjacency integrity, enum options.
 * - **Tier 1.5 (`tier1_5_trace`)**: RFC 6901 JSON Pointer resolution & literal scalar provenance trace.
 * - **Tier 2 (`tier2_entailment`)**: System One (`Noul`) calibrated entailment verification for any non-catalog text.
 * - **Tier 4 (`tier4_sink`)**: XSS / URL scheme / CSS style / event handler sink enforcement.
 */
export async function verifySurface(options: VerifySurfaceOptions): Promise<GuardReport> {
  const {
    messages,
    state,
    catalog,
    phraseBank,
    schema,
    client,
    entailmentThreshold = 0.5,
    allowedUrlSchemes = DEFAULT_ALLOWED_SCHEMES,
  } = options;

  const findings: GuardFinding[] = [];
  const allowedVocab = buildAllowedVocabulary(state, phraseBank, schema);

  // Locate updateComponents message
  const updateIdx = messages.findIndex((m) => "updateComponents" in m);
  if (updateIdx === -1) {
    return { ok: true, findings: [], sanitizedMessages: messages.map((m) => ({ ...m })) };
  }

  const updatePayload = (
    messages[updateIdx] as {
      updateComponents: { surfaceId: string; components: Array<Record<string, unknown>> };
    }
  ).updateComponents;
  const rawComponents = updatePayload.components;

  const idSet = new Set(rawComponents.map((c) => String(c["id"] ?? "")));
  if (!idSet.has("root")) {
    findings.push({
      tier: "tier1_schema",
      severity: "error",
      code: "missing_root",
      componentId: "root",
      message: "A2UI surface is missing a required 'root' container component.",
    });
  }

  const pendingEntailment: Array<{
    qid: string;
    componentId: string;
    prop: string;
    claim: string;
  }> = [];

  const blockedComponentIds = new Set<string>();

  for (const comp of rawComponents) {
    const cid = String(comp["id"] ?? "unknown");
    const cname = String(comp["component"] ?? "");
    const spec = catalog.get(cname);

    // Tier 1: Component must exist in catalog
    if (!spec) {
      findings.push({
        tier: "tier1_schema",
        severity: "error",
        code: "unknown_component",
        componentId: cid,
        message: `Component '${cname}' does not exist in catalog '${catalog.catalogId}'.`,
      });
      blockedComponentIds.add(cid);
      continue;
    }

    // Tier 1: Container children must exist
    if (Array.isArray(comp["children"])) {
      for (const childId of comp["children"] as unknown[]) {
        if (typeof childId !== "string" || !idSet.has(childId)) {
          findings.push({
            tier: "tier1_schema",
            severity: "error",
            code: "dangling_child",
            componentId: cid,
            message: `Container '${cid}' references non-existent child '${String(childId)}'.`,
          });
        }
      }
    }

    // Inspect props defined on component
    for (const [propName, propVal] of Object.entries(comp)) {
      if (propName === "id" || propName === "component" || propName === "children") continue;

      // Collection columns validation (Tier 1.5 trace on column keys)
      if (propName === "columns" && spec.collection && Array.isArray(propVal)) {
        const rowsBinding = comp["rows"];
        const resolvedRows = isBindingObject(rowsBinding)
          ? (() => {
              try {
                return resolve(state, rowsBinding.path);
              } catch {
                return undefined;
              }
            })()
          : undefined;

        if (!Array.isArray(resolvedRows)) {
          findings.push({
            tier: "tier1_5_trace",
            severity: "error",
            code: "broken_pointer",
            componentId: cid,
            prop: "rows",
            message: `Collection component '${cid}' rows binding does not resolve to an array in state.`,
          });
          blockedComponentIds.add(cid);
          continue;
        }

        const validRowKeys = new Set<string>();
        for (const r of resolvedRows) {
          if (typeof r === "object" && r !== null) {
            for (const k of Object.keys(r)) validRowKeys.add(k);
          }
        }

        for (const colObj of propVal as Array<Record<string, unknown>>) {
          const colKey = String(colObj["key"] ?? "");
          if (!validRowKeys.has(colKey)) {
            findings.push({
              tier: "tier1_5_trace",
              severity: "error",
              code: "broken_pointer",
              componentId: cid,
              prop: `columns.${colKey}`,
              message: `Collection column key '${colKey}' on '${cid}' does not exist in array rows.`,
            });
            blockedComponentIds.add(cid);
          }
        }
        continue;
      }

      const propSpec = spec.props.find((p) => p.name === propName);
      const sink = propSpec?.sink ?? (propName === "url" || propName === "href" ? "url" : "text");

      // Tier 1: Enum option validation
      if (propSpec?.kind === "enum" && propSpec.options) {
        if (typeof propVal !== "string" || !(propVal in propSpec.options)) {
          findings.push({
            tier: "tier1_schema",
            severity: "error",
            code: "invalid_enum_option",
            componentId: cid,
            prop: propName,
            message: `Prop '${propName}' value '${String(propVal)}' is not in allowed enum options [${Object.keys(propSpec.options).join(", ")}].`,
          });
          blockedComponentIds.add(cid);
          continue;
        }
      }

      // Tier 1.5: Binding resolution & Sink check on resolved value
      if (isBindingObject(propVal)) {
        const ptr = propVal.path;
        let resolved: unknown;
        try {
          resolved = resolve(state, ptr);
        } catch {
          resolved = undefined;
        }
        if (resolved === undefined) {
          findings.push({
            tier: "tier1_5_trace",
            severity: "error",
            code: "broken_pointer",
            componentId: cid,
            prop: propName,
            message: `JSON Pointer '${ptr}' on '${cid}.${propName}' does not resolve in state.`,
          });
          blockedComponentIds.add(cid);
          continue;
        }

        // Tier 4: Sink check on resolved state value (including array cells!)
        if (typeof resolved === "string") {
          checkSinkValue(cid, propName, sink, resolved, allowedUrlSchemes, findings, blockedComponentIds);
        } else if (Array.isArray(resolved)) {
          for (const [, cellVal] of walk(resolved)) {
            if (typeof cellVal === "string") {
              checkSinkValue(cid, propName, sink, cellVal, allowedUrlSchemes, findings, blockedComponentIds);
            }
          }
        }
        continue;
      }

      // Literal value checks (Tier 1.5 trace + Tier 2 entailment + Tier 4 sink)
      if (typeof propVal === "string") {
        checkSinkValue(cid, propName, sink, propVal, allowedUrlSchemes, findings, blockedComponentIds);
      }

      // If this prop is an enum or ordinal, it was already validated against the catalog
      if (propSpec?.kind === "enum" || propSpec?.kind === "ordinal" || propSpec?.kind === "bool") {
        continue;
      }

      // If this is a literal number or string not in allowedVocab:
      if (typeof propVal === "number") {
        const canon = canonicalString(propVal);
        if (!allowedVocab.has(canon)) {
          findings.push({
            tier: "tier1_5_trace",
            severity: "error",
            code: "untraced_literal",
            componentId: cid,
            prop: propName,
            message: `Untraced numeric literal ${canon} in '${cid}.${propName}' does not exist in source state.`,
          });
          blockedComponentIds.add(cid);
        }
      } else if (typeof propVal === "string" && !allowedVocab.has(propVal)) {
        // Check if any digits inside the string are fabricated numbers not in state
        const digits = propVal.match(/\d+(?:\.\d+)?/g) ?? [];
        const hasFabricatedNumber = digits.some((d) => !allowedVocab.has(d));
        if (hasFabricatedNumber) {
          findings.push({
            tier: "tier1_5_trace",
            severity: "error",
            code: "untraced_literal",
            componentId: cid,
            prop: propName,
            message: `String '${propVal}' in '${cid}.${propName}' contains fabricated numbers not present in state.`,
          });
          blockedComponentIds.add(cid);
        } else if (client) {
          // Queue for Tier 2 System One Noul entailment verification
          pendingEntailment.push({
            qid: `entail_${cid}_${propName}`,
            componentId: cid,
            prop: propName,
            claim: propVal,
          });
        } else {
          findings.push({
            tier: "tier1_5_trace",
            severity: "error",
            code: "untraced_literal",
            componentId: cid,
            prop: propName,
            message: `String '${propVal}' in '${cid}.${propName}' is not in PhraseBank, schema titles, or state leaves.`,
          });
          blockedComponentIds.add(cid);
        }
      }
    }
  }

  // Execute Tier 2 Model Entailment batch if queued
  if (client && pendingEntailment.length > 0) {
    const questions: Record<string, Question> = {};
    for (const item of pendingEntailment) {
      questions[item.qid] = noul(
        `Does the source state directly support rendering the UI text "${item.claim}" on component "${item.componentId}.${item.prop}" without inventing policies, facts, or numbers?`,
        {
          true: "The text is a faithful label or statement directly supported by the source state.",
          false: "The text invents facts, policies, promises, or details not in the source state.",
        },
      );
    }
    const resp = await client.systemOne(state, questions);
    for (const item of pendingEntailment) {
      const ans = resp.answers[item.qid];
      if (ans && ans.type === "noul" && ans.noul < entailmentThreshold) {
        findings.push({
          tier: "tier2_entailment",
          severity: "error",
          code: "unentailed_claim",
          componentId: item.componentId,
          prop: item.prop,
          confidence: Number((1 - ans.noul).toFixed(4)),
          message: `Hallucinated/unentailed UI text "${item.claim}" rejected by System One (noul=${ans.noul.toFixed(2)} < ${entailmentThreshold}).`,
        });
        blockedComponentIds.add(item.componentId);
      }
    }
  }

  // Produce sanitized messages by stripping blocked components and pruning their IDs from container children
  const sanitizedComponents = rawComponents
    .filter((c) => !blockedComponentIds.has(String(c["id"] ?? "")))
    .map((c) => {
      if (Array.isArray(c["children"])) {
        return {
          ...c,
          children: (c["children"] as unknown[]).filter(
            (childId) => typeof childId === "string" && !blockedComponentIds.has(childId) && idSet.has(childId),
          ),
        };
      }
      return { ...c };
    });

  const sanitizedMessages = messages.map((m, idx) => {
    if (idx !== updateIdx) return { ...m };
    return {
      ...m,
      updateComponents: {
        ...updatePayload,
        components: sanitizedComponents,
      },
    };
  });

  return {
    ok: findings.every((f) => f.severity !== "error"),
    findings,
    sanitizedMessages,
  };
}

function checkSinkValue(
  cid: string,
  propName: string,
  sink: string,
  value: string,
  allowedUrlSchemes: readonly string[],
  findings: GuardFinding[],
  blockedComponentIds: Set<string>,
): void {
  if (sink === "url") {
    if (!checkUrlSafety(value, allowedUrlSchemes)) {
      findings.push({
        tier: "tier4_sink",
        severity: "error",
        code: "unsafe_url_scheme",
        componentId: cid,
        prop: propName,
        message: `Unsafe URL scheme in '${cid}.${propName}': '${value}'. Only [${allowedUrlSchemes.join(", ")}] are permitted.`,
      });
      blockedComponentIds.add(cid);
    }
  } else if (sink === "html" || DANGEROUS_HTML_RE.test(value)) {
    if (DANGEROUS_HTML_RE.test(value)) {
      findings.push({
        tier: "tier4_sink",
        severity: "error",
        code: "unsafe_html_sink",
        componentId: cid,
        prop: propName,
        message: `Executable HTML/script payload detected in '${cid}.${propName}': '${value}'.`,
      });
      blockedComponentIds.add(cid);
    }
  } else if (sink === "style") {
    if (!SAFE_STYLE_TOKEN_RE.test(value)) {
      findings.push({
        tier: "tier4_sink",
        severity: "error",
        code: "unsafe_style_sink",
        componentId: cid,
        prop: propName,
        message: `Arbitrary CSS string blocked in style sink '${cid}.${propName}': '${value}'.`,
      });
      blockedComponentIds.add(cid);
    }
  } else if (sink === "event") {
    if (!SAFE_EVENT_ID_RE.test(value)) {
      findings.push({
        tier: "tier4_sink",
        severity: "error",
        code: "unsafe_event_sink",
        componentId: cid,
        prop: propName,
        message: `Unsafe event handler identifier blocked in '${cid}.${propName}': '${value}'.`,
      });
      blockedComponentIds.add(cid);
    }
  }
}
