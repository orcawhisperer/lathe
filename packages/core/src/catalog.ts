/**
 * Catalog model: a framework-agnostic description of the components an agent may use.
 *
 * This mirrors A2UI's `CatalogDefinitions` (and CopilotKit's `createCatalog` Zod schemas),
 * but in a form the compiler can introspect to derive questions automatically.
 *
 * The central insight: every A2UI prop is one of five kinds, and each maps to exactly one
 * selection primitive — or to no model call at all.
 *
 * | kind      | primitive | notes                                                  |
 * |-----------|-----------|--------------------------------------------------------|
 * | `enum`    | Choice    | over the allowed values                                  |
 * | `bool`    | Noul      | calibrated 0..1                                          |
 * | `ordinal` | Score     | expectation over ordered levels                          |
 * | `binding` | Choice    | over JSON Pointers — **never a generated string**        |
 * | `literal` | *(none)*  | supplied by code, or left to the component default       |
 *
 * There is no sixth kind, and in particular there is no "free text" kind. That absence is
 * the load-bearing property of the whole design.
 */

import type { ValueTypeTag } from "./canonical.ts";

export type PropKind = "enum" | "bool" | "ordinal" | "binding" | "phrase" | "literal";
export type ValueType = ValueTypeTag | "any";

/**
 * Where a prop's value ends up in the rendered document.
 *
 * This is a **security declaration, not a hint.** The compiler's guard prevents
 * *hallucination* — it says nothing about whether a value is *dangerous*. A perfectly
 * faithful value copied verbatim from the source document can still be
 * `javascript:fetch('//evil')`, because source documents contain user-controlled data.
 *
 * So every binding declares its sink, and the renderer enforces a rule per sink:
 *
 * - `text`  — default. Framework auto-escaping. Safe.
 * - `url`   — parsed with `URL`; scheme must be on an allow-list.
 * - `style` — token allow-list only; never a raw CSS string.
 * - `html`  — refused unless explicitly opted in and sanitised.
 * - `event` — resolved against a registered handler map; never evaluated as code.
 *
 * A binding with no declared sink is treated as `text`, which is the safe default. A
 * binding that *reaches* a dangerous sink without *declaring* it is a catalog bug that
 * the guard is expected to catch.
 */
export type SinkClass = "text" | "url" | "style" | "html" | "event";

export interface PropSpecInit {
  name: string;
  kind: PropKind;
  description: string;
  /** Required when `kind === "enum"`: option key -> what that option means. */
  options?: Record<string, string>;
  /** Required when `kind === "ordinal"`: 2..10 ordered levels. */
  levels?: string[];
  /** Filters binding candidates. Only meaningful when `kind === "binding"`. */
  valueType?: ValueType;
  optional?: boolean;
  default?: unknown;
  /** Defaults to `"text"`. See {@link SinkClass}. */
  sink?: SinkClass;
  /**
   * Whether this prop's answer depends on the *values* in the state rather than only its
   * *shape*. Used by shape-level caching: value-sensitive props must be recomputed on a
   * cache hit, everything else can be reused.
   */
  valueSensitive?: boolean;
}

export class PropSpec {
  readonly name: string;
  readonly kind: PropKind;
  readonly description: string;
  readonly options: Readonly<Record<string, string>> | undefined;
  readonly levels: readonly string[] | undefined;
  readonly valueType: ValueType;
  readonly optional: boolean;
  readonly default: unknown;
  readonly sink: SinkClass;
  readonly valueSensitive: boolean;

  constructor(init: PropSpecInit) {
    this.name = init.name;
    this.kind = init.kind;
    this.description = init.description;
    this.options = init.options;
    this.levels = init.levels;
    this.valueType = init.valueType ?? "any";
    this.optional = init.optional ?? false;
    this.default = init.default;
    this.sink = init.sink ?? "text";
    // Enums resolve to a fixed vocabulary chosen by looking at the datum, so they are
    // value-sensitive by default; a caller can override when it genuinely is not.
    this.valueSensitive = init.valueSensitive ?? init.kind === "enum";

    if (this.kind === "enum" && (!this.options || Object.keys(this.options).length === 0)) {
      throw new Error(`prop ${JSON.stringify(this.name)}: kind='enum' requires options`);
    }
    if (this.kind === "ordinal") {
      const n = this.levels?.length ?? 0;
      if (n < 2) {
        throw new Error(`prop ${JSON.stringify(this.name)}: kind='ordinal' requires >= 2 levels`);
      }
      if (n > 10) {
        throw new Error(
          `prop ${JSON.stringify(this.name)}: Score supports at most 10 levels, got ${n}`,
        );
      }
    }
    if (this.kind !== "binding" && init.sink !== undefined) {
      throw new Error(
        `prop ${JSON.stringify(this.name)}: 'sink' only applies to kind='binding'. ` +
          "A non-binding prop cannot carry attacker-controlled data.",
      );
    }
  }
}

export interface ComponentSpecInit {
  name: string;
  /** What the model reads as the Choice criterion for this component. */
  description: string;
  props?: PropSpecInit[];
  /** Container components hold children via A2UI's adjacency list. */
  container?: boolean;
  /** Collection components bind to a homogeneous array of objects (e.g. DataTable, DataList). */
  collection?: boolean;
  /**
   * Sharpens the decision boundary against neighbouring options.
   *
   * Contrastive criteria measurably beat isolated descriptions. Phase 0's only genuine
   * miss was a `TextField` whose criterion leaned on the word "email", so a second empty
   * string that was not an email fell through to `Text`. Write `notFor` as if defending
   * against the single most confusable sibling.
   */
  notFor?: string;
  examples?: string[];
}

export class ComponentSpec {
  readonly name: string;
  readonly description: string;
  readonly props: readonly PropSpec[];
  readonly container: boolean;
  readonly collection: boolean;
  readonly notFor: string | undefined;
  readonly examples: readonly string[];

  constructor(init: ComponentSpecInit) {
    this.name = init.name;
    this.description = init.description;
    this.props = (init.props ?? []).map((p) => new PropSpec(p));
    this.container = init.container ?? false;
    this.collection = init.collection ?? false;
    this.notFor = init.notFor;
    this.examples = init.examples ?? [];

    const seen = new Set<string>();
    for (const p of this.props) {
      if (seen.has(p.name)) {
        throw new Error(`component ${JSON.stringify(this.name)}: duplicate prop ${JSON.stringify(p.name)}`);
      }
      seen.add(p.name);
    }
  }

  prop(name: string): PropSpec | undefined {
    return this.props.find((p) => p.name === name);
  }

  /** Render this component as a structured Choice criterion. */
  criteriaEntry(): Record<string, unknown> {
    const entry: Record<string, unknown> = { what: this.description };
    if (this.notFor) entry["not_for"] = this.notFor;
    if (this.examples.length > 0) entry["examples"] = [...this.examples];
    return entry;
  }
}

/** A named set of components, matching an A2UI `catalogId`. */
export class Catalog {
  readonly catalogId: string;
  readonly components: Map<string, ComponentSpec>;

  constructor(catalogId: string, components: Iterable<ComponentSpec | ComponentSpecInit> = []) {
    this.catalogId = catalogId;
    this.components = new Map();
    for (const spec of components) this.add(spec);
  }

  add(spec: ComponentSpec | ComponentSpecInit): this {
    const inst = spec instanceof ComponentSpec ? spec : new ComponentSpec(spec);
    this.components.set(inst.name, inst);
    return this;
  }

  get(name: string): ComponentSpec | undefined {
    return this.components.get(name);
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  get size(): number {
    return this.components.size;
  }

  /** Leaf (non-container, non-collection) components: the ones a scalar data block can be rendered as. */
  renderable(): ComponentSpec[] {
    return [...this.components.values()].filter((c) => !c.container && !c.collection);
  }

  renderableNames(): string[] {
    return this.renderable().map((c) => c.name);
  }

  /** Collection components: the ones a homogeneous array of objects can be rendered as. */
  collections(): ComponentSpec[] {
    return [...this.components.values()].filter((c) => c.collection);
  }

  collectionNames(): string[] {
    return this.collections().map((c) => c.name);
  }

  /** Build the Choice `criteria` map for scalar component selection. */
  choiceCriteria(names?: string[]): Record<string, unknown> {
    const pool = names ?? this.renderableNames();
    const out: Record<string, unknown> = {};
    for (const name of pool) {
      const spec = this.components.get(name);
      if (spec) out[name] = spec.criteriaEntry();
    }
    return out;
  }

  /** Build the Choice `criteria` map for collection component selection. */
  collectionChoiceCriteria(names?: string[]): Record<string, unknown> {
    const pool = names ?? this.collectionNames();
    const out: Record<string, unknown> = {};
    for (const name of pool) {
      const spec = this.components.get(name);
      if (spec) out[name] = spec.criteriaEntry();
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// The A2UI basic catalog, plus a few richer components to demonstrate BYOC.
//
// This exists so the library is runnable out of the box and so the conformance
// fixtures have something stable to target. The real flagship catalog is shadcn/ui,
// which lives in @lathe/shadcn.
// ---------------------------------------------------------------------------

export const BASIC_CATALOG: Catalog = new Catalog(
  "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
  [
    new ComponentSpec({
      name: "Column",
      description: "A vertical container that stacks its children top to bottom.",
      container: true,
    }),
    new ComponentSpec({
      name: "Row",
      description: "A horizontal container that places its children side by side.",
      container: true,
    }),
    new ComponentSpec({
      name: "Card",
      description: "A titled surface container that groups related content.",
      container: true,
    }),
    new ComponentSpec({
      name: "Text",
      description: "Plain prose or a label read as running text.",
      notFor: "A numeric measurement, a status word, or an interactive control",
      examples: ["A paragraph explaining the refund policy"],
      props: [
        { name: "text", kind: "binding", description: "The text content to display", valueType: "string" },
        {
          name: "variant",
          kind: "enum",
          description: "Typographic role of this text",
          options: {
            h2: "A major section heading that names what follows",
            body: "Ordinary running prose",
            caption: "A small subordinate label above or below another control",
          },
          optional: true,
          default: "body",
        },
      ],
    }),
    new ComponentSpec({
      name: "Metric",
      description: "A single key number or measurement shown with a label.",
      notFor: "Free-form prose, or a categorical status word",
      examples: ["Amount charged: $49.00", "Days overdue: 3"],
      props: [
        { name: "label", kind: "binding", description: "The name of the measurement", valueType: "string" },
        { name: "value", kind: "binding", description: "The numeric value of the measurement", valueType: "number" },
        {
          name: "trend",
          kind: "enum",
          description: "Direction this metric has moved",
          options: { up: "The value increased", down: "The value decreased" },
          optional: true,
        },
      ],
    }),
    new ComponentSpec({
      name: "StatusBadge",
      description: "A short categorical status word shown as a coloured pill.",
      notFor: "A numeric measurement, or a sentence of prose",
      examples: ["captured", "pending", "failed"],
      props: [
        { name: "text", kind: "binding", description: "The status word to display", valueType: "string" },
        {
          name: "variant",
          kind: "enum",
          description: "Severity colour of the badge",
          options: {
            success: "Everything is fine, completed, or healthy",
            warning: "Needs attention but is not yet failing",
            error: "Failed, rejected, or broken",
          },
        },
      ],
    }),
    new ComponentSpec({
      name: "Callout",
      description: "An aside that interrupts the flow to flag something the reader must not miss.",
      notFor: "Ordinary explanatory prose that does not need to stand out",
      examples: ["Warning: this refund is outside the 30 day window"],
      props: [
        { name: "text", kind: "binding", description: "The body of the callout", valueType: "string" },
        {
          name: "variant",
          kind: "enum",
          description: "What kind of aside this is",
          options: {
            note: "Neutral extra information the reader should be aware of",
            tip: "A helpful suggestion or shortcut that makes things easier",
            warning: "A caution about something that can go wrong or cause harm",
          },
        },
      ],
    }),
    new ComponentSpec({
      name: "TextField",
      description: "A single-line input the user types into.",
      notFor: "Displaying a value the user cannot edit",
      props: [
        { name: "label", kind: "binding", description: "The field label", valueType: "string" },
        { name: "value", kind: "binding", description: "Two-way bound path in the data model", valueType: "string" },
        {
          name: "required",
          kind: "bool",
          description: "Whether this field must be filled before submitting",
          optional: true,
        },
      ],
    }),
    new ComponentSpec({
      name: "ChoicePicker",
      description: "A control that lets the user pick from a fixed set of options.",
      notFor: "Free text entry",
      props: [
        { name: "value", kind: "binding", description: "Two-way bound path in the data model", valueType: "any" },
        {
          name: "variant",
          kind: "enum",
          description: "How many options can be selected",
          options: {
            mutuallyExclusive: "Exactly one option may be selected",
            multiSelect: "Any number of options may be selected",
          },
        },
      ],
    }),
    new ComponentSpec({
      name: "Button",
      description: "An action control the user clicks to submit or trigger something.",
      container: true,
      props: [
        {
          name: "variant",
          kind: "enum",
          description: "Visual weight of the action",
          options: {
            primary: "The main action on the surface",
            secondary: "A supporting or cancelling action",
            destructive: "An irreversible or dangerous action",
          },
        },
      ],
    }),
  ],
);
