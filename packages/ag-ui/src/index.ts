import { createHash } from "node:crypto";
import {
  type Catalog,
  type CompileOptions,
  type CompileResult,
  type PhraseBank,
  type SystemOneClient,
  compileSurface,
  isScalar,
  scalarType,
  walk,
} from "@lathe/core";
import { type GuardReport, verifySurface } from "@lathe/guard";

export type AgUiEvent =
  | {
      readonly type: "STATE_SNAPSHOT";
      readonly snapshot: unknown;
      readonly timestamp: number;
    }
  | {
      readonly type: "CUSTOM";
      readonly name: "a2ui.v0.9" | "lathe.guard";
      readonly value: Record<string, unknown>;
      readonly timestamp: number;
    };

export interface CompileToAgUiOptions extends Omit<CompileOptions, "state"> {
  readonly state: unknown;
  /** Whether to reuse cached component layout when the state shape matches (default: true). */
  readonly enableShapeCache?: boolean;
}

export interface AgUiCompiledBundle {
  readonly shapeHash: string;
  readonly cached: boolean;
  readonly compileResult: CompileResult;
  readonly guardReport: GuardReport;
  readonly events: readonly AgUiEvent[];
}

/**
 * Compute a deterministic SHA-256 fingerprint of `(catalogId, [(pointer, scalarType)])`.
 * Two JSON payloads with identical field paths and primitive types share the same shape hash,
 * even when their runtime numbers or strings differ.
 */
export function computeShapeHash(state: unknown, catalogId: string): string {
  const seen = new Set<string>();
  for (const [ptr, val] of walk(state)) {
    if (!isScalar(val)) continue;
    const tag = scalarType(val);
    const normalizedPtr = ptr.replace(/\/\d+(?=\/|$)/g, "/[*]");
    seen.add(`${normalizedPtr}:${tag}`);
  }
  const entries = [...seen].sort();
  return createHash("sha256")
    .update(`${catalogId}|${entries.join(",")}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Format an AG-UI event as a standard Server-Sent Events (SSE) frame.
 */
export function formatSseFrame(event: AgUiEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Stateful AG-UI compiler middleware with shape-level layout caching and 4-tier `@lathe/guard` verification.
 */
export class LatheAgUiMiddleware {
  readonly #catalog: Catalog;
  readonly #client: SystemOneClient;
  readonly #phraseBank: PhraseBank | undefined;
  readonly #shapeCache = new Map<string, CompileResult>();

  constructor(options: {
    catalog: Catalog;
    client: SystemOneClient;
    phraseBank?: PhraseBank;
  }) {
    this.#catalog = options.catalog;
    this.#client = options.client;
    this.#phraseBank = options.phraseBank;
  }

  get cacheSize(): number {
    return this.#shapeCache.size;
  }

  clearCache(): void {
    this.#shapeCache.clear();
  }

  /**
   * Compile an application or tool state into verified AG-UI events (`STATE_SNAPSHOT`, `a2ui.v0.9`, `lathe.guard`).
   */
  async compile(options: Omit<CompileToAgUiOptions, "catalog" | "client">): Promise<AgUiCompiledBundle> {
    const {
      state,
      surfaceId = "surface_1",
      enableShapeCache = true,
      phraseBank = this.#phraseBank,
      ...rest
    } = options;

    const shapeHash = computeShapeHash(state, this.#catalog.catalogId);
    const cachedTemplate = enableShapeCache ? this.#shapeCache.get(shapeHash) : undefined;

    let compileResult: CompileResult;
    let cached = false;

    if (cachedTemplate) {
      cached = true;
      // Reuse the compiled component structure and re-bind the fresh state into updateDataModel
      const updatedMessages = cachedTemplate.messages.map((msg) => {
        if ("updateDataModel" in msg) {
          return {
            version: "v0.9",
            updateDataModel: {
              surfaceId,
              value: state,
            },
          };
        }
        return msg;
      });
      compileResult = {
        ...cachedTemplate,
        messages: updatedMessages,
        stats: {
          ...cachedTemplate.stats,
          latencyMs: 0,
          roundTrips: 0,
          replayed: true,
        },
      };
    } else {
      compileResult = await compileSurface({
        state,
        surfaceId,
        catalog: this.#catalog,
        client: this.#client,
        phraseBank,
        ...rest,
      });
      this.#shapeCache.set(shapeHash, compileResult);
    }

    // Always run @lathe/guard against the current state values (e.g. to catch newly injected XSS URLs)
    const guardReport = await verifySurface({
      messages: compileResult.messages,
      state,
      catalog: this.#catalog,
      phraseBank,
      schema: rest.schema,
      client: this.#client,
    });

    const now = Date.now();
    const events: AgUiEvent[] = [
      {
        type: "STATE_SNAPSHOT",
        snapshot: state,
        timestamp: now,
      },
      {
        type: "CUSTOM",
        name: "a2ui.v0.9",
        value: {
          surfaceId,
          shapeHash,
          cached,
          messages: guardReport.sanitizedMessages,
          calibration: compileResult.calibration,
          stats: compileResult.stats,
        },
        timestamp: now,
      },
      {
        type: "CUSTOM",
        name: "lathe.guard",
        value: {
          surfaceId,
          ok: guardReport.ok,
          findings: guardReport.findings,
        },
        timestamp: now,
      },
    ];

    return {
      shapeHash,
      cached,
      compileResult,
      guardReport,
      events,
    };
  }
}
