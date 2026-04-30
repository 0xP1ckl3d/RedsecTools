function initToolSidebar() {
  document.querySelectorAll("[data-tool-sidebar-toggle]").forEach((button) => {
    const targetId = button.dataset.toolSidebarToggle;
    const sidebar = targetId ? document.getElementById(targetId) : button.closest(".dashboard-sidebar");
    if (!sidebar) return;

    button.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
    });
  });
}

function initClickProxies() {
  document.querySelectorAll("[data-click-proxy]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.clickProxy);
      if (target && !target.disabled) target.click();
    });
  });
}

initToolSidebar();
initClickProxies();
