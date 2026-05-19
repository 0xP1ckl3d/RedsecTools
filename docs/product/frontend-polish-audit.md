# Frontend Polish Audit

This audit tracks the Phase 3 product-polish consolidation work. The goal is consistency without redesigning the application or bypassing user-configured theme overrides.

## Existing Shared Patterns

- `public/js/burger-menu.js`: shared authenticated navigation and footer injection.
- `public/js/confirm-modal.js`: shared alert and confirm modal behavior.
- `public/js/tool-shell.js`: shared sidebar/click-proxy wiring for tool shells.
- `public/css/input.css`: shared theme tokens, buttons, fields, cards, badges, modals, and tool shell classes.

## New Shared Component Layer

- `public/js/ui-components.js`
  - `escapeHtml`
  - `safeAttr`
  - `badge`
  - `statusBadge`
  - `booleanBadge`
  - `tableStateRow`
  - `setTableState`
  - `stateBlock`
  - `setInlineResult`
  - `clearInlineResult`

These helpers use existing CSS classes and theme variables. They do not introduce fixed color palettes or new design tokens.

## Migrated In This Pass

- Admin: repeated table empty/error states, service-account/webhook states, boolean/status badges, and inline result messages.
- Homepage: shared escaping and common empty-state blocks across favourite tools, favourite shortcuts, bulletin previews, shortcuts, and weather.
- Paste/Share-facing modules: Share create/view now use shared escaping for rendered file names and download table rows.
- Chat: classic-script controller now imports shared UI helpers dynamically for escaping and message empty state.
- Vault: shared escaping and safe attribute handling for vault names, folders, entries, shares, and member search rendering.
- Reporter: shared escaping and badge generation for severity, status, project roles, and proposal classic-script rendering.
- Survey builder/respond/results: shared escaping and empty-state blocks where markup is equivalent.
- Threat: shared escaping, empty-state blocks, and table empty row.
- Calendar: shared escaping and table empty row.
- Wiki: shared escaping and empty-state blocks.
- RedSecAI: shared escaping.
- Engage: dashboard module and classic submodules now consume the shared UI escaping bridge for clients, opportunities, engagements, QA, and utilisation rendering.
- Notifications: shared escaping through the shared UI module before notification rendering starts.

## Remaining High-Value Follow-Up Areas

- Continue reducing tool-specific empty/loading/error markup in Chat, Vault, Reporter proposals, Engage, and Homepage now that shared escaping is in place.
- Move duplicated `fetchJson` / API error handling into a shared client helper once each tool's response contract has been checked.
- Consolidate loading overlays used by Share and Vault into one shared loading component.
- Standardize filter bars and table action cells across Admin, Calendar, Threat, Reporter, Engage, Survey, and Wiki.
- Add non-visual DOM checks for shared component imports and common empty/loading/error states.

## Guardrails

- Preserve browser-side encryption behavior.
- Preserve API contracts and route behavior.
- Do not introduce inline styles/scripts that weaken CSP.
- Do not hardcode visual colors where theme tokens or existing classes already apply.
