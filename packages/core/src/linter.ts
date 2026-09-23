/**
 * Catalog Criteria Linter (`lintCatalog`).
 *
 * ## Why this exists
 *
 * Phase 0 proved that **the catalog is the compiler's source code, and criteria are the
 * code.** The single genuine miss in Phase 0 (`/form/reason` -> `Text` instead of
 * `TextField`, while `/form/email` succeeded) happened because `TextField` lacked
 * contrastive `notFor` and broad examples.
 *
 * `lintCatalog` statically analyzes a {@link Catalog} before a single token is spent:
 *
 *   - `missing_not_for`        (error)   Leaf component has no contrastive `notFor`.
 *   - `missing_examples`       (error)   Leaf component has fewer than 2 examples.
 *   - `thin_examples`          (warning) Leaf component has fewer than 3 examples.
 *   - `missing_primary_binding`(error)   Leaf component has no `binding` prop (`value`/`text`).
 *   - `confusable_pair`        (error/warning) Two leaf components share high content-word
 *                                        overlap in their `description`.
 *   - `example_bleed`          (warning) An example on component A overlaps more strongly
 *                                        with component B's description than with A's.
 */

import type { Catalog, ComponentSpec } from "./catalog.ts";

export type LintSeverity = "error" | "warning";

export type LintCode =
  | "missing_not_for"
  | "missing_examples"
  | "thin_examples"
  | "missing_primary_binding"
  | "confusable_pair"
  | "example_bleed";

export interface LintFinding {
  readonly severity: LintSeverity;
  readonly code: LintCode;
  readonly component: string;
  readonly peer?: string;
  readonly message: string;
}

export interface LintReport {
  readonly catalogId: string;
  readonly componentCount: number;
  readonly renderableCount: number;
  readonly findings: readonly LintFinding[];
  readonly maxPairwiseSimilarity: number;
  readonly mostConfusablePair: readonly [string, string, number] | null;
  readonly ok: boolean;
}

const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "as",
  "by",
  "at",
  "from",
  "that",
  "this",
  "is",
  "are",
  "be",
  "shown",
  "used",
  "displays",
  "display",
  "renders",
  "render",
  "component",
  "control",
  "element",
  "value",
  "data",
  "user",
  "single",
]);

function contentTokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    // Light stemmer: strip trailing 's' / 'ing' / 'ed' so "numbers" and "number" match
    .map((w) => w.replace(/(?:ing|ed|es|s)$/, ""));
  return new Set(words.filter((w) => w.length > 2));
}

function cosineSimilarity(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: [] };
  const shared: string[] = [];
  for (const tok of a) {
    if (b.has(tok)) shared.push(tok);
  }
  const score = shared.length / Math.sqrt(a.size * b.size);
  return { score: Number(score.toFixed(3)), shared };
}

export interface LintOptions {
  /** Cosine similarity above which two descriptions are flagged as a warning (default 0.38). */
  warnSimilarity?: number;
  /** Cosine similarity above which two descriptions are flagged as an error (default 0.55). */
  errorSimilarity?: number;
}

export function lintCatalog(catalog: Catalog, options: LintOptions = {}): LintReport {
  const warnSimilarity = options.warnSimilarity ?? 0.38;
  const errorSimilarity = options.errorSimilarity ?? 0.55;

  const findings: LintFinding[] = [];
  const leaves: ComponentSpec[] = [...catalog.renderable(), ...catalog.collections()];

  for (const spec of leaves) {
    if (!spec.notFor || spec.notFor.trim().length < 10) {
      findings.push({
        severity: "error",
        code: "missing_not_for",
        component: spec.name,
        message: `${spec.name} is missing a contrastive 'notFor' boundary (at least 10 chars naming confusable siblings).`,
      });
    }

    if (spec.examples.length < 2) {
      findings.push({
        severity: "error",
        code: "missing_examples",
        component: spec.name,
        message: `${spec.name} has ${spec.examples.length} example(s); at least 2 are required.`,
      });
    } else if (spec.examples.length < 3) {
      findings.push({
        severity: "warning",
        code: "thin_examples",
        component: spec.name,
        message: `${spec.name} has ${spec.examples.length} examples; 3+ recommended to anchor the decision boundary.`,
      });
    }

    const hasBinding = spec.props.some((p) => p.kind === "binding");
    if (!hasBinding) {
      findings.push({
        severity: "error",
        code: "missing_primary_binding",
        component: spec.name,
        message: `${spec.name} is a renderable leaf component but defines no 'binding' prop.`,
      });
    }
  }

  // Pairwise description confusability
  const descTokens = new Map<string, Set<string>>();
  for (const spec of leaves) {
    descTokens.set(spec.name, contentTokens(spec.description));
  }

  let maxSim = 0;
  let mostConfusable: [string, string, number] | null = null;

  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i]!;
      const b = leaves[j]!;
      const { score, shared } = cosineSimilarity(
        descTokens.get(a.name)!,
        descTokens.get(b.name)!,
      );
      if (score > maxSim) {
        maxSim = score;
        mostConfusable = [a.name, b.name, score];
      }
      if (score >= errorSimilarity) {
        findings.push({
          severity: "error",
          code: "confusable_pair",
          component: a.name,
          peer: b.name,
          message: `Descriptions of ${a.name} and ${b.name} are highly confusable (similarity=${score}, shared=[${shared.join(", ")}]). Sharpen their 'description' and 'notFor'.`,
        });
      } else if (score >= warnSimilarity) {
        findings.push({
          severity: "warning",
          code: "confusable_pair",
          component: a.name,
          peer: b.name,
          message: `Descriptions of ${a.name} and ${b.name} overlap noticeably (similarity=${score}, shared=[${shared.join(", ")}]).`,
        });
      }
    }
  }

  // Example bleed check
  for (const spec of leaves) {
    const ownDesc = descTokens.get(spec.name)!;
    for (const ex of spec.examples) {
      const exTok = contentTokens(ex);
      const ownSim = cosineSimilarity(exTok, ownDesc).score;
      for (const other of leaves) {
        if (other.name === spec.name) continue;
        const otherSim = cosineSimilarity(exTok, descTokens.get(other.name)!).score;
        if (otherSim > ownSim + 0.25 && otherSim >= 0.35) {
          findings.push({
            severity: "warning",
            code: "example_bleed",
            component: spec.name,
            peer: other.name,
            message: `Example ${JSON.stringify(ex)} on ${spec.name} matches ${other.name}'s description (${otherSim}) more closely than ${spec.name}'s (${ownSim}).`,
          });
        }
      }
    }
  }

  const hasErrors = findings.some((f) => f.severity === "error");
  return {
    catalogId: catalog.catalogId,
    componentCount: catalog.size,
    renderableCount: leaves.length,
    findings,
    maxPairwiseSimilarity: maxSim,
    mostConfusablePair: mostConfusable,
    ok: !hasErrors,
  };
}
