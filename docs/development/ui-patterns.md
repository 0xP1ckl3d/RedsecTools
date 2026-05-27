# Admin UI Patterns

This document describes existing RedSecTools UI patterns. It is not a redesign brief.

## Admin Sidebar Groups

The Admin sidebar uses four top-level groups:

- Server Settings
- Homepage Settings
- User Settings
- Tool Settings

New admin controls should extend the existing owner group and subtab. Avoid adding new top-level groups unless the product direction explicitly changes.

## Admin Subtabs

Subtabs are rendered by `public/js/admin.js` from the `adminTabGroups` and `adminSubtabLabels` maps. Each subtab owns a single `*-tab` section in `public/admin.html`.

Use existing subtabs for related controls:

- Deployment owns posture, health, migrations, audit events, backup, and operations links.
- Session Security owns sessions, MFA policy, SSO, OpenAPI, service accounts, and webhooks.
- Access Controls owns roles and RBAC review.
- Tool Settings subtabs own module-specific settings and data-boundary notes.

## `admin-section-card`

Use `card admin-section-card` for a major admin surface. A card should have one clear owner and should not be nested inside another card.

## Card Header

Use:

```html
<div class="admin-card-header">
  <div>
    <p class="admin-card-kicker">Server Settings</p>
    <h2 class="admin-card-title">Deployment Posture</h2>
    <p class="admin-card-copy">Short practical description.</p>
  </div>
</div>
```

`admin-card-kicker` identifies the group or domain, `admin-card-title` names the task, and `admin-card-copy` explains the operational purpose in one sentence.

## Tables

Use `admin-table` for dense review surfaces such as users, audit events, service accounts, webhooks, migrations, Reporter projects, and Engage activity.

For empty states, use a single row with muted copy and the correct `colspan`.

## Stat Cards

Use `stat-card`, `stat-value`, and `stat-label` for compact numeric summaries. Keep labels short and avoid turning stat cards into paragraphs.

## Info Boxes

Use `info-box` for warnings, data-boundary notes, retention explanations, disabled-state messages, and operational summaries.

Info boxes should be short and actionable. They should not duplicate full documentation.

## Status Badges

Use shared badge helpers from `public/js/ui-components.js` where rendering from JavaScript. Common tones are green for healthy/enabled, amber for review/warning, red for failed/danger, and gray for disabled/neutral.

## Danger Confirmations

Use `showConfirmModal` from `public/js/confirm-modal.js` for destructive actions such as deleting users, revoking tokens, removing webhooks, deleting vaults, or bulk purges. Use a danger style and clear action label.

## Pagination

Use the existing admin pagination pattern with previous/next buttons and a muted page information label. Keep page size controls close to the table they affect.

## Copy And Export Buttons

Use `btn-secondary` for export/copy actions and `btn-primary` for primary save/create actions. Export buttons should preserve active filters when practical.

## Modals

Use the existing `modal-overlay` and `modal-card` structure. Keep modal content scoped to one task and ensure close controls are visible.

## CSP-Safe Frontend Code

Do not add inline scripts or inline styles. Add behaviour to existing JavaScript modules and styling to `public/css/input.css` when needed. `public/css/style.css` is generated.

