(function () {
  let activeField = null;
  let menuEl = null;
  let hideTimer = null;
  let inlineSuggestionsEnabled = true;

  chrome.runtime.sendMessage({ type: "getInlineSuggestionSetting" }).then((res) => {
    if (res?.success) inlineSuggestionsEnabled = !!res.enabled;
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "inlineSuggestionSettingChanged") {
      inlineSuggestionsEnabled = !!message.enabled;
    }
  });

  function isPasswordField(element) {
    if (!element || element.tagName !== "INPUT") return false;
    return (element.type || "text").toLowerCase() === "password";
  }

  function getVisibleFields(form) {
    return Array.from((form || document).querySelectorAll("input, textarea")).filter((field) => {
      const rect = field.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function classifyFields(form) {
    const fields = getVisibleFields(form);
    let usernameField = null;
    const passwordFields = [];

    for (const field of fields) {
      const type = (field.type || "").toLowerCase();
      if (type === "password") {
        passwordFields.push(field);
        continue;
      }
      if (!usernameField && ["text", "email", "search", "url", "tel"].includes(type || "text")) {
        const tokens = `${field.name || ""} ${field.id || ""} ${field.placeholder || ""}`.toLowerCase();
        if (/user|email|login|account|name/.test(tokens)) {
          usernameField = field;
        }
      }
    }

    if (!usernameField) {
      usernameField = fields.find((field) => field !== passwordFields[0] && (field.type || "text").toLowerCase() !== "hidden") || null;
    }

    return { usernameField, passwordFields };
  }

  function getActiveFormContext() {
    const form = activeField?.form || activeField?.closest("form") || document;
    const { usernameField, passwordFields } = classifyFields(form);
    return {
      username: usernameField?.value || "",
      password: passwordFields[0]?.value || "",
      hasPasswordFields: passwordFields.length > 0,
    };
  }

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement("div");
    menuEl.className = "redsec-inline-menu";
    menuEl.hidden = true;
    document.documentElement.appendChild(menuEl);
    menuEl.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    menuEl.addEventListener("mouseleave", scheduleHide);
    menuEl.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-menu]")) hideMenu();
    });
    return menuEl;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideMenu, 180);
  }

  function hideMenu() {
    if (menuEl) menuEl.hidden = true;
  }

  function positionMenu(target) {
    const menu = ensureMenu();
    const rect = target.getBoundingClientRect();
    const top = window.scrollY + rect.bottom + 8;
    const left = window.scrollX + Math.max(8, Math.min(rect.left, window.innerWidth - 280));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }

  async function renderSuggestions(target) {
    if (!isPasswordField(target)) return;
    const response = await chrome.runtime.sendMessage({
      type: "getInlineSuggestions",
      payload: { pageUrl: window.location.href },
    }).catch(() => null);

    const menu = ensureMenu();
    positionMenu(target);

    if (!response?.success) {
      hideMenu();
      return;
    }

    if (response.mode === "locked") {
      menu.innerHTML = `
        <div class="redsec-inline-menu-title">RedSecVault<span class="redsec-inline-close" data-close-menu title="Close">&times;</span></div>
        <div class="redsec-inline-menu-note">Unlock the extension to use site suggestions.</div>
        <div class="redsec-inline-footer"><button type="button" data-open-popup>Open Extension</button></div>
      `;
      menu.querySelector("[data-open-popup]").addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "openPopup", payload: {} }).catch(() => {});
      });
      menu.hidden = false;
      return;
    }

    if (response.mode !== "unlocked" || !response.suggestions?.length) {
      hideMenu();
      return;
    }

    menu.innerHTML = `
      <div class="redsec-inline-menu-title">RedSecVault<span class="redsec-inline-close" data-close-menu title="Close">&times;</span></div>
      <div class="redsec-inline-list">
        ${response.suggestions.map((suggestion) => `
          <button type="button" class="redsec-inline-item" data-fill-ref="${suggestion.refId}">
            <strong>${escapeHtml(suggestion.title)}</strong>
            <span>${escapeHtml(suggestion.username || suggestion.url || suggestion.vaultName || "")}</span>
          </button>
        `).join("")}
      </div>
      <div class="redsec-inline-footer"><button type="button" data-open-popup>Open Extension</button></div>
    `;

    menu.querySelectorAll("[data-fill-ref]").forEach((button) => {
      button.addEventListener("click", () => {
        chrome.runtime.sendMessage({
          type: "fillEntry",
          payload: { refId: button.dataset.fillRef },
        }).catch(() => {});
      });
    });
    menu.querySelector("[data-open-popup]").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "openPopup", payload: {} }).catch(() => {});
    });
    menu.hidden = false;
  }

  function fillStringField(field, value) {
    if (!field) return;
    field.focus();
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function fillCredentials({ username, password }) {
    const form = activeField?.form || activeField?.closest("form") || document;
    const { usernameField, passwordFields } = classifyFields(form);
    if (usernameField && username) fillStringField(usernameField, username);
    if (passwordFields[0] && password) fillStringField(passwordFields[0], password);
    return { success: true };
  }

  async function fillGeneratedPassword({ password }) {
    const form = activeField?.form || activeField?.closest("form") || document;
    const { passwordFields } = classifyFields(form);
    if (!passwordFields.length) {
      return { success: false, error: "No password field detected on this page" };
    }
    passwordFields.slice(0, 2).forEach((field) => fillStringField(field, password));
    return { success: true };
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value || "";
    return div.innerHTML;
  }

  document.addEventListener("focusin", (event) => {
    if (!isPasswordField(event.target)) return;
    if (!inlineSuggestionsEnabled) return;
    activeField = event.target;
    clearTimeout(hideTimer);
    renderSuggestions(event.target).catch(() => {});
  });

  document.addEventListener("focusout", () => {
    scheduleHide();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!menuEl) return;
    if (menuEl.contains(event.target)) return;
    if (event.target === activeField) return;
    hideMenu();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "collectFormContext") {
      sendResponse(getActiveFormContext());
      return;
    }
    if (message?.type === "fillCredentials") {
      fillCredentials(message.payload).then(sendResponse);
      return true;
    }
    if (message?.type === "fillGeneratedPassword") {
      fillGeneratedPassword(message.payload).then(sendResponse);
      return true;
    }
  });
})();
