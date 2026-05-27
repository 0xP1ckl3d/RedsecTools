const allowedPolicies = new Set(["privacy", "tos"]);

function getSelectedPolicy() {
  const hash = window.location.hash.replace(/^#/, "");
  const match = hash.match(/^policy=(privacy|tos)$/i);
  if (match) return match[1].toLowerCase();

  const params = new URLSearchParams(window.location.search);
  const policy = String(params.get("policy") || "").toLowerCase();
  return allowedPolicies.has(policy) ? policy : "privacy";
}

function switchPolicy(policy, updateHash = true) {
  const selected = allowedPolicies.has(policy) ? policy : "privacy";

  document.querySelectorAll("[data-policy-view]").forEach((tab) => {
    const isActive = tab.dataset.policyView === selected;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });

  document.querySelectorAll("[data-policy-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.policyPanel !== selected);
  });

  document.title = selected === "tos"
    ? "RedSecTools — Terms of Service"
    : "RedSecTools — Privacy Policy";

  const nextHash = `#policy=${selected}`;
  if (updateHash && window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

document.querySelectorAll("[data-policy-view]").forEach((tab) => {
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    switchPolicy(tab.dataset.policyView);
  });
});

window.addEventListener("hashchange", () => {
  switchPolicy(getSelectedPolicy(), false);
});

const initialPolicy = getSelectedPolicy();
if (window.location.search && !window.location.hash) {
  window.history.replaceState(null, "", `/policies#policy=${initialPolicy}`);
}
switchPolicy(initialPolicy, !window.location.hash);
