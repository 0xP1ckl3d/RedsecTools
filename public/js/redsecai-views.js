function switchRedSecAIView(view) {
  document.querySelectorAll("[data-redsecai-view]").forEach(function (b) {
    b.classList.toggle("active", b.dataset.redsecaiView === view);
  });
  document.querySelectorAll(".redsecai-view").forEach(function (s) {
    s.classList.toggle("hidden", s.id !== "redsecai-view-" + view);
  });
}

document.querySelectorAll("[data-redsecai-view]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    switchRedSecAIView(btn.dataset.redsecaiView);
  });
});

var params = new URLSearchParams(window.location.search);
if (params.get("view") === "about") {
  switchRedSecAIView("about");
}
