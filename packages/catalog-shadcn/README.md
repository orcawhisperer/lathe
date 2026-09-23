# `@orcawhisperer/lathe-shadcn`

Flagship **14-component `shadcn/ui` catalog (`SHADCN_CATALOG`)** and 4-locale **`SHADCN_PHRASE_BANK` (`en`, `es`, `ja`, `de`)** for `@orcawhisperer/lathe-core`.

[![Catalog @orcawhisperer/lathe-shadcn](https://img.shields.io/badge/Components-14%20shadcn%2Fui-f4f4f5)](https://github.com/orcawhisperer/lathe)
[![Linter 0 Errors](https://img.shields.io/badge/Linter-0%20Errors%20%2F%200%20Warnings-10b981)](https://github.com/orcawhisperer/lathe)

## Install

```bash
npm install @orcawhisperer/lathe-shadcn @orcawhisperer/lathe-core
```

## Included `shadcn/ui` Components (`14`)

| Category | Components |
|---|---|
| **Layout Containers (`container: true`)** | `Stack` (`direction: "column" \| "row"`, `gap: "sm" \| "md" \| "lg"`), `Card` (`title`) |
| **Scalar Display Leaves** | `Stat` (`currency` / `number` / `percent`), `Progress` (`0..1` or `0..100` ratio), `Badge` (`default` / `secondary` / `destructive` / `outline`), `Alert` (`default` / `destructive`) |
| **Interactive Form Leaves** | `Input` (`text` / `email` / `url`), `Select` (schema `enum` dropdown), `Slider` (schema `minimum`/`maximum` range), `Textarea` (multiline / empty-string recovery), `Switch` (`boolean`), `Button` (action dispatch) |
| **Collection Components (`collection: true`)** | `DataTable` (tabular object arrays with per-column format routing), `DataList` (timeline / activity feed arrays) |

## Multi-Locale Zero-Call i18n (`SHADCN_PHRASE_BANK`)

Includes 27 domain phrase entries with built-in translations across **English (`en`)**, **Spanish (`es`)**, **Japanese (`ja`)**, and **German (`de`)**. Use `swapSurfaceLocale(messages, SHADCN_PHRASE_BANK, "ja")` to switch a compiled surface's locale in **`0ms` with `0` model calls**.

## Documentation

- [GitHub Repository](https://github.com/orcawhisperer/lathe)
