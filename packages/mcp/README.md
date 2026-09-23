# @orcawhisperer/lathe-mcp

> **Model Context Protocol (`MCP`) closed-loop bridge for Lathe (`tool_output -> TypeSafe -> A2UI v0.9 -> MCP tool_call`).**

[![npm version](https://img.shields.io/npm/v/@orcawhisperer/lathe-mcp.svg)](https://www.npmjs.com/package/@orcawhisperer/lathe-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/orcawhisperer/lathe/blob/main/LICENSE)

`@orcawhisperer/lathe-mcp` closes the loop between **Model Context Protocol (`MCP`)** servers and **A2UI v0.9** interactive surfaces:

1. **Tool Output $\to$ Verified UI**: Converts structured MCP `CallToolResult` payloads into deterministic `shadcn/ui` A2UI v0.9 surfaces via TypeSafe System One (`jev-1.13.0`) and verifies them with `@orcawhisperer/lathe-guard`.
2. **User Action $\to$ Verified MCP Tool Call**: Validates every interactive `a2ui.userAction` payload against registered MCP tool input schemas (`requiredKeys`, `allowedValues`), executes the downstream handler, and returns a live `updateDataModel` delta event that updates the mounted UI without re-running any LLM.

---

## Install

```bash
npm install @orcawhisperer/lathe-mcp @orcawhisperer/lathe-core
```

---

## Quick Start

```ts
import { LatheMcpBridge, MCP_TOOL_PRESETS } from '@orcawhisperer/lathe-mcp';
import { TypeSafeClient } from '@orcawhisperer/lathe-typesafe';
import { SHADCN_CATALOG, SHADCN_PHRASE_BANK } from '@orcawhisperer/lathe-shadcn';

const bridge = new LatheMcpBridge({
  client: new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY }),
  catalog: SHADCN_CATALOG,
  phraseBank: SHADCN_PHRASE_BANK,
});

// Register the built-in Stripe, GitHub, Postgres, and Kubernetes MCP tool presets
for (const preset of Object.values(MCP_TOOL_PRESETS)) {
  bridge.registerTool(preset);
}

// 1. Compile MCP tool output into a verified A2UI v0.9 surface + AG-UI events
const compiled = await bridge.compileToolResult('stripe_dispute');

// 2. Execute an incoming a2ui.userAction against the registered MCP tool schema
const execution = await bridge.executeAction(actionEvent);
console.log(execution.toolCallResult.summary);
console.log(execution.dataModelDeltaEvent); // Instant AG-UI a2ui.updateDataModel frame
```

---

## Built-in MCP Tool Presets (`MCP_TOOL_PRESETS`)

- **`stripe_dispute`** (`stripe.disputes.get` $\to$ `submit_dispute_evidence` / `accept_dispute_liability`)
- **`github_pr_review`** (`github.pulls.get_review_context` $\to$ `submit_pr_review` / `request_ci_rerun`)
- **`postgres_slow_query`** (`postgres.pg_stat_statements.top_anomaly` $\to$ `apply_concurrent_index` / `terminate_blocking_backends`)
- **`k8s_pod_incident`** (`kubernetes.pods.get_crashloop_diagnostics` $\to$ `rollback_deployment_revision` / `patch_memory_limits`)

---

## License

MIT © [Vasanthakumar A](https://github.com/orcawhisperer/lathe)
