/**
 * @lathe/core — compile A2UI surfaces from a catalog and a state.
 *
 * Nothing in this package generates text. See {@link compileSurface}.
 */

export {
  type Scalar,
  type ValueTypeTag,
  canonicalString,
  isScalar,
  preview,
  scalarType,
} from "./canonical.ts";

export {
  type Json,
  type LeafOptions,
  escapeToken,
  exists,
  joinPointer,
  leaves,
  resolve,
  stringValues,
  unescapeToken,
  walk,
} from "./pointers.ts";

export {
  type ComponentSpecInit,
  type PropKind,
  type PropSpecInit,
  type SinkClass,
  type ValueType,
  BASIC_CATALOG,
  Catalog,
  ComponentSpec,
  PropSpec,
} from "./catalog.ts";

export {
  type Answer,
  type ChoiceAnswer,
  type NoulAnswer,
  type Question,
  type Recording,
  type ScoreAnswer,
  type ScoreAnswer as Score,
  type SystemOneClient,
  type SystemOneResponse,
  DEFAULT_MODEL,
  MAX_CHOICE_OPTIONS,
  ReplayClient,
  choice,
  noul,
  ranked,
  score,
  topGap,
} from "./client.ts";

export {
  type Block,
  type ColumnSummary,
  type CompileOptions,
  type CompileResult,
  type CompileStats,
  type ComponentCalibration,
  type Mode,
  type PropRef,
  type PropRole,
  AMBIGUOUS_MARGIN,
  CompilePlan,
  MAX_BINDING_CANDIDATES,
  compileSurface,
  deriveBlocks,
  isAmbiguous,
} from "./compiler.ts";

export {
  type PhraseEntry,
  type SchemaFieldConstraint,
  PhraseBank,
  humanizePointer,
  schemaConstraintForPointer,
  schemaTitleForPointer,
  swapSurfaceLocale,
} from "./phrases.ts";

export {
  type LintCode,
  type LintFinding,
  type LintOptions,
  type LintReport,
  type LintSeverity,
  lintCatalog,
} from "./linter.ts";
