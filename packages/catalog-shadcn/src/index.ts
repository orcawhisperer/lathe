import { Catalog, PhraseBank } from "@orcawhisperer/lathe-core";

/**
 * Default i18n PhraseBank for common commerce, billing, support, and SaaS domains.
 * Apps can extend or replace this with their own locale files (e.g. `en.json`).
 */
export const SHADCN_PHRASE_BANK: PhraseBank = new PhraseBank([
  {
    key: "order.amount_usd",
    text: "Charged Amount (USD)",
    notFor: "non-monetary counters, status words, or ratios",
    translations: {
      es: "Monto Cobrado (USD)",
      ja: "請求金額 (USD)",
      de: "Berechneter Betrag (USD)",
    },
  },
  {
    key: "order.status",
    text: "Fulfillment Status",
    notFor: "currency figures, email inputs, or multi-sentence banners",
    translations: {
      es: "Estado del Pedido",
      ja: "処理ステータス",
      de: "Auftragsstatus",
    },
  },
  {
    key: "order.risk_score",
    text: "Fraud Risk Index",
    notFor: "dollar prices, string statuses, or boolean switches",
    translations: {
      es: "Índice de Riesgo de Fraude",
      ja: "不正リスク指数",
      de: "Betrugsrisiko-Index",
    },
  },
  {
    key: "customer.email",
    text: "Customer Email Address",
    notFor: "numeric balances, status pills, or action triggers",
    translations: {
      es: "Correo Electrónico del Cliente",
      ja: "顧客メールアドレス",
      de: "Kunden-E-Mail-Adresse",
    },
  },
  {
    key: "customer.notes",
    text: "Investigation Notes",
    notFor: "short status tags or numeric KPIs",
    translations: {
      es: "Notas de Investigación",
      ja: "調査メモ",
      de: "Untersuchungsnotizen",
    },
  },
  {
    key: "policy.warning",
    text: "Policy Advisory",
    notFor: "single-word badges or editable form fields",
    translations: {
      es: "Aviso de Política",
      ja: "ポリシー通知",
      de: "Richtlinienhinweis",
    },
  },
  {
    key: "settings.auto_refund",
    text: "Automatic Refund Approval",
    notFor: "one-shot command buttons or numeric amounts",
    translations: {
      es: "Aprobación Automática de Reembolso",
      ja: "自動返金承認",
      de: "Automatische Rückerstattung",
    },
  },
  {
    key: "action.approve_refund",
    text: "Issue Immediate Refund",
    notFor: "passive settings toggles or read-only text",
    translations: {
      es: "Emitir Reembolso Inmediato",
      ja: "即時返金を実行",
      de: "Sofortige Rückerstattung auslösen",
    },
  },
  {
    key: "order.line_items",
    text: "Order Line Items",
    notFor: "single scalar fields or audit logs",
    translations: {
      es: "Artículos del Pedido",
      ja: "注文明細",
      de: "Bestellpositionen",
    },
  },
  {
    key: "sku",
    text: "SKU",
    notFor: "monetary totals or quantities",
    translations: {
      es: "Código SKU",
      ja: "商品コード (SKU)",
      de: "Artikelnummer (SKU)",
    },
  },
  {
    key: "qty",
    text: "Quantity",
    notFor: "dollar prices or SKU codes",
    translations: {
      es: "Cantidad",
      ja: "数量",
      de: "Menge",
    },
  },
  {
    key: "unit_price_usd",
    text: "Unit Price (USD)",
    notFor: "item counts or string identifiers",
    translations: {
      es: "Precio Unitario (USD)",
      ja: "単価 (USD)",
      de: "Stückpreis (USD)",
    },
  },
  {
    key: "resolution.decision",
    text: "Resolution Decision",
    notFor: "freeform memos or numeric amounts",
    translations: {
      es: "Decisión de Resolución",
      ja: "解決判定",
      de: "Lösungsentscheidung",
    },
  },
  {
    key: "resolution.memo",
    text: "Reviewer Resolution Memo",
    notFor: "short status tags or numeric sliders",
    translations: {
      es: "Memorando de Resolución del Revisor",
      ja: "担当者解決メモ",
      de: "Prüfer-Lösungsnotiz",
    },
  },
  {
    key: "resolution.refund_pct",
    text: "Refund Split Percentage",
    notFor: "fixed invoice totals or boolean toggles",
    translations: {
      es: "Porcentaje de Reembolso",
      ja: "返金割合 (%)",
      de: "Rückerstattungsanteil (%)",
    },
  },
  // GitHub PR Review domain
  {
    key: "pr.lines_changed",
    text: "Total Lines Changed",
    notFor: "coverage percentages or status pills",
    translations: {
      es: "Total de Líneas Modificadas",
      ja: "変更行数合計",
      de: "Geänderte Zeilen Gesamt",
    },
  },
  {
    key: "pr.ci_status",
    text: "CI Pipeline Status",
    notFor: "numeric counters or multiline comments",
    translations: {
      es: "Estado del Pipeline CI",
      ja: "CIパイプライン状態",
      de: "CI-Pipeline-Status",
    },
  },
  {
    key: "pr.coverage_ratio",
    text: "Diff Test Coverage",
    notFor: "line counts or action triggers",
    translations: {
      es: "Cobertura de Pruebas del Diff",
      ja: "差分テストカバレッジ",
      de: "Diff-Testabdeckung",
    },
  },
  {
    key: "pr.changed_files",
    text: "Changed Files in Pull Request",
    notFor: "scalar counters or single alerts",
    translations: {
      es: "Archivos Modificados en el PR",
      ja: "プルリクエストの変更ファイル",
      de: "Geänderte Dateien im Pull Request",
    },
  },
  {
    key: "pr.submit_review",
    text: "Submit Pull Request Review",
    notFor: "passive toggles or read-only stats",
    translations: {
      es: "Enviar Revisión del PR",
      ja: "PRレビューを送信",
      de: "PR-Review absenden",
    },
  },
  // Postgres Slow Query domain
  {
    key: "db.p99_latency_ms",
    text: "P99 Query Latency (ms)",
    notFor: "cache hit ratios or status strings",
    translations: {
      es: "Latencia de Consulta P99 (ms)",
      ja: "P99クエリ遅延 (ms)",
      de: "P99-Abfragelatenz (ms)",
    },
  },
  {
    key: "db.cache_hit_ratio",
    text: "Shared Buffer Cache Hit Ratio",
    notFor: "millisecond latencies or table rows",
    translations: {
      es: "Tasa de Aciertos de Caché",
      ja: "共有バッファキャッシュヒット率",
      de: "Buffer-Cache-Trefferquote",
    },
  },
  {
    key: "db.slow_queries",
    text: "Top Slow Query Digests",
    notFor: "single scalar KPIs or buttons",
    translations: {
      es: "Consultas Más Lentas",
      ja: "スロークエリ一覧",
      de: "Langsamste Abfragen",
    },
  },
  {
    key: "db.apply_index",
    text: "Create Concurrent Index",
    notFor: "read-only metrics or text areas",
    translations: {
      es: "Crear Índice Concurrente",
      ja: "並行インデックスを作成",
      de: "Concurrent-Index erstellen",
    },
  },
  // Kubernetes Pod Incident domain
  {
    key: "k8s.oom_restarts",
    text: "Container OOM Restarts (1h)",
    notFor: "memory ratios or pod lists",
    translations: {
      es: "Reinicios por OOM (1h)",
      ja: "OOM再起動回数 (1時間)",
      de: "Container-OOM-Neustarts (1h)",
    },
  },
  {
    key: "k8s.memory_saturation",
    text: "Node Memory Saturation",
    notFor: "restart counters or rollout actions",
    translations: {
      es: "Saturación de Memoria del Nodo",
      ja: "ノードメモリ使用率",
      de: "Knoten-Speicherauslastung",
    },
  },
  {
    key: "k8s.pods",
    text: "Affected Namespace Pods",
    notFor: "single counters or action triggers",
    translations: {
      es: "Pods Afectados en el Namespace",
      ja: "影響を受けたPod一覧",
      de: "Betroffene Namespace-Pods",
    },
  },
  {
    key: "k8s.execute_mitigation",
    text: "Execute Cluster Mitigation",
    notFor: "passive labels or sliders",
    translations: {
      es: "Ejecutar Mitigación del Clúster",
      ja: "クラスタ緩和策を実行",
      de: "Cluster-Mitigation ausführen",
    },
  },
]);

/**
 * Official `@lathe/shadcn` Component Catalog.
 *
 * Designed with mutually-exclusive contrastive `description` + `notFor` + `examples`
 * so `lintCatalog(SHADCN_CATALOG)` passes with 0 errors and 0 warnings, and
 * TypeSafe System One (`jev-1.13.0`) achieves sharp separation across component types.
 */
export const SHADCN_CATALOG: Catalog = new Catalog(
  "https://lathe.dev/catalogs/shadcn/v1",
  [
    // ── Layout Containers ────────────────────────────────────────────────────
    {
      name: "Stack",
      description:
        "Top-level vertical flex layout container that stacks child blocks in reading order.",
      container: true,
      props: [
        {
          name: "direction",
          kind: "enum",
          description: "Flex axis direction for stacking children.",
          options: {
            column: "stack blocks vertically from top to bottom",
            row: "arrange blocks horizontally side by side",
          },
        },
        {
          name: "gap",
          kind: "enum",
          description: "Spacing gap between stacked child blocks.",
          options: {
            sm: "compact 8px spacing",
            md: "standard 16px spacing",
            lg: "spacious 24px spacing",
          },
        },
      ],
    },
    {
      name: "Card",
      description:
        "Elevated bordered surface container with a header title that groups related child blocks into a visual section.",
      container: true,
      props: [
        {
          name: "title",
          kind: "phrase",
          description: "Section heading displayed in the card header.",
        },
      ],
    },

    // ── Display & Interactive Leaf Components ────────────────────────────────
    {
      name: "Stat",
      description:
        "KPI metric readout displaying a quantitative scalar number: currency price, dollar total, integer counter, or latency millisecond figure.",
      notFor:
        "Boolean true/false flags, normalized 0..1 progress ratios, enumerated status words, or editable text fields.",
      examples: [
        "/billing/duplicate_amount_usd = 184.5",
        "/metrics/active_sessions = 4210",
        "/performance/p95_latency_ms = 312",
      ],
      props: [
        {
          name: "value",
          kind: "binding",
          valueType: "number",
          description: "Numeric scalar pointer to render as the primary figure.",
        },
        {
          name: "label",
          kind: "phrase",
          description: "Caption above the metric figure.",
        },
        {
          name: "format",
          kind: "enum",
          description: "Number presentation format.",
          options: {
            currency:
              "monetary amount in dollars or local currency (usd, price, cost, balance, revenue, fee)",
            integer:
              "whole count of items, users, tickets, or events (count, total, attempts, seats)",
            decimal:
              "floating-point measurement, duration, or rate (latency_ms, weight, score_raw)",
          },
        },
      ],
    },
    {
      name: "Progress",
      description:
        "Horizontal completion bar visualizing a bounded ratio between 0 and 1 (or 0 to 100 percent) such as quota usage, risk index, or upload progress.",
      notFor:
        "Unbounded currency amounts, raw event counters, discrete string status tags, or boolean switches.",
      examples: [
        "/fraud/anomaly_ratio = 0.87",
        "/storage/quota_utilization_pct = 74",
        "/onboarding/completion_fraction = 0.6",
      ],
      props: [
        {
          name: "value",
          kind: "binding",
          valueType: "number",
          description: "Bounded ratio or percentage pointer.",
        },
        {
          name: "label",
          kind: "phrase",
          description: "Label displayed beside the progress bar.",
        },
        {
          name: "tone",
          kind: "enum",
          description: "Semantic color tone of the bar.",
          options: {
            default: "neutral progress or quota utilization bar",
            warning: "elevated threshold or caution utilization level",
            danger: "critical risk probability or near-limit saturation",
          },
        },
      ],
    },
    {
      name: "Badge",
      description:
        "Compact pill tag for a short categorical code, one-word lifecycle state, membership tier, or severity token (1 to 2 words maximum).",
      notFor:
        "Multi-word warning sentences, numeric amounts, editable text inputs, or boolean switches.",
      examples: [
        "/ticket/lifecycle_state = 'ESCALATED'",
        "/account/subscription_tier = 'ENTERPRISE'",
        "/payment/settlement_code = 'CAPTURED'",
      ],
      props: [
        {
          name: "text",
          kind: "binding",
          valueType: "string",
          description: "Short status token or tier string pointer.",
        },
        {
          name: "label",
          kind: "phrase",
          description: "Dimension label preceding the status pill.",
        },
        {
          name: "variant",
          kind: "enum",
          description: "Visual badge style.",
          options: {
            default: "primary active or standard state",
            secondary: "neutral informational tier or category",
            destructive: "failed, disputed, blocked, or critical state",
            outline: "pending, draft, or unverified state",
          },
        },
      ],
    },
    {
      name: "Alert",
      description:
        "Prominent callout banner presenting a full multi-word sentence explaining a compliance policy violation, system incident, or security advisory.",
      notFor:
        "Single-word status codes (use Badge), numeric KPIs (use Stat), or editable user fields (use Input).",
      examples: [
        "/compliance/breach_explanation = 'Chargeback window closes within 24 hours under network rules.'",
        "/incident/outage_summary = 'Upstream payment gateway is experiencing elevated timeouts.'",
        "/security/lockout_notice = 'Multiple failed MFA challenges detected from an unrecognized ASN.'",
      ],
      props: [
        {
          name: "message",
          kind: "binding",
          valueType: "string",
          description: "Full advisory sentence pointer.",
        },
        {
          name: "title",
          kind: "phrase",
          description: "Banner headline phrase.",
        },
        {
          name: "variant",
          kind: "enum",
          description: "Severity variant of the alert banner.",
          options: {
            default: "informational notice or general guidance banner",
            destructive: "urgent error, compliance breach, or high-severity warning banner",
          },
        },
      ],
    },
    {
      name: "Input",
      description:
        "Editable single-line form text box for modifying an identifier, electronic mail handle, phone string, URL, or customer name.",
      notFor:
        "Read-only alert sentences, one-word status pills, numeric KPI readouts, or boolean checkboxes.",
      examples: [
        "/profile/contact_email = 'alex.rivera@example.org'",
        "/shipping/tracking_reference = '1Z999AA10123456784'",
        "/organization/workspace_slug = 'acme-logistics-prod'",
      ],
      props: [
        {
          name: "value",
          kind: "binding",
          valueType: "string",
          description: "Editable string pointer bound to the input field.",
        },
        {
          name: "label",
          kind: "phrase",
          description: "Field label above the text input.",
        },
        {
          name: "inputType",
          kind: "enum",
          description: "HTML input type attribute.",
          options: {
            text: "general single-line string identifier or name",
            email: "electronic mail address containing @",
            url: "web hyperlink starting with https://",
          },
        },
      ],
    },
    {
      name: "Switch",
      description:
        "Interactive binary toggle switch bound to a boolean true/false flag that enables or disables a setting, lock, or feature flag.",
      notFor:
        "One-shot command triggers or action buttons, numeric counters, or string fields.",
      examples: [
        "/preferences/auto_renew_enabled = true",
        "/protection/freeze_card_flag = false",
        "/notifications/sms_opt_in = true",
      ],
      props: [
        {
          name: "checked",
          kind: "binding",
          valueType: "boolean",
          description: "Boolean flag pointer toggled by the switch.",
        },
        {
          name: "label",
          kind: "phrase",
          description: "Setting caption beside the switch.",
        },
      ],
    },
    {
      name: "Button",
      description:
        "Clickable action button that dispatches an immediate workflow command or state transition when an operation permission boolean is eligible.",
      notFor:
        "Passive configuration toggles (use Switch), numeric readouts, or text inputs.",
      examples: [
        "/actions/can_disburse_refund = true",
        "/workflows/allow_immediate_escalation = true",
        "/operations/trigger_manual_retry = true",
      ],
      props: [
        {
          name: "enabled",
          kind: "binding",
          valueType: "boolean",
          description: "Boolean eligibility pointer controlling whether the action is enabled.",
        },
        {
          name: "label",
          kind: "phrase",
          description: "Button action caption.",
        },
        {
          name: "variant",
          kind: "enum",
          description: "Visual button prominence.",
          options: {
            default: "primary affirmative workflow action",
            destructive: "irreversible cancellation, deletion, or chargeback action",
            outline: "secondary or non-destructive utility command",
          },
        },
      ],
    },
    {
      name: "Select",
      description:
        "Dropdown menu picker for choosing one option from a predefined schema list (allowedEnumChoices) such as disposition, queue, or priority.",
      notFor:
        "Read-only status pills without allowedEnumChoices (use Badge), freeform text boxes (use Input), or multiline remarks (use Textarea).",
      examples: [
        "/resolution/decision = 'APPROVE_FULL' (allowedEnumChoices: ['APPROVE_FULL', 'PARTIAL_CREDIT', 'REJECT_DISPUTE'])",
        "/routing/assigned_queue = 'BILLING_OPS' (allowedEnumChoices: ['BILLING_OPS', 'FRAUD_DESK'])",
        "/ticket/priority_level = 'P1' (allowedEnumChoices: ['P1', 'P2', 'P3'])",
      ],
      props: [
        {
          name: "value",
          kind: "binding",
          valueType: "string",
          description: "Pointer to the currently selected enum option string.",
        },
        {
          name: "label",
          kind: "phrase",
          description: "Label above the dropdown picker.",
        },
      ],
    },
    {
      name: "Textarea",
      description:
        "Multiline composer box for drafting a paragraph, empty resolution memo (emptyEditableField / multilineTextField), or reviewer narrative.",
      notFor:
        "Single-line email or tracking handles (use Input), read-only compliance banners (use Alert), or dropdown pickers (use Select).",
      examples: [
        "/resolution/reviewer_memo = '' (emptyEditableField: true, multilineTextField: true)",
        "/feedback/postmortem_notes = 'Root cause traced to duplicate webhook retry.' (multilineTextField: true)",
        "/support/customer_reply_draft = '' (emptyEditableField: true)",
      ],
      props: [
        {
          name: "value",
          kind: "binding",
          valueType: "string",
          description: "Pointer to the multiline or empty string field.",
        },
        {
          name: "label",
          kind: "phrase",
          description: "Label above the multiline composer.",
        },
        {
          name: "size",
          kind: "enum",
          description: "Vertical height of the textarea.",
          options: {
            compact: "3 lines height for brief notes",
            expanded: "6 lines height for detailed narratives",
          },
        },
      ],
    },
    {
      name: "Slider",
      description:
        "Draggable range scrubber for adjusting an editable numeric value within explicit min/max bounds (editableRangeBounds) such as payout split or cap.",
      notFor:
        "Read-only completion bars without editableRangeBounds (use Progress), raw dollar KPIs (use Stat), or boolean toggles (use Switch).",
      examples: [
        "/resolution/refund_split_pct = 50 (editableRangeBounds: {min: 0, max: 100})",
        "/throttling/rate_cap_rps = 250 (editableRangeBounds: {min: 10, max: 1000})",
        "/sampling/traffic_weight = 35 (editableRangeBounds: {min: 0, max: 100})",
      ],
      props: [
        {
          name: "value",
          kind: "binding",
          valueType: "number",
          description: "Pointer to the bounded numeric value adjusted by the slider.",
        },
        {
          name: "label",
          kind: "phrase",
          description: "Caption above the range slider.",
        },
      ],
    },

    // ── Homogeneous Collection / Array Components ────────────────────────────
    {
      name: "DataTable",
      collection: true,
      description:
        "Multi-column tabular grid for a homogeneous array of structured records containing numeric prices, quantities, SKUs, or multi-attribute rows.",
      notFor:
        "Chronological two-field audit timelines (use DataList), single scalar metrics (use Stat), or one-word status pills.",
      examples: [
        "/line_items = [{sku: 'PRO-SEAT', qty: 5, unit_price_usd: 49}]",
        "/invoices = [{invoice_code: 'INV-09', amount_usd: 420, state: 'PAID'}]",
        "/shipments = [{carrier: 'UPS', parcels: 3, weight_kg: 14.2}]",
      ],
      props: [
        {
          name: "rows",
          kind: "binding",
          description: "Pointer to the homogeneous array of row objects.",
        },
        {
          name: "title",
          kind: "phrase",
          description: "Table section title.",
        },
        {
          name: "density",
          kind: "enum",
          description: "Row vertical padding density.",
          options: {
            comfortable: "standard 12px table cell padding for 1 to 10 rows",
            compact: "condensed 6px table cell padding for dense financial or log tables",
          },
        },
      ],
    },
    {
      name: "DataList",
      collection: true,
      description:
        "Vertical chronological feed for a homogeneous array of two-field event logs, audit trail entries, or timestamped activity notes.",
      notFor:
        "Multi-column financial or inventory grids with prices and quantities (use DataTable), or single scalar fields.",
      examples: [
        "/audit_trail = [{actor: 'system', event: 'Webhook signature verified'}]",
        "/timeline = [{timestamp: '10:04Z', summary: 'Dispute opened by cardholder'}]",
        "/activity_feed = [{author: 'maya', note: 'Updated billing address'}]",
      ],
      props: [
        {
          name: "rows",
          kind: "binding",
          description: "Pointer to the homogeneous array of timeline or feed entries.",
        },
        {
          name: "title",
          kind: "phrase",
          description: "Feed header title.",
        },
      ],
    },
  ],
);
