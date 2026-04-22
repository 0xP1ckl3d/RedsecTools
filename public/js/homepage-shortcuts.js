import { showConfirmModal, showAlertModal } from "./confirm-modal.js";

// RedSecTools — Homepage shortcuts manager (with image + emoji icons)

export const EMOJI_DATA = {
  Smileys: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","😐","😑","😶","😏","😒","🙄","😬","😮‍💨","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐"],
  Gestures: ["👍","👎","👊","✊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐","🖖","👋","🤏","💪","🦾","🖕"],
  Hearts: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","♥️","❤️‍🔥","❤️‍🩹","💟"],
  Animals: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦅","🦆","🦉","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🪲","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🐘","🦏","🐫"],
  Food: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🌶","🫑","🌽","🥕","🧄","🧅","🥔","🍠","🥐","🥖","🍞","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🫓","🥪","🥙","🧆","🌮","🌯","🫔","🥗","🫕","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯"],
  Objects: ["💻","⌨️","🖥","🖨","📱","☎️","📞","📟","📠","🔋","🔌","💡","🔦","🕯","📷","📸","📹","🎥","📽","🎬","📺","📻","📡","🔍","🔎","🔬","🔭","🧲","⚙️","🔧","🔨","⚒","🛠","⛏","🔩","🗜","💡","🔑","🗝","🚪","🪑","🛋","🛏","🧸","🖼","🪞","🪟","📦","📫","📝","🖊","🖋","✒️","📌","📎","✂️","📋","📁","📂","🗂","📆","📅","📇","📈","📉","📊","📋"],
  Symbols: ["✅","❌","⭕","❗","❓","‼️","⁉️","💯","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔺","🔻","💠","🔲","🔳","♻️","✝️","☪️","🕉","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","⛔","📛","🚫","❤️‍🔥","🎶","🎵","🎤","🎧","🎸","🎹","🎺","🥁","🔔","🔕","📣","📢","💬","💭","🗯"],
};

let shortcuts = [];
let currentEmojiCategory = "Smileys";
let editingId = null;
let isEditing = false;
let onShortcutsChanged = null;

export function onShortcutChange(fn) {
  onShortcutsChanged = fn;
}

export async function loadShortcuts() {
  try {
    const res = await fetch("/api/homepage/shortcuts");
    if (!res.ok) return;
    const data = await res.json();
    shortcuts = data.shortcuts || [];
    renderShortcuts();
    if (onShortcutsChanged) onShortcutsChanged(shortcuts);
  } catch {}
}

function blockLinkNavigation(e) {
  const card = e.target.closest(".shortcut-card");
  if (card) e.preventDefault();
}

function editModeClickHandler(e) {
  const deleteBtn = e.target.closest(".shortcut-delete");
  if (deleteBtn) return; // Let delete handler run
  const card = e.target.closest(".shortcut-card");
  if (!card) return;
  e.preventDefault();
  e.stopPropagation();
  // Only personal shortcuts can be edited
  if (card.dataset.category === "team") return;
  const sc = shortcuts.find((s) => s.id === card.dataset.id);
  if (sc && openModalForEdit) openModalForEdit(sc);
}

// Will be set during initShortcutModal
let openModalForEdit = null;

function renderShortcuts() {
  const teamGrid = document.getElementById("shortcuts-grid-team");
  const personalGrid = document.getElementById("shortcuts-grid-personal");
  const grid = document.getElementById("shortcuts-grid");
  if (!teamGrid || !personalGrid || !grid) return;

  const teamShortcuts = shortcuts.filter((s) => s.category === "team");
  const personalShortcuts = shortcuts.filter((s) => s.category !== "team");

  if (shortcuts.length === 0) {
    teamGrid.innerHTML = "";
    personalGrid.innerHTML = "";
    return;
  }

  function renderCards(list) {
    return list.map((s) => {
      const isTeam = s.category === "team";
      const deleteBtn = !isTeam ? '<button type="button" class="shortcut-delete' + (isEditing ? "" : " hidden") + '" data-id="' + escapeHtml(s.id) + '" title="Remove">&times;</button>' : "";
      const draggable = isEditing ? 'draggable="true"' : "";
      const favVisible = isEditing ? " visible" : "";
      const favClass = s.isFavourite ? "shortcut-fav active" + favVisible : "shortcut-fav" + favVisible;
      const favTitle = s.isFavourite ? "Remove from favourites" : "Add to favourites";
      const favIcon = s.isFavourite ? "\u2605" : "\u2606";
      return '<a href="' + escapeHtml(s.url) + '" class="shortcut-card" target="' + (s.url.startsWith("/") ? "" : "_blank") + '" rel="noopener" data-id="' + escapeHtml(s.id) + '" data-category="' + escapeHtml(s.category) + '" ' + draggable + '>' +
        deleteBtn +
        '<span class="shortcut-card-icon">' + renderIcon(s) + '</span>' +
        '<span class="shortcut-card-title">' + escapeHtml(s.title) + '</span>' +
        (s.description ? '<span class="shortcut-card-desc">' + escapeHtml(s.description) + '</span>' : '') +
        '<button type="button" class="' + favClass + '" data-fav-id="' + escapeHtml(s.id) + '" title="' + favTitle + '">' + favIcon + '</button>' +
      '</a>';
    }).join("");
  }

  teamGrid.innerHTML = renderCards(teamShortcuts);
  personalGrid.innerHTML = renderCards(personalShortcuts);

  // In edit mode, prevent link navigation and handle click-to-edit
  [teamGrid, personalGrid].forEach((g) => g.removeEventListener("click", editModeClickHandler));
  if (isEditing) {
    teamGrid.addEventListener("click", editModeClickHandler);
    personalGrid.addEventListener("click", editModeClickHandler);
  }

  // Edit mode toggle
  const editBtn = document.getElementById("shortcuts-edit-btn");
  if (editBtn) {
    const newEditBtn = editBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEditBtn, editBtn);
    newEditBtn.textContent = isEditing ? "Done" : "Edit";
    newEditBtn.dataset.editing = isEditing ? "true" : "false";
    newEditBtn.addEventListener("click", () => {
      isEditing = !isEditing;
      newEditBtn.textContent = isEditing ? "Done" : "Edit";
      newEditBtn.dataset.editing = isEditing ? "true" : "false";
      renderShortcuts();
    });
  }

  // Delete handlers
  [teamGrid, personalGrid].forEach((g) => {
    g.querySelectorAll(".shortcut-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!await showConfirmModal({ title: "Remove Shortcut", message: "Remove this shortcut?", confirmLabel: "Remove", danger: true })) return;
        await fetch("/api/homepage/shortcuts/" + btn.dataset.id, { method: "DELETE" });
        loadShortcuts();
      });
    });
  });

  // Favourite toggle handlers
  [teamGrid, personalGrid].forEach((g) => {
    g.querySelectorAll(".shortcut-fav").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const res = await fetch("/api/homepage/shortcuts/" + btn.dataset.favId + "/favourite", {
          method: "PUT",
        });
        if (res.ok) {
          loadShortcuts();
        } else {
          const data = await res.json();
          showFavLimitModal(data.error || "Failed to toggle favourite");
        }
      });
    });
  });

  // Drag-to-reorder within each column
  if (isEditing) {
    setupDragReorder(teamGrid);
    setupDragReorder(personalGrid);
  }
}

function renderIcon(s) {
  if (s.iconUrl) {
    return '<img src="' + escapeHtml(s.iconUrl) + '" class="shortcut-card-img" alt="">';
  }
  return s.icon || "🔗";
}

const dragEnabledGrids = new WeakSet();

function setupDragReorder(grid) {
  if (dragEnabledGrids.has(grid)) return;
  dragEnabledGrids.add(grid);

  let draggedId = null;

  grid.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".shortcut-card");
    if (!item) return;
    draggedId = item.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    item.classList.add("shortcut-dragging");
  });

  grid.addEventListener("dragend", (e) => {
    const item = e.target.closest(".shortcut-card");
    if (item) item.classList.remove("shortcut-dragging");
    draggedId = null;
  });

  grid.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });

  grid.addEventListener("drop", async (e) => {
    e.preventDefault();
    const target = e.target.closest(".shortcut-card");
    if (!target || !draggedId) return;
    const targetId = target.dataset.id;
    if (draggedId === targetId) return;

    const draggedIdx = shortcuts.findIndex((s) => s.id === draggedId);
    const targetIdx = shortcuts.findIndex((s) => s.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [moved] = shortcuts.splice(draggedIdx, 1);
    shortcuts.splice(targetIdx, 0, moved);

    renderShortcuts();
    if (onShortcutsChanged) onShortcutsChanged(shortcuts);

    // Send full order (both personal and team) to server
    const fullOrder = shortcuts.map((s) => s.id);
    await fetch("/api/homepage/shortcuts/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: fullOrder }),
    });
  });
}

// Add shortcut modal
export function initShortcutModal() {
  const addBtn = document.getElementById("shortcuts-add-btn");
  const modal = document.getElementById("shortcut-modal");
  const closeBtn = document.getElementById("shortcut-modal-close");
  const saveBtn = document.getElementById("shortcut-modal-save");
  const emojiTrigger = document.getElementById("shortcut-emoji-trigger");
  const emojiPickerEl = document.getElementById("shortcut-emoji-picker");
  const emojiGrid = document.getElementById("shortcut-emoji-grid");
  const emojiCategories = document.getElementById("shortcut-emoji-categories");
  const titleInput = document.getElementById("shortcut-modal-title");
  const urlInput = document.getElementById("shortcut-modal-url");
  const descInput = document.getElementById("shortcut-modal-desc");
  const imageUpload = document.getElementById("shortcut-image-upload");

  if (!addBtn || !modal) return;

  let selectedEmoji = null;
  let uploadedIconUrl = null;

  function openModal(existing) {
    editingId = existing ? existing.id : null;
    titleInput.value = existing ? existing.title : "";
    urlInput.value = existing ? existing.url : "";
    if (descInput) descInput.value = existing ? (existing.description || "") : "";
    selectedEmoji = existing ? (existing.icon || null) : null;
    uploadedIconUrl = existing ? (existing.iconUrl || null) : null;
    emojiTrigger.innerHTML = uploadedIconUrl
      ? '<img src="' + escapeHtml(uploadedIconUrl) + '" class="shortcut-emoji-preview" alt="">'
      : (selectedEmoji || "🔗");
    if (imageUpload) imageUpload.value = "";
    const heading = document.getElementById("shortcut-modal-heading");
    if (heading) heading.textContent = existing ? "Edit Shortcut" : "Add Shortcut";
    modal.classList.remove("hidden");
    titleInput.focus();
  }

  function closeModal() {
    modal.classList.add("hidden");
    emojiPickerEl.classList.add("hidden");
    editingId = null;
    uploadedIconUrl = null;
  }

  // Expose openModal for edit-mode click-to-edit
  openModalForEdit = openModal;

  addBtn.addEventListener("click", () => openModal(null));
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  // Image upload handler
  if (imageUpload) {
    imageUpload.addEventListener("change", async () => {
      const file = imageUpload.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        await showAlertModal({ title: "Too Large", message: "Image must be under 2MB." });
        return;
      }

      const formData = new FormData();
      formData.append("image", file);

      try {
        const res = await fetch("/api/homepage/shortcuts/upload-icon", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json();
          await showAlertModal({ title: "Upload Failed", message: data.error || "Could not upload the image." });
          return;
        }
        const data = await res.json();
        uploadedIconUrl = data.url;
        selectedEmoji = null;
        emojiTrigger.innerHTML = '<img src="' + escapeHtml(uploadedIconUrl) + '" class="shortcut-emoji-preview" alt="">';
        emojiPickerEl.classList.add("hidden");
      } catch {
        await showAlertModal({ title: "Upload Failed", message: "Could not upload the image." });
      }
    });
  }

  // Emoji picker
  function initPicker() {
    const cats = Object.keys(EMOJI_DATA);
    emojiCategories.innerHTML = "";
    cats.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-category-tab" + (cat === currentEmojiCategory ? " active" : "");
      btn.textContent = cat;
      btn.addEventListener("click", () => {
        currentEmojiCategory = cat;
        emojiCategories.querySelectorAll(".emoji-category-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderCategory(cat);
      });
      emojiCategories.appendChild(btn);
    });
    renderCategory(currentEmojiCategory);
  }

  function renderCategory(cat) {
    const emojis = EMOJI_DATA[cat] || [];
    emojiGrid.innerHTML = "";
    emojis.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-item";
      btn.textContent = emoji;
      btn.title = emoji;
      btn.addEventListener("click", () => {
        selectedEmoji = emoji;
        uploadedIconUrl = null;
        emojiTrigger.textContent = emoji;
        emojiPickerEl.classList.add("hidden");
        if (imageUpload) imageUpload.value = "";
      });
      emojiGrid.appendChild(btn);
    });
  }

  emojiTrigger.addEventListener("click", () => {
    if (emojiPickerEl.classList.contains("hidden")) {
      initPicker();
      emojiPickerEl.classList.remove("hidden");
    } else {
      emojiPickerEl.classList.add("hidden");
    }
  });

  document.addEventListener("click", (e) => {
    if (!emojiPickerEl.contains(e.target) && e.target !== emojiTrigger && !emojiTrigger.contains(e.target)) {
      emojiPickerEl.classList.add("hidden");
    }
  });

  // Save
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    const description = descInput ? descInput.value.trim() : "";

    if (!title) { titleInput.focus(); return; }
    if (!url) { urlInput.focus(); return; }

    saveBtn.disabled = true;
    try {
      const body = {
        title,
        url,
        icon: uploadedIconUrl ? null : selectedEmoji,
        icon_url: uploadedIconUrl,
        description,
      };

      let res;
      if (editingId) {
        res = await fetch("/api/homepage/shortcuts/" + editingId, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/homepage/shortcuts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        closeModal();
        loadShortcuts();
      } else {
        const data = await res.json();
        await showAlertModal({ title: "Error", message: data.error || "Failed to save shortcut" });
      }
    } catch {
      await showAlertModal({ title: "Error", message: "Network error" });
    } finally {
      saveBtn.disabled = false;
    }
  });

  urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBtn.click(); });
  titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") urlInput.focus(); });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function showFavLimitModal(message) {
  const modal = document.getElementById("fav-limit-modal");
  const msg = document.getElementById("fav-limit-msg");
  const closeBtn = document.getElementById("fav-limit-modal-close");
  const okBtn = document.getElementById("fav-limit-modal-ok");
  if (!modal || !msg) return;

  msg.textContent = message;
  modal.classList.remove("hidden");

  function close() {
    modal.classList.add("hidden");
    okBtn.removeEventListener("click", close);
    closeBtn.removeEventListener("click", close);
    modal.removeEventListener("click", onOverlay);
  }

  function onOverlay(e) {
    if (e.target === modal) close();
  }

  okBtn.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", onOverlay);
}
