/**
 * @lathe/typesafe — official `@typesafe-ai/sdk` adapter for `@lathe/core`.
 *
 * Delegates all HTTP transport, authentication, exponential-backoff retries, jitter,
 * and `Retry-After` handling to `@typesafe-ai/sdk`'s `TypeSafeClient`.
 *
 * `@lathe/core` stays vendor-neutral and dependency-free; this package is the 40-line
 * bridge that plugs the official SDK into `compileSurface()`.
 */

import {
  TypeSafeClient,
  type EntryType,
  type Questions,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import {
  DEFAULT_MODEL,
  type Answer,
  type Question,
  type SystemOneClient,
  type SystemOneResponse,
} from "@lathe/core";

export interface TypeSafeAdapterOptions extends TypeSafeClientConfig {
  /**
   * Model to evaluate questions against. Defaults to {@link DEFAULT_MODEL} (`"jev-1.13.0"`),
   * pinned deliberately rather than `"jev-latest"` so confidence thresholds do not shift
   * underneath a deployed catalog.
   */
  model?: string;
}

export class TypeSafeAdapter implements SystemOneClient {
  readonly model: string;
  readonly #sdk: TypeSafeClient;

  constructor(options: TypeSafeAdapterOptions = {}) {
    const { model = DEFAULT_MODEL, ...sdkConfig } = options;
    this.model = model;
    this.#sdk = new TypeSafeClient({ defaultModel: model, ...sdkConfig });
  }

  async systemOne(
    state: unknown,
    questions: Record<string, Question>,
  ): Promise<SystemOneResponse> {
    const started = performance.now();
    const result = await this.#sdk.systemOne({
      state: state as EntryType,
      questions: questions as unknown as Questions,
      model: this.model,
    });
    const latencyMs = performance.now() - started;

    const answers: Record<string, Answer> = {};
    for (const [key, raw] of Object.entries(result.answers)) {
      if (raw.type === "noul") {
        answers[key] = { type: "noul", noul: raw.noul };
      } else if (raw.type === "choice") {
        answers[key] = {
          type: "choice",
          choice: raw.choice,
          confidence: raw.confidence,
          probabilities: { ...raw.probabilities },
        };
      } else if (raw.type === "score") {
        const legend: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(raw.legend)) legend[String(k)] = v;
        const probabilities: Record<string, number> = {};
        for (const [k, v] of Object.entries(raw.probabilities)) probabilities[String(k)] = v;
        answers[key] = {
          type: "score",
          score: raw.score,
          confidence: raw.confidence,
          legend,
          probabilities,
        };
      }
    }

    return {
      answers,
      model: result.model,
      latencyMs,
      inputTokens: result.usage?.input_tokens ?? 0,
      outputTokens: result.usage?.output_tokens ?? 0,
      replayed: false,
    };
  }
}

export { TypeSafeClient } from "@typesafe-ai/sdk";
