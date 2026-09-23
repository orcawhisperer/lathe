import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileJsonToDynamicDashboard,
  LIVE_API_PRESETS,
} from "./server.js";

describe("Lathe Universal Live Widget Studio — Arbitrary JSON -> Dynamic Widgets via jev-1.13.0", () => {
  it("introspects arbitrary JSON payloads, classifies rich widgets (SparklineTrend, KanbanBoard, RadialGauge, GeoPulseCard), and caches by shape hash", async () => {
    const tokyoPayload = LIVE_API_PRESETS["open_meteo_tokyo"]!.fallbackJson;
    const bundle1 = await compileJsonToDynamicDashboard(tokyoPayload, {
      bypassCache: true,
    });

    assert.ok(bundle1.totalNodesDiscovered >= 5);
    const widgetKinds = new Set(bundle1.widgets.map((w) => w.selectedWidget));
    assert.ok(widgetKinds.has("GeoPulseCard") || widgetKinds.has("SparklineTrend"));
    assert.ok(bundle1.insights.every((i) => i.entailed));

    // Second compilation with same JSON shape hits the 0.03ms shape-hash cache
    const bundle2 = await compileJsonToDynamicDashboard(tokyoPayload);
    assert.equal(bundle2.cached, true);
    assert.equal(bundle2.shapeHash, bundle1.shapeHash);
  });
});
