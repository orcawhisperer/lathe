/**
 * Phrase bank & deterministic label derivation (`kind: "phrase"`).
 *
 * ## Why this exists
 *
 * Every UI surface needs short pieces of chrome copy that do not live in the data model:
 * card titles, field labels, alert headings, button captions. Asking an LLM to write them
 * reintroduces the exact failure mode Compiled UI exists to eliminate (invented policies,
 * misleading button labels, prompt-injected instructions rendered as UI chrome).
 *
 * Real applications already have a bounded, human-reviewed set of strings: their **i18n
 * translation catalog** (and, secondarily, JSON Schema `title` annotations).
 *
 * By making `kind: "phrase"` a `Choice` over a {@link PhraseBank} — with a deterministic
 * fallback to JSON Schema `title` or humanized JSON Pointer segment — the compiler keeps
 * its structural invariant all the way to the last label:
 *
 *   - Every rendered character comes from the state, the i18n catalog, or the schema.
 *   - Every surface is localizable for free (the renderer can resolve `phraseKey` per locale).
 */

export interface PhraseEntry {
  /** Stable i18n key, e.g. `"order.amount_charged"` or `"actions.issue_refund"`. */
  readonly key: string;
  /** Default-locale string rendered in the surface and read by the selection model. */
  readonly text: string;
  /** Optional hint explaining when this phrase applies. */
  readonly notFor?: string;
  /** Optional locale map (e.g., `{ es: "Monto cobrado", ja: "請求額", de: "Berechneter Betrag" }`). */
  readonly translations?: Readonly<Record<string, string>>;
}

export class PhraseBank {
  readonly entries: ReadonlyMap<string, PhraseEntry>;

  constructor(entries: Iterable<PhraseEntry> | Record<string, string | Omit<PhraseEntry, "key">>) {
    const map = new Map<string, PhraseEntry>();
    if (Symbol.iterator in Object(entries)) {
      for (const e of entries as Iterable<PhraseEntry>) {
        map.set(e.key, e);
      }
    } else {
      for (const [key, val] of Object.entries(entries)) {
        if (typeof val === "string") {
          map.set(key, { key, text: val });
        } else {
          map.set(key, { key, ...val });
        }
      }
    }
    this.entries = map;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): PhraseEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * Resolve the localized string for `key` in `locale` (falling back to default `text`).
   */
  textForLocale(key: string, locale = "en"): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (!locale || locale === "en") return entry.text;
    return entry.translations?.[locale] ?? entry.text;
  }

  /**
   * Build the TypeSafe `Choice` criteria map for phrase selection.
   * Includes `__auto__` so the model can abstain when no i18n key fits and let the
   * deterministic schema/path humanizer supply the label.
   */
  choiceCriteria(maxOptions = 250): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (count >= maxOptions) break;
      const crit: Record<string, unknown> = { what: entry.text, key };
      if (entry.notFor) crit["not_for"] = entry.notFor;
      out[key] = crit;
      count++;
    }
    out["__auto__"] = {
      what: "Derive the label automatically from the field's schema title or JSON path",
      not_for: "Any case where one of the listed i18n phrase keys specifically matches this field",
    };
    return out;
  }
}

/** Uppercase acronyms that should stay uppercase when a pointer segment is humanized. */
const UPPER_ACRONYMS: ReadonlySet<string> = new Set([
  "id",
  "usd",
  "eur",
  "gbp",
  "inr",
  "jpy",
  "url",
  "uri",
  "api",
  "ip",
  "cpu",
  "gpu",
  "ram",
  "eta",
  "sla",
  "vat",
  "ssn",
  "pin",
  "otp",
  "mfa",
  "pii",
  "sku",
  "qty",
]);

/**
 * Deterministically turn a JSON Pointer like `"/order/duplicate_amount_usd"` into a clean
 * human label (`"Duplicate amount (USD)"`) with zero model calls and zero generation.
 */
export function humanizePointer(pointer: string): string {
  const segments = pointer
    .split("/")
    .filter((s) => s.length > 0 && !/^\d+$/.test(s))
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));

  const last = segments.at(-1) ?? "Value";
  const rawTokens = last
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-\s./]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  if (rawTokens.length === 0) return "Value";

  // Trailing currency / unit code becomes a parenthetical suffix: `amount_usd` -> `Amount (USD)`
  let suffix = "";
  if (
    rawTokens.length > 1 &&
    ["usd", "eur", "gbp", "inr", "jpy", "ms", "sec", "days", "pct"].includes(rawTokens.at(-1)!)
  ) {
    const unit = rawTokens.pop()!;
    suffix = ` (${unit.toUpperCase()})`;
  }

  const words = rawTokens.map((tok, idx) => {
    if (UPPER_ACRONYMS.has(tok)) return tok.toUpperCase();
    if (idx === 0) return tok.charAt(0).toUpperCase() + tok.slice(1);
    return tok;
  });

  return words.join(" ") + suffix;
}

export interface SchemaFieldConstraint {
  readonly title?: string;
  readonly description?: string;
  readonly enumOptions?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly multiline?: boolean;
  readonly readOnly?: boolean;
}

/**
 * Look up JSON Schema constraints (`title`, `description`, `enum`, `minimum`/`maximum`, `multiline`)
 * corresponding to an RFC 6901 JSON Pointer.
 */
export function schemaConstraintForPointer(
  schema: Record<string, unknown> | undefined,
  pointer: string,
): SchemaFieldConstraint | undefined {
  if (!schema) return undefined;
  const segments = pointer
    .split("/")
    .slice(1)
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));

  let current: unknown = schema;
  for (const seg of segments) {
    if (typeof current !== "object" || current === null) return undefined;
    const obj = current as Record<string, unknown>;
    if (obj["type"] === "array" && typeof obj["items"] === "object" && obj["items"] !== null) {
      current = obj["items"];
      continue;
    }
    const props = obj["properties"];
    if (typeof props === "object" && props !== null && seg in (props as Record<string, unknown>)) {
      current = (props as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  if (typeof current !== "object" || current === null) return undefined;
  const node = current as Record<string, unknown>;

  const title =
    typeof node["title"] === "string" && node["title"].trim() !== ""
      ? node["title"].trim()
      : undefined;
  const description =
    typeof node["description"] === "string" && node["description"].trim() !== ""
      ? node["description"].trim()
      : undefined;
  const enumOptions = Array.isArray(node["enum"])
    ? (node["enum"] as unknown[]).map((v) => String(v))
    : undefined;
  const minimum = typeof node["minimum"] === "number" ? node["minimum"] : undefined;
  const maximum = typeof node["maximum"] === "number" ? node["maximum"] : undefined;
  const maxLength = typeof node["maxLength"] === "number" ? node["maxLength"] : undefined;
  const multiline =
    node["multiline"] === true ||
    node["format"] === "textarea" ||
    (maxLength !== undefined && maxLength >= 120);
  const readOnly = node["readOnly"] === true ? true : undefined;

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(enumOptions ? { enumOptions } : {}),
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(multiline ? { multiline: true } : {}),
    ...(readOnly ? { readOnly: true } : {}),
  };
}

/**
 * Look up a `title` annotation in an optional JSON Schema corresponding to a JSON Pointer.
 */
export function schemaTitleForPointer(
  schema: Record<string, unknown> | undefined,
  pointer: string,
): string | undefined {
  return schemaConstraintForPointer(schema, pointer)?.title;
}

/**
 * Re-localize an already-compiled A2UI v0.9 message array into `locale` in 0ms with 0 model calls.
 * Resolves both explicit `_lathe` phrase keys and any component string prop matching a `PhraseBank` entry.
 */
export function swapSurfaceLocale(
  messages: readonly Record<string, unknown>[],
  phraseBank: PhraseBank,
  locale: string,
): Record<string, unknown>[] {
  const textToKey = new Map<string, string>();
  for (const [key, entry] of phraseBank.entries) {
    textToKey.set(entry.text, key);
    if (entry.translations) {
      for (const trans of Object.values(entry.translations)) {
        textToKey.set(trans, key);
      }
    }
  }

  return messages.map((msg) => {
    const updateComponents = msg["updateComponents"] as Record<string, unknown> | undefined;
    if (!updateComponents || !Array.isArray(updateComponents["components"])) {
      return msg;
    }
    const nextComponents = (updateComponents["components"] as Record<string, unknown>[]).map(
      (comp) => {
        let updated: Record<string, unknown> | undefined;

        // 1. Direct reverse-lookup of any string prop or column header matching a PhraseBank entry
        for (const [k, v] of Object.entries(comp)) {
          if (k === "id" || k === "component" || k === "_lathe") continue;
          if (typeof v === "string") {
            const matchedKey = textToKey.get(v);
            if (matchedKey) {
              const localized = phraseBank.textForLocale(matchedKey, locale);
              if (localized && localized !== v) {
                updated ??= { ...comp };
                updated[k] = localized;
              }
            }
          } else if (k === "columns" && Array.isArray(v)) {
            let colsChanged = false;
            const nextCols = v.map((col: unknown) => {
              if (typeof col !== "object" || col === null) return col;
              const colObj = col as Record<string, unknown>;
              const header = colObj["header"];
              const keyStr = typeof colObj["key"] === "string" ? colObj["key"] : "";
              const matchedKey =
                (typeof header === "string" ? textToKey.get(header) : undefined) ??
                (phraseBank.get(keyStr) ? keyStr : undefined);
              if (matchedKey) {
                const localized = phraseBank.textForLocale(matchedKey, locale);
                if (localized && localized !== header) {
                  colsChanged = true;
                  return { ...colObj, header: localized };
                }
              }
              return col;
            });
            if (colsChanged) {
              updated ??= { ...comp };
              updated["columns"] = nextCols;
            }
          }
        }

        // 2. Also check _lathe.selectionTrace if present
        const meta = comp["_lathe"] as Record<string, unknown> | undefined;
        const trace = meta?.["selectionTrace"] as Record<string, unknown> | undefined;
        if (trace) {
          const blockId = String(comp["id"] ?? "");
          const prefix = `prop_phrase_${blockId}_`;
          for (const [qName, ans] of Object.entries(trace)) {
            if (!qName.startsWith(prefix) || typeof ans !== "object" || ans === null) continue;
            const propName = qName.slice(prefix.length);
            const choice = String((ans as Record<string, unknown>)["choice"] ?? "");
            if (choice && choice !== "__auto__") {
              const localized = phraseBank.textForLocale(choice, locale);
              if (localized) {
                updated ??= { ...comp };
                updated[propName] = localized;
              }
            }
          }
        }
        return updated ?? comp;
      },
    );
    return {
      ...msg,
      updateComponents: {
        ...updateComponents,
        components: nextComponents,
      },
    };
  });
}

