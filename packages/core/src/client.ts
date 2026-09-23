/**
 * Selection-model client.
 *
 * Three implementations, deliberately:
 *
 * - {@link HttpSystemOneClient} — talks to the real API over `fetch`. No SDK, no deps.
 * - {@link ReplayClient} — returns pre-recorded answers. Hermetic, free, deterministic.
 *   This is what conformance fixtures run against, and it is the reason the TypeScript
 *   and Python implementations can be proven to agree.
 * - *(no stub here)* — see the note below.
 *
 * ## Why there is no heuristic stub in this package
 *
 * The Python prototype shipped a keyword-overlap stub so the pipeline was runnable with no
 * key. It nearly caused fabricated numbers to be reported as real model output, twice,
 * because two separate code paths silently fell back to it.
 *
 * A stub that produces *plausible-looking* numbers is a liability in a project whose entire
 * claim is "this system cannot fabricate". {@link ReplayClient} gives the same hermetic
 * testing benefit with none of the risk: it can only return answers a real model actually
 * produced, and it throws on anything it was not given.
 */

export interface NoulAnswer {
  readonly type: "noul";
  readonly noul: number;
}

export interface ChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly type: "score";
  readonly score: number;
  readonly legend: Readonly<Record<string, unknown>>;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** Options ranked by probability, descending. Ties break by key for determinism. */
export function ranked(answer: ChoiceAnswer): Array<[string, number]> {
  return Object.entries(answer.probabilities).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

/** Margin between the top two options. A small gap means the choice was nearly a coin flip. */
export function topGap(answer: ChoiceAnswer): number {
  const r = ranked(answer);
  if (r.length === 0) return 0;
  const first = r[0]![1];
  return r.length > 1 ? first - r[1]![1] : first;
}

export interface SystemOneResponse {
  readonly answers: Record<string, Answer>;
  readonly model: string;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** True only if the answers did not come from a live model. Never fabricate this. */
  readonly replayed: boolean;
}

export type Question =
  | { type: "noul"; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: unknown[] };

export interface SystemOneClient {
  systemOne(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse>;
}

// ---------------------------------------------------------------------------
// Question builders
// ---------------------------------------------------------------------------

export const MAX_CHOICE_OPTIONS = 255;
export const MIN_SCORE_LEVELS = 2;
export const MAX_SCORE_LEVELS = 10;

export function noul(
  instructions: unknown,
  criteria?: { true?: unknown; false?: unknown },
): Question {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}

export function choice(instructions: unknown, criteria: Record<string, unknown>): Question {
  const n = Object.keys(criteria).length;
  if (n === 0) throw new Error("Choice requires at least one option");
  if (n > MAX_CHOICE_OPTIONS) {
    throw new Error(`Choice supports at most ${MAX_CHOICE_OPTIONS} options, got ${n}`);
  }
  return { type: "choice", instructions, criteria };
}

export function score(instructions: unknown, criteria: unknown[]): Question {
  if (criteria.length < MIN_SCORE_LEVELS || criteria.length > MAX_SCORE_LEVELS) {
    throw new Error(
      `Score requires ${MIN_SCORE_LEVELS}..${MAX_SCORE_LEVELS} levels, got ${criteria.length}`,
    );
  }
  return { type: "score", instructions, criteria };
}

// ---------------------------------------------------------------------------
// Pinned default model
// ---------------------------------------------------------------------------

/**
 * Pinned on purpose.
 *
 * `jev-latest` is an alias. Confidence thresholds are tuned against a specific model's
 * calibration curve, so an alias silently re-tunes them underneath you on release day.
 * Bump this deliberately, and re-run the calibration harness when you do.
 */
export const DEFAULT_MODEL = "jev-1.13.0";

// ---------------------------------------------------------------------------
// Replay client
// ---------------------------------------------------------------------------

export interface Recording {
  /** Question id -> the answer a real model gave. */
  answers: Record<string, Answer>;
  model?: string;
}

/**
 * Replays recorded answers.
 *
 * Strict by design: asking a question the recording does not contain is an error, not a
 * default. A silent default would let the two implementations diverge in exactly the place
 * conformance is supposed to detect.
 */
export class ReplayClient implements SystemOneClient {
  readonly #recording: Recording;
  readonly #asked: Set<string> = new Set();

  constructor(recording: Recording) {
    this.#recording = recording;
  }

  /** Question ids present in the recording but never asked. A drift signal. */
  unusedAnswers(): string[] {
    return Object.keys(this.#recording.answers).filter((k) => !this.#asked.has(k));
  }

  systemOne(_state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse> {
    const answers: Record<string, Answer> = {};
    const missing: string[] = [];
    for (const qid of Object.keys(questions)) {
      const recorded = this.#recording.answers[qid];
      if (recorded === undefined) {
        missing.push(qid);
        continue;
      }
      this.#asked.add(qid);
      answers[qid] = recorded;
    }
    if (missing.length > 0) {
      throw new Error(
        `ReplayClient has no recorded answer for ${missing.length} question(s): ` +
          missing.slice(0, 5).join(", ") +
          (missing.length > 5 ? ", ..." : "") +
          ". The compiler asked something the recording does not cover, which means the " +
          "implementations have drifted or the fixture is stale.",
      );
    }
    return Promise.resolve({
      answers,
      model: this.#recording.model ?? "replay",
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      replayed: true,
    });
  }
}
