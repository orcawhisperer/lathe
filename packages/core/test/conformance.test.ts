/**
 * Cross-implementation conformance.
 *
 * Each fixture in `spec/conformance/fixtures` was produced by the Python reference
 * implementation and contains real recorded model answers. This test replays them through
 * the TypeScript compiler and asserts two things:
 *
 *   1. the **questions** are identical — catches drift in instruction text, criteria,
 *      option ordering, and scalar formatting;
 *   2. the **messages** are identical — catches drift in assembly, ids, and props.
 *
 * Checking only (2) would be far too weak. `ReplayClient` keys on question *id*, so a
 * divergence in question *text* would be invisible in the surface — and question text is
 * exactly where the Python/JavaScript number-formatting hazard lives.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { BASIC_CATALOG, type Catalog } from "../src/catalog.ts";
import { type Question, type Recording, type SystemOneResponse, ReplayClient } from "../src/client.ts";
import { compileSurface, type Mode } from "../src/compiler.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "..", "..", "..", "spec", "conformance", "fixtures");

const CATALOGS: Record<string, Catalog> = { basic: BASIC_CATALOG };

interface Fixture {
  name: string;
  why: string;
  input: {
    catalog: string;
    state: unknown;
    intent: string;
    surfaceId: string;
    mode: Mode;
  };
  questions: Record<string, Question>;
  recording: Recording;
  expected: {
    messages: Array<Record<string, unknown>>;
    excluded: string[];
    mode: Mode;
  };
}

/** Replays recorded answers while capturing exactly what was asked. */
class CapturingReplayClient {
  readonly asked: Record<string, Question> = {};
  readonly #inner: ReplayClient;

  constructor(recording: Recording) {
    this.#inner = new ReplayClient(recording);
  }

  systemOne(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse> {
    Object.assign(this.asked, questions);
    return this.#inner.systemOne(state, questions);
  }
}

function loadFixtures(): Fixture[] {
  let names: string[];
  try {
    names = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).sort();
  } catch {
    throw new Error(
      `No fixture directory at ${FIXTURE_DIR}. Regenerate with:\n` +
        "  TYPESAFE_API_KEY=... python export_fixtures.py <lathe>/spec/conformance/fixtures",
    );
  }
  if (names.length === 0) throw new Error(`No fixtures found in ${FIXTURE_DIR}`);
  return names.map((n) => JSON.parse(readFileSync(join(FIXTURE_DIR, n), "utf8")) as Fixture);
}

/** Report the first differing key path, which is far more useful than a whole-object dump. */
function firstDifference(a: unknown, b: unknown, path = ""): string | null {
  if (Object.is(a, b)) return null;
  const bothObjects =
    typeof a === "object" && a !== null && typeof b === "object" && b !== null;
  if (!bothObjects) {
    return `${path || "<root>"}\n    reference: ${JSON.stringify(a)}\n    ours:      ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array/object mismatch`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const sub = firstDifference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
    );
    if (sub) return sub;
  }
  return null;
}

for (const fixture of loadFixtures()) {
  test(`conformance: ${fixture.name}`, async () => {
    const catalog = CATALOGS[fixture.input.catalog];
    assert.ok(catalog, `fixture references unknown catalog ${fixture.input.catalog}`);

    const client = new CapturingReplayClient(fixture.recording);
    const result = await compileSurface({
      catalog,
      state: fixture.input.state,
      intent: fixture.input.intent,
      surfaceId: fixture.input.surfaceId,
      mode: fixture.input.mode,
      client,
    });

    // 1. Same questions.
    const qDiff = firstDifference(fixture.questions, client.asked);
    assert.equal(
      qDiff,
      null,
      `question payload diverged from the reference implementation at:\n  ${qDiff}\n` +
        `  (${fixture.why})`,
    );

    // 2. Same surface.
    const mDiff = firstDifference(fixture.expected.messages, result.messages);
    assert.equal(mDiff, null, `emitted messages diverged at:\n  ${mDiff}`);

    assert.deepStrictEqual(result.excluded, fixture.expected.excluded, "excluded blocks differ");
    assert.equal(result.mode, fixture.expected.mode, "compile mode differs");
  });
}

test("conformance: the data model is the input state, unmodified", async () => {
  for (const fixture of loadFixtures()) {
    const catalog = CATALOGS[fixture.input.catalog]!;
    const result = await compileSurface({
      catalog,
      state: fixture.input.state,
      intent: fixture.input.intent,
      surfaceId: fixture.input.surfaceId,
      mode: fixture.input.mode,
      client: new ReplayClient(fixture.recording),
    });

    const update = result.messages.find((m) => "updateDataModel" in m) as
      | { updateDataModel: { value: Record<string, unknown> } }
      | undefined;
    assert.ok(update, `${fixture.name}: no updateDataModel message`);

    // `intent` is added by the compiler; everything else must be byte-identical to input.
    const { intent: _intent, ...emitted } = update.updateDataModel.value;
    assert.deepStrictEqual(
      emitted,
      fixture.input.state,
      `${fixture.name}: the data model is not a verbatim copy of the input state. ` +
        "This is the single invariant the whole project rests on.",
    );
  }
});
