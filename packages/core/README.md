# `@orcawhisperer/lathe-core`

Core non-generative **A2UI v0.9** surface compiler, RFC 6901 JSON Pointer walker, `PhraseBank` i18n engine, and static catalog criteria linter (`lintCatalog`).

[![Spec v0.9](https://img.shields.io/badge/A2UI-v0.9-0284c7)](https://github.com/orcawhisperer/lathe/blob/main/SPEC.md)
[![License Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://github.com/orcawhisperer/lathe/blob/main/LICENSE)

## Install

```bash
npm install @orcawhisperer/lathe-core
```

## Key Exports

- **`compileSurface(options)`** — Compiles any JSON state + optional JSON Schema into a calibrated **A2UI v0.9** `[createSurface, updateComponents, updateDataModel]` bundle using closed-set selection (`Noul`, `Choice`, `Score`).
  - Supports **Homogeneous Collection Collapsing** (`collapseCollections: true` $\rightarrow$ `DataTable` / `DataList` in $O(M_{\text{cols}})$ questions).
  - Supports **Form-Aware Compilation** (`formAware: true` $\rightarrow$ recovers `""` empty fields and applies JSON Schema `enum`, `minimum`/`maximum`, and `multiline` constraints).
- **`PhraseBank` & `swapSurfaceLocale(messages, phraseBank, locale)`** — Zero-generation i18n label catalog with **`0ms`, `0-model-call` locale switching** (`en`, `es`, `ja`, `de`).
- **`lintCatalog(catalog)`** — Static criteria linter checking for `missing_not_for`, `missing_examples`, `thin_examples`, `missing_primary_binding`, `confusable_pair`, and `example_bleed`.
- **RFC 6901 JSON Pointers** — `walk`, `resolve`, `leaves`, `escapeToken`, `unescapeToken`, `canonicalString`.

## Quickstart

```ts
import { compileSurface, lintCatalog } from "@orcawhisperer/lathe-core";
import { SHADCN_CATALOG, SHADCN_PHRASE_BANK } from "@orcawhisperer/lathe-shadcn";
import { TypeSafeAdapter } from "@orcawhisperer/lathe-typesafe";

const report = lintCatalog(SHADCN_CATALOG);
console.assert(report.ok, "Catalog criteria passed static linting");

const client = new TypeSafeAdapter({ apiKey: process.env.TYPESAFE_API_KEY });
const result = await compileSurface({
  state: {
    order: { duplicate_amount_usd: 149.0, status: "duplicate_charge_confirmed" },
  },
  catalog: SHADCN_CATALOG,
  phraseBank: SHADCN_PHRASE_BANK,
  client,
  groupBlocks: true,
});

console.log(result.messages);
```

## Documentation

- [Full Specification (`SPEC.md`)](https://github.com/orcawhisperer/lathe/blob/main/SPEC.md)
- [GitHub Repository](https://github.com/orcawhisperer/lathe)
