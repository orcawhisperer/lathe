import {
  type ComponentCalibration,
  resolve,
  unescapeToken,
} from "@orcawhisperer/lathe-core";

export interface RenderSurfaceOptions {
  readonly messages: ReadonlyArray<Record<string, unknown>>;
  readonly state: unknown;
  readonly calibration?: Readonly<Record<string, ComponentCalibration>>;
  /** Confidence threshold below which a component degrades to a read-only fallback card (default: 0.60). */
  readonly lowConfidenceThreshold?: number;
  /** Confidence threshold below which a runner-up swap badge is displayed (default: 0.85). */
  readonly runnerUpBadgeThreshold?: number;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isBinding(v: unknown): v is { path: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)["path"] === "string"
  );
}

export function resolveBoundValue(state: unknown, propVal: unknown): {
  readonly value: unknown;
  readonly pointer: string | null;
} {
  if (isBinding(propVal)) {
    try {
      return { value: resolve(state, propVal.path), pointer: propVal.path };
    } catch {
      return { value: undefined, pointer: propVal.path };
    }
  }
  return { value: propVal, pointer: null };
}

/**
 * Immutably apply a two-way data binding update at an RFC 6901 JSON Pointer.
 * Used when the user edits an `<Input>` or toggles a `<Switch>` on a compiled surface.
 */
export function applyPointerPatch<T>(state: T, pointer: string, newValue: unknown): T {
  const clone = structuredClone(state) as Record<string, unknown>;
  if (!pointer || pointer === "/") return newValue as T;
  const segments = pointer
    .replace(/^\/+/, "")
    .split("/")
    .map((s) => unescapeToken(s));

  let curr: Record<string, unknown> | unknown[] = clone;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (Array.isArray(curr)) {
      const idx = Number(seg);
      curr = curr[idx] as Record<string, unknown>;
    } else {
      curr = curr[seg] as Record<string, unknown>;
    }
  }
  const last = segments.at(-1)!;
  if (Array.isArray(curr)) {
    curr[Number(last)] = newValue;
  } else if (typeof curr === "object" && curr !== null) {
    curr[last] = newValue;
  }
  return clone as T;
}

/**
 * Render an A2UI v0.9 message bundle into shadcn/ui semantic HTML with confidence-driven
 * degradation (`lowConfidenceThreshold` / `runnerUpBadgeThreshold`) and RFC 6901 pointer hooks.
 */
export function renderSurfaceToHtml(options: RenderSurfaceOptions): string {
  const {
    messages,
    state,
    calibration = {},
    lowConfidenceThreshold = 0.6,
    runnerUpBadgeThreshold = 0.85,
  } = options;

  const updateMsg = messages.find((m) => "updateComponents" in m) as
    | { updateComponents: { components: Array<Record<string, unknown>> } }
    | undefined;
  if (!updateMsg) return `<div class="lathe-empty">No components in surface</div>`;

  const components = updateMsg.updateComponents.components;
  const byId = new Map<string, Record<string, unknown>>();
  for (const c of components) {
    byId.set(String(c["id"] ?? ""), c);
  }

  function renderNode(id: string): string {
    const comp = byId.get(id);
    if (!comp) return "";
    const cname = String(comp["component"] ?? "");
    const calib = calibration[id];

    // Containers
    if (cname === "Stack" || cname === "Column" || cname === "Row") {
      const dir = cname === "Row" || comp["direction"] === "row" ? "row" : "column";
      const children = Array.isArray(comp["children"])
        ? (comp["children"] as string[]).map((cid) => renderNode(cid)).join("")
        : "";
      return `<div class="lathe-stack lathe-stack-${dir}" data-lathe-id="${escapeHtml(id)}">${children}</div>`;
    }

    if (cname === "Card") {
      const title = escapeHtml(String(comp["title"] ?? "Section"));
      const children = Array.isArray(comp["children"])
        ? (comp["children"] as string[]).map((cid) => renderNode(cid)).join("")
        : "";
      return `<section class="lathe-card" data-lathe-id="${escapeHtml(id)}">
        <header class="lathe-card-header"><h3 class="lathe-card-title">${title}</h3></header>
        <div class="lathe-card-body">${children}</div>
      </section>`;
    }

    // Confidence-driven degradation check for leaf components
    if (calib && calib.confidence < lowConfidenceThreshold) {
      const rawVal = resolve(state, calib.pointer);
      return `<div class="lathe-degraded-card" data-lathe-id="${escapeHtml(id)}" data-lathe-confidence="${calib.confidence.toFixed(2)}">
        <div class="lathe-degraded-header">
          <span class="lathe-degraded-label">${escapeHtml(calib.pointer)}</span>
          <span class="lathe-conf-pill lathe-conf-low">Low conf ${(calib.confidence * 100).toFixed(0)}% · Read-only fallback</span>
        </div>
        <div class="lathe-degraded-value">${escapeHtml(String(rawVal ?? ""))}</div>
      </div>`;
    }

    const runnerUpChip =
      calib && calib.confidence < runnerUpBadgeThreshold && calib.runnerUp
        ? `<button type="button" class="lathe-runner-up-chip" data-lathe-swap-target="${escapeHtml(id)}" data-lathe-runner-up="${escapeHtml(calib.runnerUp)}">
            Did you mean <strong>${escapeHtml(calib.runnerUp)}</strong>? (${(calib.runnerUpProbability * 100).toFixed(0)}%)
          </button>`
        : "";

    const confBadge = calib
      ? `<span class="lathe-conf-pill" title="Pointer: ${escapeHtml(calib.pointer)}">${escapeHtml(cname)} · ${(calib.confidence * 100).toFixed(0)}%</span>`
      : "";

    let bodyHtml = "";
    if (cname === "Stat") {
      const { value, pointer } = resolveBoundValue(state, comp["value"]);
      const label = escapeHtml(String(comp["label"] ?? ""));
      const format = String(comp["format"] ?? "decimal");
      const num = Number(value ?? 0);
      const formatted =
        format === "currency"
          ? `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : format === "integer"
            ? Math.round(num).toLocaleString("en-US")
            : String(num);
      bodyHtml = `<div class="lathe-stat" data-lathe-pointer="${escapeHtml(pointer ?? "")}">
        <div class="lathe-stat-top"><span class="lathe-label">${label}</span>${confBadge}</div>
        <div class="lathe-stat-figure">${escapeHtml(formatted)}</div>
      </div>`;
    } else if (cname === "Progress") {
      const { value, pointer } = resolveBoundValue(state, comp["value"]);
      const label = escapeHtml(String(comp["label"] ?? ""));
      const tone = escapeHtml(String(comp["tone"] ?? "default"));
      const rawNum = Number(value ?? 0);
      const pct = Math.max(0, Math.min(100, rawNum <= 1 ? rawNum * 100 : rawNum));
      bodyHtml = `<div class="lathe-progress" data-lathe-pointer="${escapeHtml(pointer ?? "")}">
        <div class="lathe-stat-top"><span class="lathe-label">${label}</span><span>${pct.toFixed(0)}%</span>${confBadge}</div>
        <div class="lathe-progress-track"><div class="lathe-progress-fill lathe-tone-${tone}" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
    } else if (cname === "Badge") {
      const { value, pointer } = resolveBoundValue(state, comp["text"]);
      const label = escapeHtml(String(comp["label"] ?? ""));
      const variant = escapeHtml(String(comp["variant"] ?? "default"));
      bodyHtml = `<div class="lathe-badge-row" data-lathe-pointer="${escapeHtml(pointer ?? "")}">
        <span class="lathe-label">${label}</span>
        <div class="lathe-badge-right">
          <span class="lathe-badge lathe-badge-${variant}">${escapeHtml(String(value ?? ""))}</span>
          ${confBadge}
        </div>
      </div>`;
    } else if (cname === "Alert") {
      const { value, pointer } = resolveBoundValue(state, comp["message"]);
      const title = escapeHtml(String(comp["title"] ?? "Notice"));
      const variant = escapeHtml(String(comp["variant"] ?? "default"));
      bodyHtml = `<div class="lathe-alert lathe-alert-${variant}" data-lathe-pointer="${escapeHtml(pointer ?? "")}">
        <div class="lathe-stat-top"><strong>${title}</strong>${confBadge}</div>
        <p class="lathe-alert-msg">${escapeHtml(String(value ?? ""))}</p>
      </div>`;
    } else if (cname === "Input") {
      const { value, pointer } = resolveBoundValue(state, comp["value"]);
      const label = escapeHtml(String(comp["label"] ?? ""));
      const inputType = escapeHtml(String(comp["inputType"] ?? "text"));
      const placeholder = comp["placeholder"] ? ` placeholder="${escapeHtml(String(comp["placeholder"]))}"` : "";
      bodyHtml = `<div class="lathe-input-group">
        <div class="lathe-stat-top"><label class="lathe-label">${label}</label>${confBadge}</div>
        <input class="lathe-input" type="${inputType}" value="${escapeHtml(String(value ?? ""))}"${placeholder} data-lathe-pointer="${escapeHtml(pointer ?? "")}" />
      </div>`;
    } else if (cname === "Select") {
      const { value, pointer } = resolveBoundValue(state, comp["value"]);
      const label = escapeHtml(String(comp["label"] ?? ""));
      const currentVal = String(value ?? "");
      const opts = Array.isArray(comp["options"]) ? (comp["options"] as string[]) : [currentVal];
      const optionsHtml = opts
        .map(
          (o) =>
            `<option value="${escapeHtml(String(o))}" ${String(o) === currentVal ? "selected" : ""}>${escapeHtml(String(o))}</option>`,
        )
        .join("");
      bodyHtml = `<div class="lathe-input-group">
        <div class="lathe-stat-top"><label class="lathe-label">${label}</label>${confBadge}</div>
        <select class="lathe-select" data-lathe-pointer="${escapeHtml(pointer ?? "")}">${optionsHtml}</select>
      </div>`;
    } else if (cname === "Textarea") {
      const { value, pointer } = resolveBoundValue(state, comp["value"]);
      const label = escapeHtml(String(comp["label"] ?? ""));
      const rowsAttr = comp["size"] === "expanded" ? 5 : 3;
      const placeholder = comp["placeholder"] ? ` placeholder="${escapeHtml(String(comp["placeholder"]))}"` : "";
      bodyHtml = `<div class="lathe-input-group">
        <div class="lathe-stat-top"><label class="lathe-label">${label}</label>${confBadge}</div>
        <textarea class="lathe-textarea" rows="${rowsAttr}"${placeholder} data-lathe-pointer="${escapeHtml(pointer ?? "")}">${escapeHtml(String(value ?? ""))}</textarea>
      </div>`;
    } else if (cname === "Slider") {
      const { value, pointer } = resolveBoundValue(state, comp["value"]);
      const label = escapeHtml(String(comp["label"] ?? ""));
      const min = Number(comp["min"] ?? 0);
      const max = Number(comp["max"] ?? 100);
      const numVal = Number(value ?? min);
      bodyHtml = `<div class="lathe-slider-group">
        <div class="lathe-stat-top"><label class="lathe-label">${label}</label><span>${numVal} (${min}–${max})</span>${confBadge}</div>
        <input type="range" class="lathe-slider" min="${min}" max="${max}" value="${numVal}" data-lathe-pointer="${escapeHtml(pointer ?? "")}" />
      </div>`;
    } else if (cname === "Switch") {
      const { value, pointer } = resolveBoundValue(state, comp["checked"]);
      const label = escapeHtml(String(comp["label"] ?? ""));
      const checked = Boolean(value);
      bodyHtml = `<label class="lathe-switch-row">
        <span class="lathe-label">${label}</span>
        <div class="lathe-badge-right">
          <input type="checkbox" class="lathe-switch" ${checked ? "checked" : ""} data-lathe-pointer="${escapeHtml(pointer ?? "")}" />
          ${confBadge}
        </div>
      </label>`;
    } else if (cname === "Button") {
      const { value, pointer } = resolveBoundValue(state, comp["enabled"]);
      const label = escapeHtml(String(comp["label"] ?? "Action"));
      const variant = escapeHtml(String(comp["variant"] ?? "default"));
      const enabled = value !== false;
      const actionId = escapeHtml(String(typeof value === "string" ? value : (pointer ?? label)));
      bodyHtml = `<div class="lathe-button-row">
        <button type="button" class="lathe-button lathe-btn-${variant}" ${enabled ? "" : "disabled"} data-lathe-pointer="${escapeHtml(pointer ?? "")}" data-lathe-action-pointer="${escapeHtml(pointer ?? "")}" data-lathe-action="${actionId}">${label}</button>
        ${confBadge}
      </div>`;
    } else if (cname === "DataTable") {
      const { value, pointer } = resolveBoundValue(state, comp["rows"]);
      const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
      const columns = Array.isArray(comp["columns"])
        ? (comp["columns"] as Array<{ key: string; label: string; format?: string }>)
        : [];
      const title = escapeHtml(String(comp["title"] ?? "Table"));
      const density = escapeHtml(String(comp["density"] ?? "comfortable"));

      const thead = columns
        .map((col) => `<th>${escapeHtml(col.label || col.key)}</th>`)
        .join("");
      const tbody = rows
        .map((row, rIdx) => {
          const cells = columns
            .map((col) => {
              const rawCell = row[col.key];
              const cellPtr = pointer ? `${pointer}/${rIdx}/${col.key}` : "";
              let cellHtml = escapeHtml(String(rawCell ?? ""));
              if (col.format === "currency" && typeof rawCell === "number") {
                cellHtml = `$${rawCell.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              } else if (col.format === "integer" && typeof rawCell === "number") {
                cellHtml = Math.round(rawCell).toLocaleString("en-US");
              } else if (col.format === "badge") {
                cellHtml = `<span class="lathe-badge">${cellHtml}</span>`;
              }
              return `<td data-lathe-pointer="${escapeHtml(cellPtr)}">${cellHtml}</td>`;
            })
            .join("");
          return `<tr data-lathe-row="${rIdx}">${cells}</tr>`;
        })
        .join("");

      bodyHtml = `<div class="lathe-datatable lathe-density-${density}" data-lathe-pointer="${escapeHtml(pointer ?? "")}">
        <div class="lathe-stat-top"><strong>${title} (${rows.length})</strong>${confBadge}</div>
        <table class="lathe-table">
          <thead><tr>${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>`;
    } else if (cname === "DataList") {
      const { value, pointer } = resolveBoundValue(state, comp["rows"]);
      const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
      const columns = Array.isArray(comp["columns"])
        ? (comp["columns"] as Array<{ key: string; label: string; format?: string }>)
        : [];
      const title = escapeHtml(String(comp["title"] ?? "Activity"));

      const itemsHtml = rows
        .map((row, rIdx) => {
          const parts = columns
            .map((col) => {
              const rawCell = row[col.key];
              return `<span class="lathe-list-field"><strong>${escapeHtml(col.label)}:</strong> ${escapeHtml(String(rawCell ?? ""))}</span>`;
            })
            .join(" · ");
          return `<li class="lathe-list-item" data-lathe-row="${rIdx}">${parts}</li>`;
        })
        .join("");

      bodyHtml = `<div class="lathe-datalist" data-lathe-pointer="${escapeHtml(pointer ?? "")}">
        <div class="lathe-stat-top"><strong>${title} (${rows.length})</strong>${confBadge}</div>
        <ul class="lathe-list">${itemsHtml}</ul>
      </div>`;
    }

    return `<div class="lathe-leaf-wrapper" data-lathe-id="${escapeHtml(id)}">${bodyHtml}${runnerUpChip}</div>`;
  }

  return renderNode("root");
}
