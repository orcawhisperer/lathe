# @orcawhisperer/lathe-react

> **Deterministic React 18+ renderer and HTML preview generator for A2UI v0.9 surfaces (`<LatheSurface />` & `renderSurfaceToHtml`).**

[![npm version](https://img.shields.io/npm/v/@orcawhisperer/lathe-react.svg)](https://www.npmjs.com/package/@orcawhisperer/lathe-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/orcawhisperer/lathe/blob/main/LICENSE)

`@orcawhisperer/lathe-react` renders compiled A2UI v0.9 surfaces using **pre-registered `shadcn/ui` primitives** with automatic RFC 6901 JSON Pointer data binding, two-way form state synchronization, and structured `a2ui.userAction` callback dispatch.

---

## Install

```bash
npm install @orcawhisperer/lathe-react @orcawhisperer/lathe-ag-ui @orcawhisperer/lathe-core react react-dom
```

---

## Usage (`<LatheSurface />`)

```tsx
import React from 'react';
import { LatheSurface } from '@orcawhisperer/lathe-react';
import { LatheSurfaceStore } from '@orcawhisperer/lathe-ag-ui';

const store = new LatheSurfaceStore();
store.loadCompiledSurface(compiledSurface);

export function TriagePanel() {
  const surface = store.getSurface(compiledSurface.createSurface.surfaceId)!;

  return (
    <LatheSurface
      surface={surface}
      onWritePointer={(path, value) =>
        store.writePointer(surface.surfaceId, path, value)
      }
      onAction={(sourceId, action) => {
        const event = store.createUserAction(surface.surfaceId, sourceId, action);
        console.log('Dispatched a2ui.userAction:', event);
      }}
    />
  );
}
```

---

## Server-Side / CLI HTML Preview (`renderSurfaceToHtml`)

```ts
import { renderSurfaceToHtml } from '@orcawhisperer/lathe-react';

const htmlSnippet = renderSurfaceToHtml(compiledSurface);
```

---

## License

MIT © [Vasanthakumar A](https://github.com/orcawhisperer/lathe)
