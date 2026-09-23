# @orcawhisperer/lathe-cli

> **Command-line compiler, linter, verifier, zero-call locale renderer, and MCP tool runner for Lathe (`lathe`).**

[![npm version](https://img.shields.io/npm/v/@orcawhisperer/lathe-cli.svg)](https://www.npmjs.com/package/@orcawhisperer/lathe-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/orcawhisperer/lathe/blob/main/LICENSE)

`@orcawhisperer/lathe-cli` provides the `lathe` command-line utility for linting component catalogs, compiling JSON payloads into verified A2UI v0.9 surfaces, running the 7-invariant `@orcawhisperer/lathe-guard` gate in CI/CD pipelines, swapping surface locales (`en`, `es`, `ja`, `de`) in 0ms, and testing MCP tool presets.

---

## Install

```bash
# Run directly with npx
npx @orcawhisperer/lathe-cli lint

# Or install globally
npm install -g @orcawhisperer/lathe-cli
```

---

## Commands

### 1. `lathe lint`
Audits the active component catalog and multi-locale phrase bank (`en`, `es`, `ja`, `de`) for schema completeness and phrase key parity.

```bash
lathe lint
```

### 2. `lathe compile`
Compiles a JSON data model (`--preset` or `--input <file.json>`) into an A2UI v0.9 surface bundle (`--mode offline|live`, `--locale en|es|ja|de`).

```bash
lathe compile --preset stripe_dispute --locale es --out surface.json
```

### 3. `lathe verify`
Runs all 7 `@orcawhisperer/lathe-guard` security, data-pointer, and accessibility invariants (`G1`–`G7`) on a compiled surface JSON file. Exits with non-zero code on any violation.

```bash
lathe verify --input surface.json
```

### 4. `lathe render`
Swaps the locale of a compiled surface in **0ms** (zero LLM calls) and outputs either a localized surface bundle or static HTML (`--html`).

```bash
lathe render --preset github_pr_review --locale ja --html
```

### 5. `lathe mcp`
Executes the full closed-loop Model Context Protocol (`MCP`) pipeline (`tool_output -> A2UI v0.9 -> userAction -> tool_call -> updateDataModel delta`) and prints timing and validation diagnostics.

```bash
lathe mcp --preset postgres_slow_query
```

---

## License

MIT © [Vasanthakumar A](https://github.com/orcawhisperer/lathe)
