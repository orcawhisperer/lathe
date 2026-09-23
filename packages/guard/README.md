# @orcawhisperer/lathe-guard

> **7-invariant security & accessibility gate for compiled A2UI v0.9 surfaces (`verifySurface`).**

[![npm version](https://img.shields.io/npm/v/@orcawhisperer/lathe-guard.svg)](https://www.npmjs.com/package/@orcawhisperer/lathe-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/orcawhisperer/lathe/blob/main/LICENSE)

`@orcawhisperer/lathe-guard` inspects any compiled `LatheCompiledSurface` (`createSurface` + `updateComponents` + `updateDataModel`) **before** it is allowed to cross the AG-UI / SSE network boundary or mount in a client renderer.

---

## Install

```bash
npm install @orcawhisperer/lathe-guard @orcawhisperer/lathe-core
```

---

## The 7 Invariants (`G1`–`G7`)

| Rule ID | Severity | Description |
| :--- | :--- | :--- |
| **`G1_SCHEMA_VALID`** | `error` | All `components[]` match registered catalog `propSchema`s and `root` exists. |
| **`G2_NO_ORPHAN_NODES`** | `error` | Every component ID is reachable from `"root"` via a strict DAG with zero cycles. |
| **`G3_POINTER_RESOLVABLE`** | `error` | Every `{ path: "/..." }` RFC 6901 JSON Pointer resolves inside `updateDataModel.value` (`!== undefined`). |
| **`G4_PHRASE_TOKEN_VALID`** | `error` | When a `PhraseBank` is supplied, every literal `Text.text` or `Button.label` belongs to the vetted `phrase_bank[locale]` (zero free-form LLM hallucinated copy). |
| **`G5_ACCESSIBLE_CONTROLS`** | `error` | Every interactive widget (`Button`, `TextField`, `Select`, `Switch`) has a non-empty label or accessible description. |
| **`G6_SAFE_SCHEMES_AND_MARKUP`** | `error` | Zero `javascript:`, `data:`, `vbscript:` URI schemes, and zero raw `<script>`, `<iframe`, `onerror=`, or `onload=` substrings across both component props and `dataModel`. |
| **`G7_DENSITY_BUDGET`** | `warning` / `error` | Tree depth $\le 4$ and maximum interactive CTAs per card $\le 4$. |

---

## Quick Start

```ts
import { verifySurface } from '@orcawhisperer/lathe-guard';
import { SHADCN_CATALOG, SHADCN_PHRASE_BANK } from '@orcawhisperer/lathe-shadcn';

const report = verifySurface(compiledSurface, SHADCN_CATALOG, {
  phraseBank: SHADCN_PHRASE_BANK,
  locale: 'en',
  maxDepth: 4,
  maxInteractivePerCard: 4,
});

if (!report.valid) {
  console.error('Surface failed verification:', report.violations);
  throw new Error('Blocked unverified UI surface');
}
```

---

## License

MIT © [Vasanthakumar A](https://github.com/orcawhisperer/lathe)
