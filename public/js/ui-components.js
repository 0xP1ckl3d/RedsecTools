function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function safeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

const STATUS_TONES = Object.freeze({
  active: "green",
  approved: "green",
  delivered: "green",
  enabled: "green",
  success: "green",
  used: "green",
  archived: "gray",
  closed: "gray",
  disabled: "gray",
  draft: "gray",
  expired: "red",
  failed: "red",
  failure: "red",
  suspended: "red",
  pending: "amber",
  warning: "amber",
});

function normalizeTone(tone) {
  return ["green", "amber", "red", "gray", "blue", "purple"].includes(tone) ? tone : "gray";
}

function badge(label, tone = "gray", extraClass = "") {
  const normalized = normalizeTone(tone);
  return `<span class="badge badge-${normalized}${extraClass ? ` ${escapeHtml(extraClass)}` : ""}">${escapeHtml(label)}</span>`;
}

function statusBadge(status, toneMap = STATUS_TONES, fallbackTone = "gray") {
  const raw = String(status || "");
  const label = raw.replace(/_/g, " ") || "Unknown";
  const tone = toneMap[raw] || toneMap[raw.toLowerCase()] || fallbackTone;
  return badge(label, tone);
}

function booleanBadge(value, trueLabel = "Yes", falseLabel = "No") {
  return value ? badge(trueLabel, "green") : badge(falseLabel, "gray");
}

function tableStateRow(colspan, message, tone = "muted", extraCellClass = "") {
  const textClass = tone === "error" ? "text-error" : "text-muted";
  const cellClass = `text-center ${textClass} py-8${extraCellClass ? ` ${extraCellClass}` : ""}`;
  return `<tr><td colspan="${Number(colspan) || 1}" class="${cellClass}">${escapeHtml(message)}</td></tr>`;
}

function setTableState(tbody, colspan, message, tone = "muted", extraCellClass = "") {
  if (!tbody) return;
  tbody.innerHTML = tableStateRow(colspan, message, tone, extraCellClass);
}

function stateBlock(message, tone = "muted", extraClass = "") {
  const textClass = tone === "error" ? "text-error" : "text-muted";
  return `<div class="text-sm ${textClass}${extraClass ? ` ${escapeHtml(extraClass)}` : ""}">${escapeHtml(message)}</div>`;
}

function setInlineResult(el, message, ok = true) {
  if (!el) return;
  el.textContent = message || "";
  el.className = `text-sm ${ok ? "text-accent" : "text-error"}`;
  el.classList.remove("hidden");
}

function clearInlineResult(el) {
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

const RedSecUI = {
  escapeHtml,
  safeAttr,
  badge,
  statusBadge,
  booleanBadge,
  tableStateRow,
  setTableState,
  stateBlock,
  setInlineResult,
  clearInlineResult,
};

window.RedSecUI = Object.assign(window.RedSecUI || {}, RedSecUI);

export {
  escapeHtml,
  safeAttr,
  badge,
  statusBadge,
  booleanBadge,
  tableStateRow,
  setTableState,
  stateBlock,
  setInlineResult,
  clearInlineResult,
};
