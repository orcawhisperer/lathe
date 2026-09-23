/**
 * The compiler.
 *
 * Given a catalog and an application state, emit an A2UI v0.9 surface. Every decision is
 * either a closed-set selection made by the model, or plain code. Nothing is generated.
 *
 * ## What is asked, and what is not
 *
 * | decision                    | how                                     |
 * |-----------------------------|-----------------------------------------|
 * | is this datum relevant?     | `Noul`                                  |
 * | which component renders it? | `Choice` over the catalog               |
 * | which enum variant?         | `Choice` over the enum                  |
 * | which field feeds this prop?| `Choice` over JSON Pointers             |
 * | component ids, tree shape, ordering, the primary binding | **code — free** |
 * | the data model              | **the input state, copied verbatim**    |
 *
 * The last row is the one that matters. No rendered character can differ from the source,
 * because no rendered character is produced by the model.
 */

import { preview, type Scalar } from "./canonical.ts";
import { Catalog, type ComponentSpec, type PropSpec } from "./catalog.ts";
import {
  type Answer,
  type ChoiceAnswer,
  type NoulAnswer,
  type Question,
  type ScoreAnswer,
  type SystemOneClient,
  type SystemOneResponse,
  choice,
  noul,
  ranked,
  score,
} from "./client.ts";
import {
  type PhraseBank,
  type SchemaFieldConstraint,
  humanizePointer,
  schemaConstraintForPointer,
  schemaTitleForPointer,
} from "./phrases.ts";
import * as ptr from "./pointers.ts";

export type Mode = "auto" | "speculative" | "staged";

/** Ambiguity threshold: below this margin the top two options are treated as a near-tie. */
export const AMBIGUOUS_MARGIN = 0.15;

/** Binding questions list at most this many candidate pointers, to bound the question size. */
export const MAX_BINDING_CANDIDATES = 24;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface ColumnSummary {
  readonly key: string;
  readonly valueType: "string" | "number" | "boolean";
  readonly sample: Scalar;
}

/** One datum (or homogeneous array of objects) in the state that may become one component in the surface. */
export interface Block {
  readonly id: string;
  readonly pointer: string;
  readonly value: Scalar;
  readonly emptyField?: boolean;
  readonly constraint?: SchemaFieldConstraint;
  readonly collection?: {
    readonly rowCount: number;
    readonly columns: readonly ColumnSummary[];
  };
}

export interface DeriveBlocksOptions {
  maxBlocks?: number;
  /** When true, collapses homogeneous arrays of objects (e.g. `/line_items`) into a single collection Block. */
  collapseCollections?: boolean;
  /** When true, recovers empty strings `""` as editable form blocks and attaches JSON Schema constraints. */
  formAware?: boolean;
  /** Optional JSON Schema used to extract enum options, numeric bounds, and multiline hints. */
  schema?: Record<string, unknown>;
}

function extractHomogeneousColumns(arr: unknown[]): ColumnSummary[] | null {
  if (arr.length === 0) return null;
  for (const item of arr) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return null;
    }
  }
  const colMap = new Map<string, ColumnSummary>();
  for (const item of arr as Array<Record<string, unknown>>) {
    for (const [k, v] of Object.entries(item)) {
      if (colMap.has(k)) continue;
      if (typeof v === "string" && v.trim() !== "") {
        colMap.set(k, { key: k, valueType: "string", sample: v });
      } else if (typeof v === "number" && Number.isFinite(v)) {
        colMap.set(k, { key: k, valueType: "number", sample: v });
      } else if (typeof v === "boolean") {
        colMap.set(k, { key: k, valueType: "boolean", sample: v });
      }
    }
  }
  return colMap.size > 0 ? [...colMap.values()] : null;
}

/**
 * Every scalar leaf (or homogeneous object array when `collapseCollections` is enabled)
 * in the state becomes a candidate block, in document order.
 */
export function deriveBlocks(
  state: unknown,
  {
    maxBlocks = 40,
    collapseCollections = false,
    formAware = false,
    schema,
  }: DeriveBlocksOptions = {},
): Block[] {
  const blocks: Block[] = [];
  const collapsedPrefixes: string[] = [];

  for (const [pointer, value] of ptr.walk(state)) {
    if (
      collapsedPrefixes.some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`))
    ) {
      continue;
    }

    if (collapseCollections && Array.isArray(value) && value.length >= 1 && pointer !== "") {
      const cols = extractHomogeneousColumns(value);
      if (cols) {
        collapsedPrefixes.push(pointer);
        const summaryText = `${value.length} items [${cols.map((c) => `${c.key}=${String(c.sample)}`).join(", ")}]`;
        blocks.push({
          id: `B${String(blocks.length).padStart(3, "0")}`,
          pointer,
          value: summaryText,
          collection: {
            rowCount: value.length,
            columns: cols,
          },
        });
        if (blocks.length >= maxBlocks) break;
        continue;
      }
    }

    if (typeof value === "object" && value !== null) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;

    const isEmptyString = typeof value === "string" && value.trim() === "";
    if (isEmptyString && !formAware) continue;

    const constraint = formAware ? schemaConstraintForPointer(schema, pointer) : undefined;
    blocks.push({
      id: `B${String(blocks.length).padStart(3, "0")}`,
      pointer,
      value: value as Scalar,
      ...(isEmptyString ? { emptyField: true } : {}),
      ...(constraint && Object.keys(constraint).length > 0 ? { constraint } : {}),
    });
    if (blocks.length >= maxBlocks) break;
  }
  return blocks;
}

/**
 * The state the model sees: the raw document plus an explicit id -> pointer -> value index.
 */
function taggedState(document: unknown, blocks: Block[]): Record<string, unknown> {
  return {
    document,
    blocks: blocks.map((b) => {
      if (b.collection) {
        return {
          id: b.id,
          path: b.pointer,
          value: b.value,
          rowCount: b.collection.rowCount,
          columns: b.collection.columns,
        };
      }
      if (b.emptyField || b.constraint) {
        return {
          id: b.id,
          path: b.pointer,
          value: b.value,
          ...(b.emptyField
            ? {
                emptyEditableField: true,
                fieldHint: b.constraint?.description ?? humanizePointer(b.pointer),
              }
            : {}),
          ...(b.constraint?.enumOptions ? { allowedEnumChoices: b.constraint.enumOptions } : {}),
          ...(b.constraint?.multiline ? { multilineTextField: true } : {}),
          ...(b.constraint?.minimum !== undefined || b.constraint?.maximum !== undefined
            ? {
                editableRangeBounds: {
                  min: b.constraint.minimum ?? 0,
                  max: b.constraint.maximum ?? 100,
                },
              }
            : {}),
        };
      }
      return { id: b.id, path: b.pointer, value: b.value };
    }),
  };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type PropRole = "binding" | "enum" | "bool" | "ordinal" | "phrase" | "stated";

export interface PropRef {
  blockId: string;
  component: string;
  prop: string;
  role: PropRole;
}

/** Bookkeeping that maps question ids back to what they decide. Pure code, no model. */
export class CompilePlan {
  readonly blocks: Block[];
  readonly propIndex = new Map<string, PropRef>();
  readonly includeIndex = new Map<string, string>();
  readonly componentIndex = new Map<string, string>();
  readonly bindingCandidates = new Map<string, string[]>();
  readonly #byId: Map<string, Block>;

  constructor(blocks: Block[]) {
    this.blocks = blocks;
    this.#byId = new Map(blocks.map((b) => [b.id, b]));
  }

  block(blockId: string): Block {
    const b = this.#byId.get(blockId);
    if (!b) throw new Error(`unknown block id: ${blockId}`);
    return b;
  }
}

/** The uncertainty behind one emitted component — the thing an LLM pipeline cannot give you. */
export interface ComponentCalibration {
  componentId: string;
  blockId: string;
  pointer: string;
  component: string;
  confidence: number;
  probabilities: Record<string, number>;
  runnerUp: string | null;
  runnerUpProbability: number;
  props: Record<string, Record<string, unknown>>;
}

export function isAmbiguous(c: ComponentCalibration): boolean {
  if (c.runnerUp === null) return false;
  return (c.probabilities[c.component] ?? 0) - c.runnerUpProbability < AMBIGUOUS_MARGIN;
}

export interface CompileStats {
  mode: Mode;
  blocks: number;
  rendered: number;
  excluded: number;
  questions: number;
  roundTrips: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  replayed: boolean;
  speculativeEstimate: number;
}

export interface CompileResult {
  messages: Array<Record<string, unknown>>;
  calibration: Record<string, ComponentCalibration>;
  plan: CompilePlan;
  responses: SystemOneResponse[];
  excluded: string[];
  mode: Mode;
  stats: CompileStats;
}

// ---------------------------------------------------------------------------
// Question construction
// ---------------------------------------------------------------------------

/**
 * The prop that binds to the block's own pointer.
 *
 * Determined in code and never asked. Asking "which field supplies the text of the
 * component rendering field X?" would be spending a question to rediscover something the
 * caller already told us.
 */
function primaryBinding(spec: ComponentSpec): PropSpec | undefined {
  const bindings = spec.props.filter((p) => p.kind === "binding");
  if (bindings.length === 0) return undefined;
  for (const preferred of ["value", "text"]) {
    const hit = bindings.find((p) => p.name === preferred);
    if (hit) return hit;
  }
  return bindings[0];
}

function routingQuestions(
  catalog: Catalog,
  blocks: Block[],
): { questions: Record<string, Question>; plan: CompilePlan } {
  const plan = new CompilePlan(blocks);
  const questions: Record<string, Question> = {};
  const scalarCriteria = catalog.choiceCriteria();
  const collectionCriteria = catalog.collectionChoiceCriteria();

  for (const b of blocks) {
    const inc = `include_${b.id}`;
    questions[inc] = noul(
      {
        question: `Should block ${b.id} be shown in the interface for this request?`,
        compare: [`\`blocks[${b.id}].value\``, "`document.intent`"],
        focus: "Relevance of this single datum to what the user asked for.",
      },
      {
        true: "The user's request is about this datum, or it is needed to act on the request",
        false: "This datum is unrelated to the request and would only add clutter",
      },
    );
    plan.includeIndex.set(inc, b.id);

    const cmp = `component_${b.id}`;
    const useCollectionPool = b.collection && Object.keys(collectionCriteria).length > 0;
    questions[cmp] = choice(
      {
        question: `Which component should render block ${b.id}?`,
        inspect: `\`blocks[${b.id}].value\``,
        focus: "Match the shape and role of the datum, not the topic of the request.",
      },
      useCollectionPool ? collectionCriteria : scalarCriteria,
    );
    plan.componentIndex.set(cmp, b.id);
  }

  return { questions, plan };
}

/**
 * Build prop questions for `assignments` = `{ blockId: [candidate component names] }`.
 *
 * In staged mode the candidate list is the winning component. In speculative mode it is
 * every component in the catalog, asked up front, with most answers discarded by code.
 * That is the fan-out trade: questions are nearly free, round trips are not.
 */
function propQuestions(
  catalog: Catalog,
  plan: CompilePlan,
  assignments: Map<string, string[]>,
  document: unknown,
  phraseBank?: PhraseBank,
): Record<string, Question> {
  const questions: Record<string, Question> = {};
  const phraseCriteria =
    phraseBank && phraseBank.size > 0 ? phraseBank.choiceCriteria() : undefined;

  for (const [blockId, candidates] of assignments) {
    const block = plan.block(blockId);
    if (block.collection) {
      for (const col of block.collection.columns) {
        const colQid = `col_format_${blockId}_${col.key}`;
        if (col.valueType === "number") {
          questions[colQid] = choice(
            {
              question: `How should numeric column \`${col.key}\` (sample=${String(col.sample)}) in collection ${blockId} (\`${block.pointer}\`) be formatted?`,
              inspect: `\`blocks[${blockId}].columns\``,
              focus: "Whether this number is a monetary price/amount, a whole count/quantity, or a decimal rate/ratio.",
            },
            {
              currency: "monetary amount in dollars or local currency (usd, price, cost, total, amount, fee, balance)",
              integer: "whole count of items, quantity, units, seats, or events (qty, count, units, attempts)",
              decimal: "floating-point measurement, ratio, percentage, or rate",
            },
          );
        } else if (col.valueType === "string") {
          questions[colQid] = choice(
            {
              question: `How should string column \`${col.key}\` (sample=${JSON.stringify(col.sample)}) in collection ${blockId} (\`${block.pointer}\`) be rendered?`,
              inspect: `\`blocks[${blockId}].columns\``,
              focus: "Whether this string is a short discrete status/SKU/tier token or general descriptive text.",
            },
            {
              badge: "short categorical status code, SKU tag, tier, or 1-2 word token",
              text: "general string identifier, name, email, or multi-word description",
            },
          );
        }
      }
    }

    for (const name of candidates) {
      const spec = catalog.get(name);
      if (!spec) continue;
      const primary = primaryBinding(spec);

      for (const prop of spec.props) {
        const qid = `prop_${blockId}_${name}_${prop.name}`;

        if (prop.kind === "binding") {
          if (primary && prop.name === primary.name) continue; // bound in code
          const pointers = ptr
            .leaves(document, { valueType: prop.valueType })
            .map(([p]) => p)
            .slice(0, MAX_BINDING_CANDIDATES);
          if (pointers.length === 0) continue;

          const criteria: Record<string, unknown> = {};
          for (const p of pointers) {
            criteria[p] = {
              what: `The value at \`${p}\``,
              examples: [preview(ptr.resolve(document, p) as Scalar, 60)],
            };
          }
          criteria["__none__"] = {
            what: "No field in the document is a good fit for this property",
            not_for: "Any case where one of the listed paths clearly fits",
          };

          questions[qid] = choice(
            {
              question: `Which field should supply \`${prop.name}\` for the ${name} rendering block ${blockId}?`,
              focus: prop.description,
            },
            criteria,
          );
          plan.bindingCandidates.set(qid, pointers);
          plan.propIndex.set(qid, { blockId, component: name, prop: prop.name, role: "binding" });
        } else if (prop.kind === "phrase") {
          // If an i18n PhraseBank is provided, select a key from it via Choice;
          // otherwise no question is needed — coerceProps derives the label deterministically
          // from the JSON Schema title or humanized JSON Pointer.
          if (phraseCriteria) {
            questions[qid] = choice(
              {
                question: `Which approved phrase should supply \`${prop.name}\` for the ${name} rendering block ${blockId} (\`blocks[${blockId}].path\`)?`,
                inspect: `\`blocks[${blockId}]\``,
                focus: prop.description,
              },
              phraseCriteria,
            );
            plan.propIndex.set(qid, { blockId, component: name, prop: prop.name, role: "phrase" });
          }
        } else if (prop.kind === "enum") {
          questions[qid] = choice(
            {
              question: `Which \`${prop.name}\` fits block ${blockId}?`,
              inspect: `\`blocks[${blockId}].value\``,
              focus: prop.description,
            },
            { ...prop.options },
          );
          plan.propIndex.set(qid, { blockId, component: name, prop: prop.name, role: "enum" });
        } else if (prop.kind === "bool") {
          questions[qid] = noul({
            question: `For block ${blockId}: ${prop.description}?`,
            inspect: `\`blocks[${blockId}].value\``,
          });
          plan.propIndex.set(qid, { blockId, component: name, prop: prop.name, role: "bool" });
        } else if (prop.kind === "ordinal") {
          questions[qid] = score(
            {
              question: `For block ${blockId}: ${prop.description}`,
              inspect: `\`blocks[${blockId}].value\``,
            },
            [...(prop.levels ?? [])],
          );
          plan.propIndex.set(qid, { blockId, component: name, prop: prop.name, role: "ordinal" });
        }

        // An optional prop needs a second question: not "which value?" but "does the
        // document justify setting this at all?". Without it, a Choice is forced to pick
        // something even when the honest answer is "the default should stand".
        if (prop.optional && (prop.kind === "enum" || prop.kind === "ordinal")) {
          const sid = `stated_${blockId}_${name}_${prop.name}`;
          questions[sid] = noul(
            {
              question: `Does the document say anything about \`${prop.name}\` for block ${blockId}?`,
              focus: prop.description,
            },
            {
              true: "The document supports a specific value for this property",
              false: "The document says nothing about it; the component default should stand",
            },
          );
          plan.propIndex.set(sid, { blockId, component: name, prop: prop.name, role: "stated" });
        }
      }
    }
  }

  return questions;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function isChoice(a: Answer | undefined): a is ChoiceAnswer {
  return a?.type === "choice";
}
function isNoul(a: Answer | undefined): a is NoulAnswer {
  return a?.type === "noul";
}
function isScore(a: Answer | undefined): a is ScoreAnswer {
  return a?.type === "score";
}

function coerceProps(
  spec: ComponentSpec,
  block: Block,
  answers: Record<string, Answer>,
  calib: ComponentCalibration,
  phraseBank?: PhraseBank,
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const primary = primaryBinding(spec);
  if (primary) {
    props[primary.name] = { path: block.pointer }; // code, not model
  }

  for (const prop of spec.props) {
    const qid = `prop_${block.id}_${spec.name}_${prop.name}`;
    const sid = `stated_${block.id}_${spec.name}_${prop.name}`;

    if (prop.kind === "phrase") {
      const answer = answers[qid];
      const chosenKey = isChoice(answer) ? answer.choice : "__auto__";
      const phraseEntry = chosenKey !== "__auto__" ? phraseBank?.get(chosenKey) : undefined;

      if (phraseEntry && isChoice(answer)) {
        props[prop.name] = phraseEntry.text;
        calib.props[prop.name] = {
          source: "phrase_bank",
          phraseKey: phraseEntry.key,
          value: phraseEntry.text,
          confidence: answer.confidence,
          probabilities: answer.probabilities,
        };
      } else {
        const fromSchema = schemaTitleForPointer(schema, block.pointer);
        const derived = fromSchema ?? humanizePointer(block.pointer);
        props[prop.name] = derived;
        calib.props[prop.name] = {
          source: fromSchema ? "schema_title" : "pointer_humanized",
          value: derived,
        };
      }
      continue;
    }

    const answer = answers[qid];
    if (answer === undefined) continue;

    const stated = answers[sid];
    if (isNoul(stated) && stated.noul < 0.5) {
      calib.props[prop.name] = { skipped: "not stated", stated: stated.noul };
      continue;
    }

    if (isChoice(answer)) {
      if (prop.kind === "binding") {
        if (answer.choice === "__none__") {
          calib.props[prop.name] = { skipped: "no suitable path" };
          continue;
        }
        props[prop.name] = { path: answer.choice };
      } else {
        props[prop.name] = answer.choice;
      }
      calib.props[prop.name] = {
        value: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
      };
    } else if (isNoul(answer)) {
      props[prop.name] = answer.noul >= 0.5;
      calib.props[prop.name] = { value: props[prop.name], noul: answer.noul };
    } else if (isScore(answer)) {
      const levels = prop.levels?.length ?? 0;
      const index = Math.min(Math.max(0, Math.round(answer.score)), Math.max(0, levels - 1));
      props[prop.name] = index;
      calib.props[prop.name] = { value: index, score: answer.score, confidence: answer.confidence };
    }
  }

  if (block.collection) {
    props["rows"] = { path: block.pointer };
    props["columns"] = block.collection.columns.map((col) => {
      const colAns = answers[`col_format_${block.id}_${col.key}`];
      const defaultFormat =
        col.valueType === "number" ? "decimal" : col.valueType === "boolean" ? "badge" : "text";
      const chosenFormat = isChoice(colAns) ? colAns.choice : defaultFormat;
      const label =
        phraseBank?.get(col.key)?.text ??
        schemaTitleForPointer(schema, `${block.pointer}/0/${col.key}`) ??
        humanizePointer(`/${col.key}`);
      if (isChoice(colAns)) {
        calib.props[`column:${col.key}`] = {
          format: chosenFormat,
          confidence: colAns.confidence,
          probabilities: colAns.probabilities,
        };
      }
      return {
        key: col.key,
        label,
        format: chosenFormat,
      };
    });
  }

  if (spec.name === "Select") {
    props["options"] = block.constraint?.enumOptions
      ? [...block.constraint.enumOptions]
      : [String(block.value)];
  }
  if (spec.name === "Slider") {
    props["min"] = block.constraint?.minimum ?? 0;
    props["max"] = block.constraint?.maximum ?? 100;
  }
  if (
    (spec.name === "Input" || spec.name === "Textarea") &&
    (block.emptyField || block.constraint?.description)
  ) {
    props["placeholder"] = block.constraint?.description ?? humanizePointer(block.pointer);
  }

  return props;
}

/** Pick the container that holds the surface. Prefers a vertical stack if one is offered. */
function defaultRoot(catalog: Catalog): string {
  const containers = [...catalog.components.values()].filter((c) => c.container).map((c) => c.name);
  if (containers.length === 0) {
    throw new Error(
      `catalog ${JSON.stringify(catalog.catalogId)} defines no container component, so there is ` +
        "nothing to use as 'root'. Add a component with container: true, or pass rootComponent.",
    );
  }
  for (const preferred of ["Column", "Stack", "Card", "Row"]) {
    if (containers.includes(preferred)) return preferred;
  }
  return containers[0]!;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface CompileOptions {
  catalog: Catalog;
  state: unknown;
  client: SystemOneClient;
  intent?: string;
  surfaceId?: string;
  mode?: Mode;
  questionBudget?: number;
  includeThreshold?: number;
  maxBlocks?: number;
  theme?: Record<string, unknown>;
  sendDataModel?: boolean;
  rootComponent?: string;
  /** Optional i18n phrase catalog for `kind: "phrase"` props. */
  phraseBank?: PhraseBank;
  /** Optional JSON Schema for the state, used as the fallback title source before path humanization. */
  schema?: Record<string, unknown>;
  /**
   * When true, asks an adjacent-pair Noul question between consecutive blocks and wraps
   * related runs into `Card` / `Row` container components instead of emitting a flat root stack.
   */
  groupBlocks?: boolean;
  /** Probability threshold above which two consecutive blocks are placed in the same container (default 0.55). */
  groupThreshold?: number;
  /** When true, recovers empty string leaves (`""`) and attaches JSON Schema constraints (`enum`, `min`/`max`). */
  formAware?: boolean;
}

function groupingQuestions(blocks: Block[]): Record<string, Question> {
  const out: Record<string, Question> = {};
  for (let i = 0; i + 1 < blocks.length; i++) {
    const a = blocks[i]!;
    const b = blocks[i + 1]!;
    out[`group_${a.id}_${b.id}`] = noul(
      {
        question: `Should block ${a.id} (\`${a.pointer}\`) and block ${b.id} (\`${b.pointer}\`) be grouped together inside the same visual card/section?`,
        compare: [`\`blocks[${a.id}]\``, `\`blocks[${b.id}]\``],
        focus: "Whether these two fields describe the same entity or belong in one visual group.",
      },
      {
        true: "They belong to the same entity or topic and read best inside a shared Card or Row container",
        false: "They belong to different entities or topics and should sit in separate sections",
      },
    );
  }
  return out;
}

function topPrefix(pointer: string): string {
  const seg = pointer.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "/";
}

/**
 * Compile an A2UI v0.9 surface from a component catalog and an application state.
 *
 * `client` is required and has no default. An earlier version defaulted to an offline
 * stub, which meant a caller holding a valid key silently received fabricated numbers.
 * Making the dependency explicit removes the entire class of mistake.
 */
export async function compileSurface(options: CompileOptions): Promise<CompileResult> {
  const {
    catalog,
    state,
    client,
    intent = "",
    surfaceId = "surface_1",
    mode = "auto",
    questionBudget = 600,
    includeThreshold = 0.5,
    maxBlocks = 40,
    theme,
    sendDataModel = true,
    rootComponent,
    phraseBank,
    schema,
    groupBlocks = false,
    groupThreshold = 0.55,
    formAware = Boolean(schema) || catalog.has("Select") || catalog.has("Textarea") || catalog.has("Slider"),
  } = options;

  const collectionNames = catalog.collectionNames();
  const blocks = deriveBlocks(state, {
    maxBlocks,
    collapseCollections: collectionNames.length > 0,
    formAware,
    schema,
  });
  if (blocks.length === 0) throw new Error("state contains no scalar leaves to render");

  const base =
    typeof state === "object" && state !== null && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : { value: state };
  const document: Record<string, unknown> = intent ? { ...base, intent } : { ...base };
  const modelState = taggedState(document, blocks);

  const { questions: routing, plan } = routingQuestions(catalog, blocks);
  const groupQ = groupBlocks ? groupingQuestions(blocks) : {};

  const allNames = catalog.renderableNames();
  const propsPerBlock = allNames.reduce((sum, n) => sum + (catalog.get(n)?.props.length ?? 0) * 2, 0);
  const speculativeEstimate =
    Object.keys(routing).length + Object.keys(groupQ).length + propsPerBlock * blocks.length;
  const chosenMode: Mode =
    mode === "auto" ? (speculativeEstimate <= questionBudget ? "speculative" : "staged") : mode;

  const responses: SystemOneResponse[] = [];
  let answers: Record<string, Answer>;

  if (chosenMode === "speculative") {
    // One round trip: routing plus every prop of every candidate component, up front.
    const assignments = new Map(
      blocks.map((b) => [b.id, b.collection && collectionNames.length > 0 ? collectionNames : allNames] as const),
    );
    const all = {
      ...routing,
      ...groupQ,
      ...propQuestions(catalog, plan, assignments, document, phraseBank),
    };
    const response = await client.systemOne(modelState, all);
    responses.push(response);
    answers = response.answers;
  } else {
    // Two round trips: route first, then fan out only over the winners.
    const first = await client.systemOne(modelState, { ...routing, ...groupQ });
    responses.push(first);
    answers = { ...first.answers };

    const winners = new Map<string, string[]>();
    for (const [qid, blockId] of plan.componentIndex) {
      const a = answers[qid];
      const inc = answers[`include_${blockId}`];
      if (!isChoice(a) || !isNoul(inc)) continue;
      if (inc.noul < includeThreshold) continue;
      const r = ranked(a);
      const keep = [r[0]![0]];
      // Keep the runner-up when the top two are close: cheap insurance against an early
      // wrong split, the same idea as a beam of width two.
      if (r.length > 1 && r[0]![1] - r[1]![1] < AMBIGUOUS_MARGIN) keep.push(r[1]![0]);
      winners.set(blockId, keep);
    }

    if (winners.size > 0) {
      const propQ = propQuestions(catalog, plan, winners, document, phraseBank);
      if (Object.keys(propQ).length > 0) {
        const second = await client.systemOne(modelState, propQ);
        responses.push(second);
        answers = { ...answers, ...second.answers };
      }
    }
  }

  // --- assemble the A2UI messages (pure code from here down) ---------------
  const components: Array<Record<string, unknown>> = [];
  const renderedBlocks: Array<{ block: Block; componentId: string }> = [];
  const calibration: Record<string, ComponentCalibration> = {};
  const excluded: string[] = [];

  for (const b of blocks) {
    const inc = answers[`include_${b.id}`];
    if (isNoul(inc) && inc.noul < includeThreshold) {
      excluded.push(b.id);
      continue;
    }
    const cmpAnswer = answers[`component_${b.id}`];
    if (!isChoice(cmpAnswer)) {
      excluded.push(b.id);
      continue;
    }
    const spec = catalog.get(cmpAnswer.choice);
    if (!spec) {
      excluded.push(b.id);
      continue;
    }

    const r = ranked(cmpAnswer);
    const runnerUp = r.length > 1 ? r[1]![0] : null;
    const runnerUpProbability = r.length > 1 ? r[1]![1] : 0;
    const componentId = `c_${b.id.toLowerCase()}`;

    const calib: ComponentCalibration = {
      componentId,
      blockId: b.id,
      pointer: b.pointer,
      component: cmpAnswer.choice,
      confidence: cmpAnswer.confidence,
      probabilities: { ...cmpAnswer.probabilities },
      runnerUp,
      runnerUpProbability,
      props: {},
    };

    components.push({
      id: componentId,
      component: spec.name,
      ...coerceProps(spec, b, answers, calib, phraseBank, schema),
    });
    renderedBlocks.push({ block: b, componentId });
    calibration[componentId] = calib;
  }

  if (components.length === 0) throw new Error("every block was excluded; nothing to render");

  const leafCount = components.length;
  let rootChildren: string[] = renderedBlocks.map((rb) => rb.componentId);

  if (groupBlocks && renderedBlocks.length > 1 && catalog.has("Card")) {
    const runs: Array<Array<{ block: Block; componentId: string }>> = [[renderedBlocks[0]!]];
    for (let i = 1; i < renderedBlocks.length; i++) {
      const prev = renderedBlocks[i - 1]!;
      const curr = renderedBlocks[i]!;
      const hasCollection = Boolean(prev.block.collection || curr.block.collection);
      const directAns = answers[`group_${prev.block.id}_${curr.block.id}`];
      const sameEntity = topPrefix(prev.block.pointer) === topPrefix(curr.block.pointer);
      const joinRun = hasCollection
        ? false
        : isNoul(directAns)
          ? directAns.noul >= groupThreshold
          : sameEntity;
      if (joinRun) {
        runs.at(-1)!.push(curr);
      } else {
        runs.push([curr]);
      }
    }

    if (runs.length > 1 || runs[0]!.length > 1) {
      const groupedRootChildren: string[] = [];
      let groupIdx = 1;
      for (const run of runs) {
        if (run.length === 1) {
          groupedRootChildren.push(run[0]!.componentId);
        } else {
          const gid = `group_${groupIdx++}`;
          const prefix = topPrefix(run[0]!.block.pointer);
          const title = humanizePointer(prefix);
          components.push({
            id: gid,
            component: "Card",
            title,
            children: run.map((r) => r.componentId),
          });
          groupedRootChildren.push(gid);
        }
      }
      rootChildren = groupedRootChildren;
    }
  }

  // A2UI requires exactly one component with id 'root'. Which container plays that part is
  // a property of the catalog, not of this library — a BYOC catalog need not define 'Column'.
  const rootName = rootComponent ?? defaultRoot(catalog);
  components.unshift({ id: "root", component: rootName, children: rootChildren });

  const create: Record<string, unknown> = {
    surfaceId,
    catalogId: catalog.catalogId,
    sendDataModel,
  };
  if (theme) create["theme"] = theme;

  const messages: Array<Record<string, unknown>> = [
    { version: "v0.9", createSurface: create },
    { version: "v0.9", updateComponents: { surfaceId, components } },
    // The data model is the caller's state, copied verbatim. Every binding resolves into it.
    { version: "v0.9", updateDataModel: { surfaceId, value: document } },
  ];

  const stats: CompileStats = {
    mode: chosenMode,
    blocks: blocks.length,
    rendered: leafCount,
    excluded: excluded.length,
    questions: responses.reduce((n, r) => n + Object.keys(r.answers).length, 0),
    roundTrips: responses.length,
    inputTokens: responses.reduce((n, r) => n + r.inputTokens, 0),
    outputTokens: responses.reduce((n, r) => n + r.outputTokens, 0),
    latencyMs: Number(responses.reduce((n, r) => n + r.latencyMs, 0).toFixed(2)),
    replayed: responses.some((r) => r.replayed),
    speculativeEstimate,
  };

  return { messages, calibration, plan, responses, excluded, mode: chosenMode, stats };
}
