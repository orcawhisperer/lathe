# Lathe v0.9 Specification — Non-Generative A2UI Compilation Standard

**Status:** Draft Standard (`v0.9`)  
**Protocols:** AG-UI (`@ag-ui/core`) · A2UI `v0.9` · TypeSafe System One (`jev-1.13.0`)  
**License:** Apache-2.0

---

## 1. Abstract & Core Invariant

**Lathe** defines a deterministic, non-generative compilation standard for turning structured agent state (`JSON` + optional `JSON Schema`) into interactive **A2UI v0.9** user interface surfaces transported over **AG-UI** streams.

### 1.1 The Zero-Generation Invariant

A conforming Lathe compiler **MUST NOT** invoke a generative language model to emit freeform UI text, HTML, JSX, JSON, or prop strings. Every character and property in a compiled A2UI `updateComponents` surface **MUST** originate from one of four closed sources:

1. **RFC 6901 JSON Pointer Data Binding** (`{"path": "/order/duplicate_amount_usd"}`) — bound directly to the verbatim `updateDataModel` payload.
2. **Closed-Set Selection (`Choice` / `Noul` / `Score`)** — selected by a calibrated non-generative selection model (`TypeSafe System One`) over finite, schema-defined options (`component`, `variant`, `format`, `density`, `children` grouping).
3. **Approved i18n `PhraseBank` Key (`kind: "phrase"`)** — selected via `Choice` over human-reviewed translation keys (`order.amount_usd`, `action.approve_refund`), enabling `0ms`, `0-model-call` locale switching (`swapSurfaceLocale`).
4. **Deterministic Schema / Path Derivation** — derived without model calls from JSON Schema `title` annotations or RFC 6901 pointer humanization (`humanizePointer`).

---

## 2. Canonical Scalar Serialization (`canonicalString`)

Because selection models read a canonicalized `blocks` index of the application state, cross-language implementations (TypeScript, Python, Rust, Go) **MUST** serialize scalars identically so that question payloads and replay recordings are byte-for-byte identical:

- `null` $\rightarrow$ `"null"`
- `boolean` $\rightarrow$ `"true"` | `"false"`
- `number`:
  - Finite integers (`Number.isInteger(n)`) $\rightarrow$ base-10 integer string (`149.0` $\rightarrow$ `"149"`).
  - Non-integer floats $\rightarrow$ shortest round-trippable IEEE-754 decimal representation (`19.99` $\rightarrow$ `"19.99"`).
- `string` $\rightarrow$ UTF-8 string truncated at `MAX_PREVIEW_CHARS` (`120` codepoints) with `"…"` suffix when truncated.

---

## 3. Block Discovery & Homogeneous Collection Collapsing (`deriveBlocks`)

Given a root JSON value `state` and optional JSON Schema `schema`:

1. **Scalar Leaf Discovery**:
   - Traverse `state` in deterministic key order, emitting an RFC 6901 JSON Pointer for each scalar (`number`, `boolean`, `string`).
   - When `formAware: true`, empty strings (`""`) **MUST** be retained as `emptyField: true` blocks so user-editable form fields (`Textarea`, `Input`, `Select`) are compiled rather than dropped.
2. **Homogeneous Object Array Collapsing (`collapseCollections: true`)**:
   - When an array at pointer `/p` has $\ge 2$ elements that are plain objects sharing $\ge 50\%$ of scalar keys (`K_common`), the compiler **MUST** collapse `/p` into a single `CollectionBlock` (`kind: "collection"`, `valueType: "collection"`) rather than exploding `/p/0/k`, `/p/1/k`, ... into $N \times M$ scalar blocks.
   - Column metadata (`ColumnSummary[]`: `key`, `valueType`, `sampleValues`, `header`) is extracted in $O(M_{\text{cols}})$ questions (`col_format_<blockId>_<key>`).
3. **JSON Schema Constraint Tagging (`schemaConstraintForPointer`)**:
   - If a JSON Schema is provided for pointer `/p`, `deriveBlocks` attaches `allowedEnumChoices` (`enum`), `editableRangeBounds` (`minimum`/`maximum`), and `multilineTextField` (`multiline: true` or `maxLength >= 120`) to the block summary so System One routes constrained fields to `Select`, `Slider`, and `Textarea`.

---

## 4. Compilation Modes & Calibration Telemetry

### 4.1 Staged Compilation (`2` Round Trips)
- **Stage 1 (`include_*` + `comp_*` + `group_*`)**: Queries System One in a single batch for block inclusion (`Noul`), component choice (`Choice`), and adjacent-block `Card` grouping (`Noul`).
- **Stage 2 (`prop_*` + `stated_*` + `col_format_*`)**: Queries System One only for the winning component's props (`Choice`, `Noul`, `Score`, `PhraseBank`).

### 4.2 Speculative Compilation (`1` Round Trip)
- Batches Stage 1 and Stage 2 questions for all type-compatible components in a single HTTP request when total questions $\le$ `questionBudget` (`600`).

### 4.3 Calibration & Confidence-Driven Degradation
Every compiled component carries `_lathe` calibration metadata (`confidence`, `runnerUp`, `margin`, `selectionTrace`):
- $\text{confidence} \ge 0.85$: Render chosen component directly.
- $0.60 \le \text{confidence} < 0.85$: Render chosen component with an interactive runner-up swap chip (`Swap to <runnerUp>`).
- $\text{confidence} < 0.60$: Degrade to a safe read-only key-value fallback card (`lathe-degraded-card`).

---

## 5. Four-Tier Guard Verification (`@lathe/guard`)

Every A2UI v0.9 surface **MUST** pass `verifySurface` before rendering:

| Tier | Name | Mechanism | Latency |
|---|---|---|---|
| **Tier 1** | Structural & Catalog Schema (`tier1_schema`) | Verifies all component names, prop kinds, enum values, and root reachability against the `Catalog`. | `< 1 ms` |
| **Tier 1.5** | Deterministic Value & Pointer Trace (`tier1_5_trace`) | Verifies every `{"path": "..."}` resolves in `state`, every `DataTable`/`DataList` column key exists in the array rows, and rejects any unentailed numbers (`fabricated_number`) in prop strings. | `< 1 ms` |
| **Tier 2** | System One Entailment (`tier2_entailment`) | Queries `TypeSafe System One` (`Noul`) for any string prop not backed by a `PhraseBank` key or schema `title` to verify strict entailment from `state`. | `~350 ms` (only when untraceable text exists) |
| **Tier 4** | Context-Aware Sink & XSS Enforcement (`tier4_sink`) | Blocks dangerous URL schemes (`javascript:`, `data:`, `vbscript:`), inline `<script>` / event handler attributes (`onload=`, `onerror=`), and CSS `expression()` across all props and collection cells. | `< 1 ms` |

---

## 6. AG-UI Transport & Normalized Shape-Hash Cache (`@lathe/ag-ui`)

1. **AG-UI Framing**:
   - Emits `STATE_SNAPSHOT` for the data model, `CUSTOM` (`name: "a2ui.v0.9"`) for `[createSurface, updateComponents, updateDataModel]`, and `CUSTOM` (`name: "lathe.guard"`) for verification telemetry.
2. **Array-Normalized Shape Hash (`computeShapeHash`)**:
   - Normalizes array indices (`/line_items/0/sku`, `/line_items/1/sku` $\rightarrow$ `/line_items/[*]/sku`) and hashes `(catalogId, pointer:scalarTypeTag)` with `SHA-256`.
   - Subsequent agent states with identical schema shape reuse the cached `updateComponents` template in **`0 ms` with `0` model calls**, streaming only `updateDataModel`.
