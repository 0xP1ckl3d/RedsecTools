/**
 * Reusable modals — drop-in replacements for confirm() and alert().
 *
 * Usage:
 *   import { showConfirmModal, showAlertModal } from "./confirm-modal.js";
 *   if (await showConfirmModal({ title: "Delete?", message: "This cannot be undone.", confirmLabel: "Delete", danger: true })) { ... }
 *   await showAlertModal({ title: "Done", message: "Email sent successfully." });
 */

var activeOverlay = null;

function createOverlay() {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
  var overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.zIndex = "200";
  return overlay;
}

function escapeModalHtml(value) {
  var div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

export function showConfirmModal({ title = "Confirm", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
  return new Promise(function (resolve) {
    var overlay = createOverlay();

    var card = document.createElement("div");
    card.className = "modal-card";
    card.innerHTML =
      '<h3 class="confirm-modal-title">' + escapeModalHtml(title) + "</h3>" +
      '<p class="confirm-modal-message">' + escapeModalHtml(message) + "</p>" +
      '<div class="confirm-modal-actions">' +
        '<button type="button" class="btn-secondary confirm-modal-cancel">' + escapeModalHtml(cancelLabel) + "</button>" +
        '<button type="button" class="btn-primary confirm-modal-confirm' + (danger ? " btn-danger" : "") + '">' + escapeModalHtml(confirmLabel) + "</button>" +
      "</div>";

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    activeOverlay = overlay;

    var confirmBtn = card.querySelector(".confirm-modal-confirm");
    var cancelBtn = card.querySelector(".confirm-modal-cancel");

    function cleanup(result) {
      overlay.remove();
      activeOverlay = null;
      resolve(result);
    }

    confirmBtn.addEventListener("click", function () { cleanup(true); });
    cancelBtn.addEventListener("click", function () { cleanup(false); });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) cleanup(false); });

    var handler = function (e) {
      if (e.key === "Escape") { cleanup(false); document.removeEventListener("keydown", handler); }
    };
    document.addEventListener("keydown", handler);

    confirmBtn.focus();
  });
}

export function showAlertModal({ title = "Notice", message = "", confirmLabel = "OK" } = {}) {
  return new Promise(function (resolve) {
    var overlay = createOverlay();

    var card = document.createElement("div");
    card.className = "modal-card";
    card.innerHTML =
      '<h3 class="confirm-modal-title">' + escapeModalHtml(title) + "</h3>" +
      '<p class="confirm-modal-message">' + escapeModalHtml(message) + "</p>" +
      '<div class="confirm-modal-actions">' +
        '<button type="button" class="btn-primary confirm-modal-confirm">' + escapeModalHtml(confirmLabel) + "</button>" +
      "</div>";

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    activeOverlay = overlay;

    var confirmBtn = card.querySelector(".confirm-modal-confirm");

    function cleanup() {
      overlay.remove();
      activeOverlay = null;
      resolve();
    }

    confirmBtn.addEventListener("click", cleanup);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) cleanup(); });

    var handler = function (e) {
      if (e.key === "Escape") { cleanup(); document.removeEventListener("keydown", handler); }
    };
    document.addEventListener("keydown", handler);

    confirmBtn.focus();
  });
}
