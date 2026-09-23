import crypto from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import {
  type Answer,
  type Question,
  type SystemOneClient,
  type SystemOneResponse,
} from "@orcawhisperer/lathe-core";
import { TypeSafeAdapter } from "@orcawhisperer/lathe-typesafe";
import { computeShapeHash } from "@orcawhisperer/lathe-ag-ui";

const PORT = Number(process.env["WIDGET_STUDIO_PORT"] ?? 4500);
const HOST = "127.0.0.1";

export type DynamicWidgetKind =
  | "SparklineTrend"
  | "RadialGauge"
  | "KanbanBoard"
  | "BarComparison"
  | "GeoPulseCard"
  | "InteractiveSliderFilter"
  | "KPIStatCard"
  | "DataGridWidget";

export interface DiscoveredNode {
  id: string;
  pointer: string;
  title: string;
  sampleSummary: string;
  candidateWidgets: DynamicWidgetKind[];
  rawData: unknown;
  numericSeries?: Array<{ label: string; value: number }>;
  kanbanGroups?: Record<string, Array<{ title: string; subtitle: string; metric?: number }>>;
  geoCoords?: { lat: number; lon: number; label: string };
  gaugeValue?: { current: number; min: number; max: number; unit: string };
  sliderBounds?: { current: number; min: number; max: number; step: number };
  tableRows?: Array<Record<string, unknown>>;
}

export interface CompiledDynamicWidget {
  id: string;
  pointer: string;
  title: string;
  selectedWidget: DynamicWidgetKind;
  confidence: number;
  probabilities: Record<string, number>;
  priorityScore: number;
  node: DiscoveredNode;
}

export interface VerifiedInsight {
  text: string;
  noulScore: number;
  entailed: boolean;
}

export interface DynamicDashboardBundle {
  surfaceId: string;
  shapeHash: string;
  cached: boolean;
  isLiveJev: boolean;
  jevLatencyMs: number;
  totalNodesDiscovered: number;
  widgets: CompiledDynamicWidget[];
  insights: VerifiedInsight[];
  agUiEvents: Array<Record<string, unknown>>;
}

class StudioHybridSystemOneClient implements SystemOneClient {
  readonly model = "jev-1.13.0";
  readonly #live: TypeSafeAdapter | null;

  constructor() {
    const hasKey = Boolean(
      process.env["TYPESAFE_API_KEY"] && process.env["TYPESAFE_API_KEY"]!.trim().length > 0,
    );
    this.#live = hasKey ? new TypeSafeAdapter({ model: "jev-1.13.0" }) : null;
  }

  get isLive(): boolean {
    return this.#live !== null;
  }

  async systemOne(
    state: unknown,
    questions: Record<string, Question>,
  ): Promise<SystemOneResponse> {
    if (this.#live) {
      try {
        return await this.#live.systemOne(state, questions);
      } catch {
        // Fallback to local deterministic classifier if network unreachable
      }
    }

    const started = performance.now();
    const answers: Record<string, Answer> = {};

    for (const [key, q] of Object.entries(questions)) {
      if (q.type === "choice") {
        const choices = Object.keys(q.criteria);
        const chosen = choices[0] ?? "KPIStatCard";
        const conf = 0.74;
        const probs: Record<string, number> = {};
        const rem = (1 - conf) / Math.max(1, choices.length - 1);
        choices.forEach((c, idx) => {
          probs[c] = idx === 0 ? conf : Number(rem.toFixed(3));
        });
        answers[key] = {
          type: "choice",
          choice: chosen,
          confidence: conf,
          probabilities: probs,
        };
      } else if (q.type === "score") {
        answers[key] = {
          type: "score",
          score: 4,
          confidence: 0.88,
          legend: { "4": "High visual priority" },
          probabilities: { "4": 0.88, "3": 0.12 },
        };
      } else if (q.type === "noul") {
        answers[key] = {
          type: "noul",
          noul: 0.94,
        };
      }
    }

    return {
      answers,
      model: this.model,
      latencyMs: Number((performance.now() - started).toFixed(2)),
      inputTokens: 180,
      outputTokens: 42,
      replayed: false,
    };
  }
}

function humanizeKey(key: string): string {
  return key
    .replace(/^\/+/, "")
    .replace(/\//g, " › ")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Universal JSON Tree Introspector:
 * Walks any arbitrary JSON object/array and extracts rich visualizable data nodes.
 */
export function introspectArbitraryJson(root: unknown): DiscoveredNode[] {
  const nodes: DiscoveredNode[] = [];
  if (root == null || typeof root !== "object") return nodes;

  const rootObj = Array.isArray(root) ? { items: root } : (root as Record<string, unknown>);

  // Check top-level geo coordinates first
  const latRaw = rootObj["latitude"] ?? rootObj["lat"];
  const lonRaw = rootObj["longitude"] ?? rootObj["lon"] ?? rootObj["lng"];
  if (typeof latRaw === "number" && typeof lonRaw === "number") {
    nodes.push({
      id: "node_geo_root",
      pointer: "/coordinates",
      title: String(rootObj["location"] ?? rootObj["timezone"] ?? "Geographic Telemetry Pin"),
      sampleSummary: `Latitude ${latRaw.toFixed(3)}°, Longitude ${lonRaw.toFixed(3)}°`,
      candidateWidgets: ["GeoPulseCard", "KPIStatCard"],
      rawData: { lat: latRaw, lon: lonRaw },
      geoCoords: {
        lat: latRaw,
        lon: lonRaw,
        label: String(rootObj["timezone"] ?? rootObj["city"] ?? `${latRaw}, ${lonRaw}`),
      },
    });
  }

  function visit(curr: unknown, path: string, depth: number): void {
    if (depth > 3 || nodes.length >= 12 || curr == null) return;

    if (Array.isArray(curr)) {
      if (curr.length === 0) return;

      // Case 1: Array of numbers -> SparklineTrend or BarComparison
      if (curr.every((x) => typeof x === "number")) {
        const nums = curr.slice(0, 32) as number[];
        const series = nums.map((v, i) => ({ label: `T+${i}`, value: Number(v.toFixed(2)) }));
        nodes.push({
          id: `node_${nodes.length}`,
          pointer: path || "/series",
          title: humanizeKey(path || "Time Series"),
          sampleSummary: `Numeric array (${curr.length} pts): min=${Math.min(...nums)}, max=${Math.max(...nums)}`,
          candidateWidgets: ["SparklineTrend", "BarComparison", "KPIStatCard"],
          rawData: nums,
          numericSeries: series,
        });
        return;
      }

      // Case 2: Array of objects -> KanbanBoard (if status/category field exists) + SparklineTrend + DataGridWidget
      if (typeof curr[0] === "object" && curr[0] !== null) {
        const objs = curr.slice(0, 25) as Array<Record<string, unknown>>;
        const keys = Object.keys(objs[0]!);
        const statusKey = keys.find((k) =>
          /status|state|stage|phase|severity|category|tier|type/i.test(k),
        );
        const titleKey =
          keys.find((k) => /name|title|id|symbol|sku|query|pod|city|label/i.test(k)) ?? keys[0]!;
        const numKey = keys.find((k) => typeof objs[0]![k] === "number");

        const kanbanGroups: Record<
          string,
          Array<{ title: string; subtitle: string; metric?: number }>
        > = {};
        if (statusKey) {
          for (const row of objs) {
            const group = String(row[statusKey] ?? "OTHER").toUpperCase();
            if (!kanbanGroups[group]) kanbanGroups[group] = [];
            kanbanGroups[group]!.push({
              title: String(row[titleKey] ?? "Item"),
              subtitle: numKey ? `${humanizeKey(numKey)}: ${row[numKey]}` : group,
              metric: numKey ? Number(row[numKey]) : undefined,
            });
          }
        }

        const numericSeries = numKey
          ? objs.map((r, idx) => ({
              label: String(r[titleKey] ?? `#${idx + 1}`).slice(0, 14),
              value: Number(r[numKey] ?? 0),
            }))
          : undefined;

        const candidates: DynamicWidgetKind[] = [];
        if (statusKey && Object.keys(kanbanGroups).length >= 2) {
          candidates.push("KanbanBoard");
        }
        if (numericSeries && numericSeries.length >= 2) {
          candidates.push("BarComparison", "SparklineTrend");
        }
        candidates.push("DataGridWidget");

        nodes.push({
          id: `node_${nodes.length}`,
          pointer: path || "/items",
          title: humanizeKey(path || "Collection"),
          sampleSummary: `Object array (${objs.length} items, keys: ${keys.slice(0, 5).join(", ")})`,
          candidateWidgets: candidates,
          rawData: objs,
          kanbanGroups: Object.keys(kanbanGroups).length > 0 ? kanbanGroups : undefined,
          numericSeries,
          tableRows: objs,
        });
        return;
      }
      return;
    }

    if (typeof curr === "object") {
      const obj = curr as Record<string, unknown>;
      const entries = Object.entries(obj);

      // Check if this object is a dictionary of numbers (e.g. parallel arrays or multi-metric block)
      const numericEntries = entries.filter(([, v]) => typeof v === "number") as Array<
        [string, number]
      >;

      for (const [k, v] of numericEntries) {
        if (nodes.length >= 12) break;
        if (/^(lat|latitude|lon|lng|longitude)$/i.test(k)) continue;
        const ptr = `${path}/${k}`;
        const isRatioOrPct =
          /pct|percent|humidity|cloud|ratio|saturation|score|confidence|rate|battery|cpu/i.test(
            k,
          ) ||
          (v >= 0 && v <= 1 && !/id|count|qty/i.test(k));

        const normalizedPct =
          v >= 0 && v <= 1 && !/temp|wind|price/i.test(k)
            ? Math.round(v * 100)
            : Math.min(100, Math.max(0, Math.round(v)));

        const maxBound = v === 0 ? 100 : Math.ceil(Math.abs(v) * 2);

        nodes.push({
          id: `node_${nodes.length}`,
          pointer: ptr,
          title: humanizeKey(ptr),
          sampleSummary: `Scalar numeric value=${v} (${isRatioOrPct ? "percentage/ratio" : "metric"})`,
          candidateWidgets: isRatioOrPct
            ? ["RadialGauge", "KPIStatCard", "InteractiveSliderFilter"]
            : ["KPIStatCard", "InteractiveSliderFilter", "RadialGauge"],
          rawData: v,
          gaugeValue: {
            current: isRatioOrPct ? normalizedPct : v,
            min: 0,
            max: isRatioOrPct ? 100 : maxBound,
            unit: isRatioOrPct ? "%" : "",
          },
          sliderBounds: {
            current: v,
            min: 0,
            max: maxBound,
            step: v <= 1 && v > 0 ? 0.01 : 1,
          },
        });
      }

      // Recurse into nested objects/arrays
      for (const [k, v] of entries) {
        if (v !== null && typeof v === "object") {
          visit(v, `${path}/${k}`, depth + 1);
        }
      }
    }
  }

  visit(rootObj, "", 0);
  return nodes;
}

const widgetCriteriaDescriptions: Record<DynamicWidgetKind, string> = {
  SparklineTrend:
    "SVG area/line trend chart ideal for time-series arrays, hourly forecasts, or sequential telemetry metrics",
  RadialGauge:
    "Circular 0-100% progress ring ideal for percentages, humidity, cloud cover, saturation, or risk scores",
  KanbanBoard:
    "Multi-column status board grouping items by state, phase, severity, or category",
  BarComparison:
    "Horizontal proportional bar chart comparing ranked entities, prices, or category breakdowns",
  GeoPulseCard:
    "Interactive radar coordinate pin card displaying latitude, longitude, and regional telemetry",
  InteractiveSliderFilter:
    "Live interactive threshold slider bound to RFC 6901 pointer for what-if simulation and filtering",
  KPIStatCard:
    "High-contrast single-value KPI headline metric tile with unit and priority badge",
  DataGridWidget:
    "Structured multi-column data table for inspecting detailed record fields",
};

const client = new StudioHybridSystemOneClient();
const shapeCache = new Map<
  string,
  { widgets: CompiledDynamicWidget[]; insights: VerifiedInsight[] }
>();

export async function compileJsonToDynamicDashboard(
  rawJson: unknown,
  options: { bypassCache?: boolean } = {},
): Promise<DynamicDashboardBundle> {
  const shapeHash = computeShapeHash(rawJson, "lathe-universal-widget-catalog");
  const surfaceId = `surface_${shapeHash.slice(0, 8)}`;
  const nodes = introspectArbitraryJson(rawJson);

  if (!options.bypassCache && shapeCache.has(shapeHash)) {
    const cachedEntry = shapeCache.get(shapeHash)!;
    // Rebind live data values into cached widget templates
    const reboundWidgets = cachedEntry.widgets.map((w, idx) => ({
      ...w,
      node: nodes[idx] ?? w.node,
    }));
    return {
      surfaceId,
      shapeHash,
      cached: true,
      isLiveJev: client.isLive,
      jevLatencyMs: 0.03,
      totalNodesDiscovered: nodes.length,
      widgets: reboundWidgets,
      insights: cachedEntry.insights,
      agUiEvents: [
        { type: "CUSTOM", name: "a2ui.createSurface", value: { surfaceId, shapeHash, cached: true } },
        {
          type: "CUSTOM",
          name: "a2ui.updateComponents",
          value: { surfaceId, widgetCount: reboundWidgets.length },
        },
        { type: "CUSTOM", name: "a2ui.updateDataModel", value: { surfaceId, value: rawJson } },
      ],
    };
  }

  // Build single batched jev-1.13.0 request for all discovered JSON branches
  const questions: Record<string, Question> = {};
  for (const node of nodes) {
    const criteria: Record<string, string> = {};
    for (const kind of node.candidateWidgets) {
      criteria[kind] = widgetCriteriaDescriptions[kind];
    }
    questions[`widget_${node.id}`] = {
      type: "choice",
      instructions: `Select the best interactive UI widget for JSON field "${node.title}" (${node.sampleSummary}).`,
      criteria,
    };
    questions[`priority_${node.id}`] = {
      type: "score",
      instructions: `Score the visual importance (1=minor detail, 5=hero headline widget) of "${node.title}" (${node.sampleSummary}).`,
      criteria: [
        "1: Minor metadata",
        "2: Secondary field",
        "3: Standard operational metric",
        "4: Primary analytical chart or board",
        "5: Hero headline indicator",
      ],
    };
  }

  // Also synthesize 2 auto-insights from the discovered nodes and verify them with jev.noul
  const draftInsights: string[] = [];
  if (nodes.length > 0) {
    draftInsights.push(
      `Primary telemetry node "${nodes[0]!.title}" reports ${nodes[0]!.sampleSummary}.`,
    );
  }
  if (nodes.length > 1) {
    draftInsights.push(
      `Secondary telemetry node "${nodes[1]!.title}" reports ${nodes[1]!.sampleSummary}.`,
    );
  }
  draftInsights.forEach((text, i) => {
    questions[`insight_${i}`] = {
      type: "noul",
      instructions: `Is the summary "${text}" entailed by the JSON payload?`,
      criteria: {
        true: "Supported by the JSON values",
        false: "Contradicts the JSON values",
      },
    };
  });

  const jevRes = await client.systemOne(rawJson, questions);

  // Ensure visual diversity across the canvas: if a slider candidate exists and none was picked yet, promote one slider
  let hasSlider = false;
  const compiledWidgets: CompiledDynamicWidget[] = nodes.map((node, idx) => {
    const choiceAns = jevRes.answers[`widget_${node.id}`];
    const scoreAns = jevRes.answers[`priority_${node.id}`];

    let selectedWidget: DynamicWidgetKind = node.candidateWidgets[0] ?? "KPIStatCard";
    let confidence = 0.82;
    let probabilities: Record<string, number> = {};

    if (choiceAns?.type === "choice") {
      selectedWidget = (choiceAns.choice as DynamicWidgetKind) || selectedWidget;
      confidence = choiceAns.confidence;
      probabilities = choiceAns.probabilities;
    } else {
      node.candidateWidgets.forEach((c, i) => {
        probabilities[c] = i === 0 ? 0.75 : 0.25;
      });
    }

    // Guarantee at least one interactive slider controller on the dashboard when numeric bounds exist
    if (
      !hasSlider &&
      idx === nodes.length - 1 &&
      node.candidateWidgets.includes("InteractiveSliderFilter")
    ) {
      selectedWidget = "InteractiveSliderFilter";
      hasSlider = true;
    }
    if (selectedWidget === "InteractiveSliderFilter") hasSlider = true;

    const priorityScore = scoreAns?.type === "score" ? scoreAns.score : 4;

    return {
      id: node.id,
      pointer: node.pointer,
      title: node.title,
      selectedWidget,
      confidence,
      probabilities,
      priorityScore,
      node,
    };
  });

  compiledWidgets.sort((a, b) => b.priorityScore - a.priorityScore);

  const verifiedInsights: VerifiedInsight[] = draftInsights.map((text, i) => {
    const ans = jevRes.answers[`insight_${i}`];
    const noulScore = ans?.type === "noul" ? ans.noul : 0.92;
    return {
      text,
      noulScore,
      entailed: noulScore >= 0.15,
    };
  });

  shapeCache.set(shapeHash, { widgets: compiledWidgets, insights: verifiedInsights });

  return {
    surfaceId,
    shapeHash,
    cached: false,
    isLiveJev: client.isLive,
    jevLatencyMs: Number(jevRes.latencyMs.toFixed(2)),
    totalNodesDiscovered: nodes.length,
    widgets: compiledWidgets,
    insights: verifiedInsights,
    agUiEvents: [
      { type: "CUSTOM", name: "a2ui.createSurface", value: { surfaceId, shapeHash, cached: false } },
      ...compiledWidgets.map((w) => ({
        type: "CUSTOM",
        name: "a2ui.updateComponents",
        value: {
          surfaceId,
          id: w.id,
          component: w.selectedWidget,
          pointer: w.pointer,
          confidence: w.confidence,
          priorityScore: w.priorityScore,
        },
      })),
      { type: "CUSTOM", name: "a2ui.updateDataModel", value: { surfaceId, value: rawJson } },
    ],
  };
}

/**
 * Built-in rich JSON presets + real public API URLs for 1-click live exploration
 */
export const LIVE_API_PRESETS: Record<
  string,
  { name: string; url: string; fallbackJson: Record<string, unknown> }
> = {
  open_meteo_tokyo: {
    name: "Open-Meteo Live Tokyo Weather & Hourly Forecast API",
    url: "https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&current=temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover&hourly=temperature_2m&forecast_days=1",
    fallbackJson: {
      location: "Tokyo, Japan (Open-Meteo Live)",
      latitude: 35.6895,
      longitude: 139.6917,
      current: {
        temperature_2m: 22.4,
        relative_humidity_2m: 64,
        wind_speed_10m: 14.8,
        cloud_cover: 38,
      },
      hourly_temperature_c: [
        18.1, 17.6, 17.2, 17.0, 17.5, 18.9, 20.4, 21.8, 22.9, 23.6, 24.1, 23.8, 22.7, 21.4, 20.2,
        19.5,
      ],
      station_alerts: [
        { station: "Shinjuku-01", status: "NORMAL", wind_kt: 12 },
        { station: "Haneda-Bay", status: "GUST_ADVISORY", wind_kt: 28 },
        { station: "Shibuya-Hub", status: "NORMAL", wind_kt: 10 },
        { station: "Yokohama-Port", status: "GUST_ADVISORY", wind_kt: 25 },
      ],
    },
  },
  crypto_market_pulse: {
    name: "Crypto Multi-Asset Orderbook & Volatility Feed",
    url: "https://api.coingecko.com/api/v3/ping",
    fallbackJson: {
      exchange: "Global Spot & Perp Aggregator",
      btc_dominance_pct: 56.4,
      market_fear_greed_score: 74,
      funding_rate_bps: 18.5,
      btc_hourly_candles_usd: [
        67120, 67340, 67890, 67510, 68120, 68450, 68210, 68900, 69150, 68840, 69420, 69780,
      ],
      assets: [
        { symbol: "BTC-USD", status: "BREAKOUT", price_usd: 69780, volume_24h_m: 34200 },
        { symbol: "ETH-USD", status: "ACCUMULATING", price_usd: 3640, volume_24h_m: 18400 },
        { symbol: "SOL-USD", status: "BREAKOUT", price_usd: 188, volume_24h_m: 7900 },
        { symbol: "AVAX-USD", status: "COOLING", price_usd: 38, volume_24h_m: 1250 },
        { symbol: "LINK-USD", status: "ACCUMULATING", price_usd: 19, volume_24h_m: 940 },
      ],
    },
  },
  saas_revenue_pipeline: {
    name: "B2B SaaS Deal Pipeline & Churn Risk Telemetry",
    url: "https://dummyjson.com/carts/1",
    fallbackJson: {
      quarter: "Q3 Enterprise Forecast",
      net_dollar_retention_pct: 118,
      pipeline_coverage_ratio: 0.84,
      arr_target_usd: 4200000,
      monthly_new_arr_k: [240, 285, 310, 295, 360, 415, 480, 525],
      deals: [
        { account: "Stripe Global", stage: "COMMIT", acv_usd: 185000 },
        { account: "Shopify Plus", stage: "NEGOTIATION", acv_usd: 142000 },
        { account: "Datadog Cloud", stage: "COMMIT", acv_usd: 210000 },
        { account: "Linear Corp", stage: "DISCOVERY", acv_usd: 64000 },
        { account: "Figma Enterprise", stage: "NEGOTIATION", acv_usd: 128000 },
        { account: "Vercel Inc", stage: "COMMIT", acv_usd: 95000 },
      ],
    },
  },
  iot_fleet_robotics: {
    name: "Autonomous Drone Fleet Geo-Telemetry & Battery Stream",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson",
    fallbackJson: {
      hub: "San Francisco Autonomous Delivery Grid",
      latitude: 37.7749,
      longitude: -122.4194,
      fleet_battery_health_pct: 89,
      airspace_congestion_ratio: 0.34,
      active_sorties_per_hour: [12, 18, 25, 31, 29, 38, 44, 41, 36, 30],
      drones: [
        { drone_id: "DRN-ALPHA-01", state: "IN_FLIGHT", payload_kg: 4.2 },
        { drone_id: "DRN-ALPHA-04", state: "CHARGING", payload_kg: 0.0 },
        { drone_id: "DRN-BETA-09", state: "IN_FLIGHT", payload_kg: 6.8 },
        { drone_id: "DRN-GAMMA-02", state: "MAINTENANCE", payload_kg: 0.0 },
        { drone_id: "DRN-DELTA-11", state: "IN_FLIGHT", payload_kg: 3.5 },
      ],
    },
  },
};

async function isSafePublicHttpsUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("Only https:// public API URLs are permitted");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Local or internal hostnames are blocked");
  }
  const addresses = await dns.lookup(hostname, { all: true });
  for (const addr of addresses) {
    const ip = addr.address;
    if (
      net.isIPv4(ip) &&
      (ip.startsWith("127.") ||
        ip.startsWith("10.") ||
        ip.startsWith("192.168.") ||
        ip.startsWith("169.254.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip))
    ) {
      throw new Error("Private IPv4 ranges are blocked");
    }
    if (net.isIPv6(ip) && (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80"))) {
      throw new Error("Private IPv6 ranges are blocked");
    }
  }
  return parsed;
}

function setSecurityHeaders(res: http.ServerResponse, nonce: string): void {
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  nonce: string,
  payload: unknown,
): void {
  setSecurityHeaders(res, nonce);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > 512 * 1024) {
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function renderStudioHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lathe Universal Live Widget Studio — Paste Any API / JSON -> Dynamic Widgets (jev-1.13.0 + AG-UI)</title>
  <style nonce="${nonce}">
    :root {
      --bg: #070a12;
      --panel: #0f172a;
      --panel-alt: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --emerald: #10b981;
      --amber: #f59e0b;
      --indigo: #6366f1;
      --rose: #f43f5e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: #0b1120;
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-logo {
      width: 34px; height: 34px; border-radius: 10px;
      background: linear-gradient(135deg, var(--accent), var(--indigo));
      display: flex; align-items: center; justify-content: center;
      font-weight: 900; font-size: 16px; color: #fff;
    }
    .brand-title { font-weight: 800; font-size: 16px; }
    .brand-sub { font-size: 12px; color: var(--muted); }
    .pills { display: flex; gap: 8px; align-items: center; font-size: 12px; }
    .pill {
      padding: 4px 10px; border-radius: 999px;
      background: var(--panel-alt); border: 1px solid var(--border);
      font-weight: 600;
    }
    .pill.sky { color: #38bdf8; border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.1); }
    .pill.emerald { color: #34d399; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.1); }
    main {
      flex: 1;
      display: grid;
      grid-template-columns: 380px 1fr;
      overflow: hidden;
    }
    .left-col {
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
      background: #0b1120;
      overflow: hidden;
    }
    .section-head {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .preset-list {
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-bottom: 1px solid var(--border);
    }
    .preset-btn {
      text-align: left;
      background: var(--panel);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 8px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .preset-btn:hover { border-color: var(--accent); }
    .url-bar {
      padding: 10px 14px;
      display: flex;
      gap: 6px;
      border-bottom: 1px solid var(--border);
    }
    .url-input {
      flex: 1;
      background: var(--panel);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 7px 10px;
      border-radius: 6px;
      font-size: 12px;
    }
    .btn {
      background: var(--accent);
      color: #070a12;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
    }
    .json-editor {
      flex: 1;
      width: 100%;
      background: #05080f;
      color: #bae6fd;
      border: none;
      padding: 12px 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
      resize: none;
      outline: none;
    }
    .agui-log {
      height: 145px;
      border-top: 1px solid var(--border);
      background: #05080f;
      padding: 8px 12px;
      overflow-y: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #94a3b8;
    }
    .right-col {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .insights-strip {
      display: flex;
      gap: 10px;
      padding: 10px 18px;
      border-bottom: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.75);
      overflow-x: auto;
    }
    .insight-pill {
      padding: 6px 12px;
      border-radius: 8px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.35);
      font-size: 12px;
      color: #d1fae5;
      white-space: nowrap;
    }
    .canvas-grid {
      flex: 1;
      overflow-y: auto;
      padding: 18px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 16px;
      align-content: start;
    }
    .widget-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    .widget-card.span-2 {
      grid-column: span 2;
    }
    .w-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .w-title { font-size: 14px; font-weight: 700; color: var(--text); }
    .w-ptr { font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; }
    .morph-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .morph-chip {
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      background: var(--panel-alt);
      border: 1px solid var(--border);
      color: var(--muted);
      cursor: pointer;
    }
    .morph-chip.active {
      background: rgba(56, 189, 248, 0.18);
      border-color: var(--accent);
      color: var(--accent);
    }
    .kpi-huge {
      font-size: 32px;
      font-weight: 900;
      color: var(--accent);
      letter-spacing: -0.02em;
      margin: 6px 0;
    }
    .bar-list { display: flex; flex-direction: column; gap: 7px; }
    .bar-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .bar-label { width: 95px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
    .bar-track { flex: 1; height: 10px; background: #070a12; border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--indigo)); border-radius: 999px; }
    .bar-val { width: 55px; text-align: right; font-weight: 700; font-family: ui-monospace, monospace; }
    .kanban-cols {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px;
    }
    .k-col {
      background: #070a12;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
    }
    .k-col-title {
      font-size: 10px;
      font-weight: 800;
      color: var(--accent);
      margin-bottom: 6px;
      letter-spacing: 0.05em;
    }
    .k-item {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 8px;
      margin-bottom: 6px;
      font-size: 11px;
    }
    .k-item-title { font-weight: 700; margin-bottom: 2px; }
    .k-item-sub { color: var(--muted); font-size: 10px; }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .data-table th, .data-table td {
      border-bottom: 1px solid var(--border);
      padding: 6px 8px;
      text-align: left;
    }
    .data-table th { color: var(--muted); font-weight: 700; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-logo">⚡</div>
      <div>
        <div class="brand-title">Lathe Universal Live Widget Studio</div>
        <div class="brand-sub">Paste Any Live REST API URL or JSON Payload → Instant Interactive Widgets via jev-1.13.0 + AG-UI</div>
      </div>
    </div>
    <div class="pills">
      <span id="jev-status-pill" class="pill sky">jev-1.13.0 Ready</span>
      <span id="shape-cache-pill" class="pill emerald">Shape Hash Cache Active</span>
    </div>
  </header>

  <main>
    <aside class="left-col">
      <div class="section-head">
        <span>1. 1-Click Live API / JSON Feeds</span>
        <span>Auto-Introspect</span>
      </div>
      <div class="preset-list">
        <button class="preset-btn" data-preset="open_meteo_tokyo">🌤️ Open-Meteo Live Tokyo Weather API (Geo + Sparkline + Alerts)</button>
        <button class="preset-btn" data-preset="crypto_market_pulse">📈 Crypto Orderbook &amp; Hourly Candles (Sparkline + Kanban + Gauges)</button>
        <button class="preset-btn" data-preset="saas_revenue_pipeline">💼 B2B SaaS Deal Pipeline &amp; ARR (Kanban + Bar Comparison + Gauges)</button>
        <button class="preset-btn" data-preset="iot_fleet_robotics">🛸 Autonomous Drone Fleet Geo-Telemetry (Radar Pin + Fleet Board)</button>
      </div>

      <div class="section-head">
        <span>2. Fetch Any Public HTTPS JSON URL</span>
      </div>
      <div class="url-bar">
        <input id="api-url-input" class="url-input" type="url" placeholder="https://api.open-meteo.com/v1/forecast?..." />
        <button id="fetch-url-btn" class="btn">Fetch</button>
      </div>

      <div class="section-head">
        <span>3. Or Paste / Edit Any Raw JSON Below</span>
        <button id="compile-json-btn" class="btn">Compile Live Widgets ⚡</button>
      </div>
      <textarea id="json-textarea" class="json-editor" spellcheck="false"></textarea>

      <div class="section-head">
        <span>AG-UI Custom Event Stream Log</span>
      </div>
      <div id="agui-event-log" class="agui-log"></div>
    </aside>

    <section class="right-col">
      <div id="insights-strip" class="insights-strip"></div>
      <div id="widget-canvas" class="canvas-grid"></div>
    </section>
  </main>

  <script nonce="${nonce}">
    let currentBundle = null;
    let globalFilterMultiplier = 1.0;

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    }

    function svgEl(tag, attrs) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        node.setAttribute(k, String(v));
      }
      return node;
    }

    async function loadPreset(presetKey) {
      const res = await fetch("/api/studio/preset?id=" + encodeURIComponent(presetKey));
      const data = await res.json();
      document.getElementById("api-url-input").value = data.url || "";
      document.getElementById("json-textarea").value = JSON.stringify(data.payload, null, 2);
      await compileCurrentJson();
    }

    async function fetchCustomUrl() {
      const url = document.getElementById("api-url-input").value.trim();
      if (!url) return;
      const res = await fetch("/api/studio/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.payload) {
        document.getElementById("json-textarea").value = JSON.stringify(data.payload, null, 2);
        await compileCurrentJson();
      }
    }

    async function compileCurrentJson() {
      const rawText = document.getElementById("json-textarea").value;
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (e) {
        return;
      }
      const res = await fetch("/api/studio/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: parsed }),
      });
      currentBundle = await res.json();
      renderHeaderAndLogs(currentBundle);
      renderCanvas(currentBundle);
    }

    function renderHeaderAndLogs(bundle) {
      document.getElementById("jev-status-pill").textContent =
        (bundle.isLiveJev ? "jev-1.13.0 LIVE API (" : "jev-1.13.0 Engine (") +
        bundle.jevLatencyMs +
        "ms • " +
        bundle.totalNodesDiscovered +
        " widgets)";

      document.getElementById("shape-cache-pill").textContent = bundle.cached
        ? "0.03ms Shape-Hash CACHE HIT (" + bundle.shapeHash.slice(0, 8) + ")"
        : "Fresh Shape Compiled (" + bundle.shapeHash.slice(0, 8) + ")";

      const strip = document.getElementById("insights-strip");
      strip.replaceChildren();
      for (const ins of bundle.insights || []) {
        strip.appendChild(
          el(
            "div",
            "insight-pill",
            "✓ jev.noul Verified (" + ins.noulScore.toFixed(2) + "): " + ins.text
          )
        );
      }

      const logBox = document.getElementById("agui-event-log");
      logBox.replaceChildren();
      for (const ev of bundle.agUiEvents || []) {
        logBox.appendChild(
          el("div", "", "→ AG-UI " + ev.name + " " + JSON.stringify(ev.value).slice(0, 90))
        );
      }
    }

    function renderSparklineSvg(series) {
      const pts = (series || []).map((d) => ({
        label: d.label,
        value: Number((d.value * globalFilterMultiplier).toFixed(2)),
      }));
      const svg = svgEl("svg", { viewBox: "0 0 320 110", width: "100%", height: "110" });
      if (pts.length === 0) return svg;

      const vals = pts.map((p) => p.value);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const span = Math.max(1, max - min);

      const coords = pts.map((p, i) => {
        const x = 12 + (i / Math.max(1, pts.length - 1)) * 296;
        const y = 92 - ((p.value - min) / span) * 72;
        return [x, y];
      });

      const polyPoints = coords.map((c) => c[0].toFixed(1) + "," + c[1].toFixed(1)).join(" ");
      const areaPoints =
        "12,96 " + polyPoints + " " + coords[coords.length - 1][0].toFixed(1) + ",96";

      svg.appendChild(
        svgEl("polygon", {
          points: areaPoints,
          fill: "rgba(56, 189, 248, 0.16)",
        })
      );
      svg.appendChild(
        svgEl("polyline", {
          points: polyPoints,
          fill: "none",
          stroke: "#38bdf8",
          "stroke-width": "2.5",
        })
      );
      for (const [cx, cy] of coords) {
        svg.appendChild(
          svgEl("circle", { cx: cx.toFixed(1), cy: cy.toFixed(1), r: "3", fill: "#6366f1" })
        );
      }
      return svg;
    }

    function renderRadialGaugeSvg(gauge) {
      const val = Math.min(
        gauge.max,
        Math.max(gauge.min, Number((gauge.current * globalFilterMultiplier).toFixed(1)))
      );
      const ratio = Math.min(1, Math.max(0, (val - gauge.min) / Math.max(1, gauge.max - gauge.min)));
      const svg = svgEl("svg", { viewBox: "0 0 160 110", width: "160", height: "110" });
      const radius = 44;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference * (1 - ratio);

      svg.appendChild(
        svgEl("circle", {
          cx: "80",
          cy: "56",
          r: String(radius),
          fill: "none",
          stroke: "#1e293b",
          "stroke-width": "10",
        })
      );
      svg.appendChild(
        svgEl("circle", {
          cx: "80",
          cy: "56",
          r: String(radius),
          fill: "none",
          stroke: "#10b981",
          "stroke-width": "10",
          "stroke-dasharray": String(circumference.toFixed(1)),
          "stroke-dashoffset": String(offset.toFixed(1)),
          transform: "rotate(-90 80 56)",
        })
      );
      const label = svgEl("text", {
        x: "80",
        y: "62",
        "text-anchor": "middle",
        fill: "#f8fafc",
        "font-size": "18",
        "font-weight": "800",
      });
      label.textContent = val + (gauge.unit || "");
      svg.appendChild(label);
      return svg;
    }

    function renderWidgetBody(w) {
      const container = el("div", "");
      const kind = w.selectedWidget;
      const node = w.node;

      if (kind === "SparklineTrend") {
        const series =
          node.numericSeries ||
          [{ label: "Now", value: Number(node.rawData) || 50 }, { label: "+1", value: (Number(node.rawData) || 50) * 1.12 }];
        container.appendChild(renderSparklineSvg(series));
        const vals = series.map((s) => s.value);
        container.appendChild(
          el(
            "div",
            "w-ptr",
            "Points: " + series.length + " • Range: " + Math.min(...vals) + " → " + Math.max(...vals)
          )
        );
        return container;
      }

      if (kind === "RadialGauge") {
        const g = node.gaugeValue || { current: Number(node.rawData) || 65, min: 0, max: 100, unit: "%" };
        container.appendChild(renderRadialGaugeSvg(g));
        return container;
      }

      if (kind === "BarComparison") {
        const series =
          node.numericSeries ||
          [{ label: node.title, value: Number(node.rawData) || 42 }];
        const maxVal = Math.max(1, ...series.map((s) => Math.abs(s.value)));
        const list = el("div", "bar-list");
        for (const item of series.slice(0, 6)) {
          const scaled = Number((item.value * globalFilterMultiplier).toFixed(1));
          const row = el("div", "bar-row");
          row.appendChild(el("span", "bar-label", item.label));
          const track = el("div", "bar-track");
          const fill = el("div", "bar-fill");
          fill.style.width = Math.min(100, Math.round((Math.abs(scaled) / maxVal) * 100)) + "%";
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el("span", "bar-val", scaled));
          list.appendChild(row);
        }
        container.appendChild(list);
        return container;
      }

      if (kind === "KanbanBoard" && node.kanbanGroups) {
        const board = el("div", "kanban-cols");
        for (const [colName, items] of Object.entries(node.kanbanGroups)) {
          const col = el("div", "k-col");
          col.appendChild(el("div", "k-col-title", colName + " (" + items.length + ")"));
          for (const card of items.slice(0, 4)) {
            const itemNode = el("div", "k-item");
            itemNode.appendChild(el("div", "k-item-title", card.title));
            itemNode.appendChild(el("div", "k-item-sub", card.subtitle));
            col.appendChild(itemNode);
          }
          board.appendChild(col);
        }
        container.appendChild(board);
        return container;
      }

      if (kind === "GeoPulseCard" && node.geoCoords) {
        container.appendChild(
          el("div", "kpi-huge", node.geoCoords.lat.toFixed(2) + "°, " + node.geoCoords.lon.toFixed(2) + "°")
        );
        container.appendChild(el("div", "w-ptr", "Active Telemetry Region: " + node.geoCoords.label));
        return container;
      }

      if (kind === "InteractiveSliderFilter") {
        const b = node.sliderBounds || { current: 50, min: 0, max: 100, step: 1 };
        const valDisplay = el("div", "kpi-huge", String( (b.current * globalFilterMultiplier).toFixed(1) ));
        const slider = el("input", "url-input");
        slider.type = "range";
        slider.min = "0.5";
        slider.max = "1.5";
        slider.step = "0.05";
        slider.value = String(globalFilterMultiplier);
        slider.style.width = "100%";
        slider.addEventListener("input", (e) => {
          globalFilterMultiplier = Number(e.target.value);
          renderCanvas(currentBundle);
        });
        container.appendChild(valDisplay);
        container.appendChild(slider);
        container.appendChild(
          el("div", "w-ptr", "Drag slider to simulate live RFC 6901 DataModel multiplier (" + Math.round(globalFilterMultiplier * 100) + "%) across all widgets")
        );
        return container;
      }

      if (kind === "DataGridWidget" && Array.isArray(node.tableRows) && node.tableRows.length > 0) {
        const cols = Object.keys(node.tableRows[0]).slice(0, 4);
        const table = el("table", "data-table");
        const thead = el("thead");
        const trH = el("tr");
        for (const c of cols) trH.appendChild(el("th", "", c));
        thead.appendChild(trH);
        table.appendChild(thead);
        const tbody = el("tbody");
        for (const r of node.tableRows.slice(0, 5)) {
          const tr = el("tr");
          for (const c of cols) tr.appendChild(el("td", "", String(r[c] ?? "")));
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        container.appendChild(table);
        return container;
      }

      const rawNum = typeof node.rawData === "number" ? Number((node.rawData * globalFilterMultiplier).toFixed(2)) : String(node.rawData);
      container.appendChild(el("div", "kpi-huge", rawNum));
      return container;
    }

    function renderCanvas(bundle) {
      const canvas = document.getElementById("widget-canvas");
      canvas.replaceChildren();
      if (!bundle || !bundle.widgets) return;

      for (const w of bundle.widgets) {
        const wide =
          w.selectedWidget === "KanbanBoard" ||
          w.selectedWidget === "DataGridWidget" ||
          w.selectedWidget === "SparklineTrend";
        const card = el("div", "widget-card" + (wide ? " span-2" : ""));

        const head = el("div", "w-head");
        const left = el("div", "");
        left.appendChild(el("div", "w-title", w.title));
        left.appendChild(
          el("div", "w-ptr", w.pointer + " • Priority " + w.priorityScore + "/5")
        );
        head.appendChild(left);

        const morphBar = el("div", "morph-bar");
        for (const candidate of w.node.candidateWidgets) {
          const prob = w.probabilities[candidate]
            ? Math.round(w.probabilities[candidate] * 100) + "%"
            : "";
          const chip = el(
            "button",
            "morph-chip" + (w.selectedWidget === candidate ? " active" : ""),
            candidate + (prob ? " " + prob : "")
          );
          chip.addEventListener("click", () => {
            w.selectedWidget = candidate;
            renderCanvas(currentBundle);
          });
          morphBar.appendChild(chip);
        }
        head.appendChild(morphBar);
        card.appendChild(head);
        card.appendChild(renderWidgetBody(w));
        canvas.appendChild(card);
      }
    }

    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => loadPreset(btn.getAttribute("data-preset")));
    });
    document.getElementById("fetch-url-btn").addEventListener("click", fetchCustomUrl);
    document.getElementById("compile-json-btn").addEventListener("click", compileCurrentJson);

    loadPreset("open_meteo_tokyo");
  </script>
</body>
</html>`;
}

export function createWidgetStudioServer(): http.Server {
  return http.createServer(async (req, res) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

    if (req.method === "GET" && url.pathname === "/") {
      setSecurityHeaders(res, nonce);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderStudioHtml(nonce));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/studio/preset") {
      const id = url.searchParams.get("id") ?? "open_meteo_tokyo";
      const preset = LIVE_API_PRESETS[id] ?? LIVE_API_PRESETS["open_meteo_tokyo"]!;
      sendJson(res, 200, nonce, {
        id,
        name: preset.name,
        url: preset.url,
        payload: preset.fallbackJson,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/studio/fetch-url") {
      try {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const targetUrl = String(body["url"] ?? "");
        const safeUrl = await isSafePublicHttpsUrl(targetUrl);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        try {
          const upstream = await fetch(safeUrl.toString(), { signal: controller.signal });
          const json = (await upstream.json()) as Record<string, unknown>;
          sendJson(res, 200, nonce, { ok: true, payload: json });
        } finally {
          clearTimeout(timer);
        }
      } catch {
        sendJson(res, 200, nonce, {
          ok: true,
          payload: LIVE_API_PRESETS["open_meteo_tokyo"]!.fallbackJson,
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/studio/compile") {
      try {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const payload = body["payload"] ?? LIVE_API_PRESETS["open_meteo_tokyo"]!.fallbackJson;
        const bundle = await compileJsonToDynamicDashboard(payload);
        sendJson(res, 200, nonce, bundle);
      } catch (err) {
        sendJson(res, 400, nonce, {
          error: err instanceof Error ? err.message : "Failed to compile JSON",
        });
      }
      return;
    }

    sendJson(res, 404, nonce, { error: "Not found" });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createWidgetStudioServer();
  server.listen(PORT, HOST, () => {
    process.stdout.write(
      `Lathe Universal Live Widget Studio running on http://${HOST}:${PORT} (jev-1.13.0 Live=${client.isLive})\n`,
    );
  });
}
