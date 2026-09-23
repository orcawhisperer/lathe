/**
 * Canonical scalar formatting.
 *
 * ## Why this file exists
 *
 * The compiler embeds stringified scalars in three places that must be identical across
 * every implementation of the spec:
 *
 *   1. binding-choice `examples` (`"The value at /order/amount_usd"` -> `"49"`)
 *   2. block previews inside question instructions
 *   3. the guard's set of "strings that provably came from the source document"
 *
 * If two implementations disagree on how to render `49.0`, they will send different
 * question text to the model and the guard will disagree about what counts as fabricated.
 * That is a correctness bug, not a cosmetic one.
 *
 * ## The hazard
 *
 * Python and JavaScript do not agree out of the box:
 *
 * | value        | Python `str()` | JS `String()` |
 * |--------------|----------------|---------------|
 * | `49.0`       | `"49.0"`       | `"49"`        |
 * | `True`       | `"True"`       | `"true"`      |
 * | `1e21`       | `"1e+21"`      | `"1e+21"`     |
 *
 * Worse, the distinction between `49` and `49.0` **does not survive JSON at all** in JS:
 * both parse to the same `number`. So "match Python" is not an achievable target.
 *
 * ## The rule
 *
 * The spec defines canonical form as **JSON's own number grammar**, which is exactly what
 * ECMAScript `Number::toString` produces: the shortest representation that round-trips.
 * Booleans are lowercase, matching JSON literals. Implementations in other languages must
 * conform to this, rather than to their own native `str()`.
 *
 * Non-finite numbers have no JSON representation. They cannot appear in a parsed document,
 * but they can appear in a hand-built one, so they are rejected loudly rather than silently
 * becoming `"NaN"` — a string that would then be indistinguishable from source text.
 */

export type Scalar = string | number | boolean;

/** True for values that may become a block or a binding candidate. */
export function isScalar(value: unknown): value is Scalar {
  const t = typeof value;
  return t === "string" || t === "boolean" || (t === "number" && Number.isFinite(value));
}

/**
 * Render a scalar in canonical form.
 *
 * @throws if given a non-finite number, which has no JSON representation.
 */
export function canonicalString(value: Scalar): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `canonicalString: ${String(value)} has no JSON representation. ` +
        "Non-finite numbers cannot appear in a conformant document.",
    );
  }
  return String(value);
}

/** The value-type tag used to filter binding candidates. */
export type ValueTypeTag = "string" | "number" | "boolean";

export function scalarType(value: Scalar): ValueTypeTag {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

/**
 * Truncate for display inside question instructions.
 *
 * Uses a single-character ellipsis so the budget is measured in code points, not bytes.
 */
export function preview(value: Scalar, limit = 120): string {
  const text = canonicalString(value);
  // Count by code point: slicing by UTF-16 unit can split a surrogate pair and produce
  // a lone surrogate, which is not valid UTF-8 and would corrupt the request body.
  const points = Array.from(text);
  if (points.length <= limit) return text;
  return points.slice(0, limit - 1).join("") + "\u2026";
}
