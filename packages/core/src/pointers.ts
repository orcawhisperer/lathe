/**
 * RFC 6901 JSON Pointer helpers.
 *
 * These matter more than they look. A2UI binds every dynamic prop to a JSON Pointer
 * (`{"path": "/order/amount_usd"}`) rather than to a generated string. So the question
 * "what text goes in this component?" becomes "which existing pointer binds here?" — a
 * closed-set Choice, not a generation task.
 *
 * That substitution is the entire reason a non-generative model can drive a UI.
 */

import { type Scalar, type ValueTypeTag, canonicalString, isScalar, scalarType } from "./canonical.ts";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** RFC 6901 §3: `~` -> `~0`, `/` -> `~1`. Order matters. */
export function escapeToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Inverse of {@link escapeToken}. `~1` must be undone before `~0`. */
export function unescapeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function joinPointer(...tokens: Array<string | number>): string {
  return tokens.map((t) => "/" + escapeToken(String(t))).join("");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve a pointer against a document.
 *
 * Returns `undefined` for a missing segment. Note that this is deliberately distinct from
 * a resolved JSON `null`: callers need to tell "absent" apart from "present and null",
 * and conflating them would let a dangling pointer masquerade as a legitimate null.
 *
 * @throws if the pointer is not absolute, which indicates a caller bug rather than missing data.
 */
export function resolve(document: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return document;
  if (!pointer.startsWith("/")) {
    throw new Error(`not an absolute JSON Pointer: ${JSON.stringify(pointer)}`);
  }
  let node: unknown = document;
  for (const raw of pointer.split("/").slice(1)) {
    const token = unescapeToken(raw);
    if (isPlainObject(node)) {
      // `Object.hasOwn` rather than `in`, so a key like "constructor" or "__proto__"
      // cannot resolve to something off the prototype chain.
      if (!Object.hasOwn(node, token)) return undefined;
      node = node[token];
    } else if (Array.isArray(node)) {
      // RFC 6901 array indices are unsigned decimal with no leading zeros.
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
      const index = Number(token);
      if (index >= node.length) return undefined;
      node = node[index];
    } else {
      return undefined;
    }
  }
  return node;
}

/** Whether a pointer addresses an existing location, including one holding `null`. */
export function exists(document: unknown, pointer: string): boolean {
  if (pointer === "" || pointer === "/") return true;
  if (!pointer.startsWith("/")) return false;
  const cut = pointer.lastIndexOf("/");
  const parentPointer = pointer.slice(0, cut);
  const token = unescapeToken(pointer.slice(cut + 1));
  const parent = resolve(document, parentPointer === "" ? "/" : parentPointer);
  if (isPlainObject(parent)) return Object.hasOwn(parent, token);
  if (Array.isArray(parent)) {
    return /^(0|[1-9][0-9]*)$/.test(token) && Number(token) < parent.length;
  }
  return false;
}

/** Yield `[pointer, value]` for every node in the document, depth first, in document order. */
export function* walk(document: unknown, prefix = ""): Generator<[string, unknown]> {
  if (isPlainObject(document)) {
    for (const [key, value] of Object.entries(document)) {
      const child = prefix + joinPointer(key);
      yield [child, value];
      yield* walk(value, child);
    }
  } else if (Array.isArray(document)) {
    for (let index = 0; index < document.length; index++) {
      const child = prefix + joinPointer(index);
      yield [child, document[index]];
      yield* walk(document[index], child);
    }
  }
}

export interface LeafOptions {
  /** Filter to what a prop can accept. `"any"` keeps every scalar. */
  valueType?: ValueTypeTag | "any";
  /** Skip long strings; they make poor binding candidates and bloat the question. */
  maxStringLength?: number;
}

/** Every scalar leaf, as `[pointer, value]`. These are the binding candidates. */
export function leaves(
  document: unknown,
  { valueType = "any", maxStringLength = 400 }: LeafOptions = {},
): Array<[string, Scalar]> {
  const out: Array<[string, Scalar]> = [];
  for (const [pointer, value] of walk(document)) {
    if (!isScalar(value)) continue;
    const kind = scalarType(value);
    if (valueType !== "any" && kind !== valueType) continue;
    if (kind === "string" && (value as string).length > maxStringLength) continue;
    out.push([pointer, value]);
  }
  return out;
}

/**
 * Every scalar in the document, in canonical string form.
 *
 * The guard uses this to answer, in code and for free, "did the model invent this
 * literal?" A string in this set provably came from the source document.
 */
export function stringValues(document: unknown): Set<string> {
  const found = new Set<string>();
  for (const [, value] of walk(document)) {
    if (isScalar(value)) found.add(canonicalString(value));
  }
  return found;
}
