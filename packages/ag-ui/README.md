# @orcawhisperer/lathe-ag-ui

> **AG-UI `CUSTOM` event stream emitter, parser, and `LatheSurfaceStore` state reducer for A2UI v0.9.**

[![npm version](https://img.shields.io/npm/v/@orcawhisperer/lathe-ag-ui.svg)](https://www.npmjs.com/package/@orcawhisperer/lathe-ag-ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/orcawhisperer/lathe/blob/main/LICENSE)

`@orcawhisperer/lathe-ag-ui` bridges compiled A2UI v0.9 surfaces (`createSurface`, `updateComponents`, `updateDataModel`) with the **AG-UI** agent-user interaction protocol over Server-Sent Events (SSE) or WebSockets, plus a framework-agnostic client state store (`LatheSurfaceStore`).

---

## Install

```bash
npm install @orcawhisperer/lathe-ag-ui @orcawhisperer/lathe-core
```

---

## Server: Emit AG-UI `CUSTOM` Events

```ts
import { toAgUiCustomEvents, formatSseFrame } from '@orcawhisperer/lathe-ag-ui';

// Convert a compiled A2UI v0.9 surface into 3 ordered AG-UI CUSTOM events:
// 1. a2ui.createSurface
// 2. a2ui.updateComponents
// 3. a2ui.updateDataModel
const events = toAgUiCustomEvents(compiledSurface);

for (const event of events) {
  res.write(formatSseFrame(event));
}
```

---

## Client: `LatheSurfaceStore`

`LatheSurfaceStore` maintains live reactive state for all mounted A2UI v0.9 surfaces, applies RFC 6901 JSON Pointer reads/writes (`writePointer`), and emits `a2ui.userAction` events back to the agent when a user interacts with a button or input.

```ts
import { LatheSurfaceStore } from '@orcawhisperer/lathe-ag-ui';

const store = new LatheSurfaceStore();

// Apply incoming AG-UI CUSTOM events from SSE
store.applyEvent(agUiEvent);

// Two-way bind an input field to its RFC 6901 JSON Pointer path
store.writePointer('sfx_dispute_8821', '/evidence/customer_notes', 'Delivered via FedEx #9941');

// Build a structured a2ui.userAction event with resolved context pointers
const actionEvent = store.createUserAction('sfx_dispute_8821', 'btn_submit', {
  name: 'submit_dispute_evidence',
  context: {
    dispute_id: { path: '/dispute/id' },
    customer_notes: { path: '/evidence/customer_notes' },
  },
});
```

---

## License

MIT © [Vasanthakumar A](https://github.com/orcawhisperer/lathe)
