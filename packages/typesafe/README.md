# `@orcawhisperer/lathe-typesafe`

Official `@typesafe-ai/sdk` adapter (`TypeSafeAdapter`) for `@orcawhisperer/lathe-core`, pinned to **TypeSafe System One (`jev-1.13.0`)**.

[![Model TypeSafe System One](https://img.shields.io/badge/Model-jev--1.13.0-10b981)](https://docs.typesafe.ai)
[![License Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://github.com/orcawhisperer/lathe/blob/main/LICENSE)

## Install

```bash
npm install @orcawhisperer/lathe-typesafe @orcawhisperer/lathe-core
```

## Overview

`TypeSafeAdapter` implements the `SystemOneClient` interface from `@orcawhisperer/lathe-core` using the official `@typesafe-ai/sdk` client (`client.systemOne({ state, questions, model: "jev-1.13.0" })`), translating Lathe's `Noul` (binary entailment), `Choice` (closed-set classification), and `Score` (ordinal rating) questions into calibrated posterior probability distributions.

## Usage

```ts
import { TypeSafeAdapter } from "@orcawhisperer/lathe-typesafe";
import { compileSurface } from "@orcawhisperer/lathe-core";
import { SHADCN_CATALOG, SHADCN_PHRASE_BANK } from "@orcawhisperer/lathe-shadcn";

const client = new TypeSafeAdapter({
  apiKey: process.env.TYPESAFE_API_KEY,
  model: "jev-1.13.0",
});

const compiled = await compileSurface({
  state: { order: { duplicate_amount_usd: 149, risk_score: 0.82 } },
  catalog: SHADCN_CATALOG,
  phraseBank: SHADCN_PHRASE_BANK,
  client,
});
```

## Documentation

- [GitHub Repository](https://github.com/orcawhisperer/lathe)
