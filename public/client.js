(function () {
  function applyTheme() {
    var isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }

  applyTheme();
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  }

  var search = document.querySelector("[data-service-search]");
  if (!search) return;

  var rows = Array.prototype.slice.call(document.querySelectorAll("[data-service-row]"));
  var groups = Array.prototype.slice.call(document.querySelectorAll("[data-service-group]"));
  var empty = document.querySelector("[data-empty-search]");

  search.addEventListener("input", function () {
    var query = search.value.trim().toLowerCase();
    var visibleRows = 0;

    rows.forEach(function (row) {
      var matches = !query || String(row.getAttribute("data-search") || "").indexOf(query) !== -1;
      row.hidden = !matches;
      if (matches) visibleRows += 1;
    });

    groups.forEach(function (group) {
      var groupRows = Array.prototype.slice.call(group.querySelectorAll("[data-service-row]"));
      group.hidden = !groupRows.some(function (row) { return !row.hidden; });
    });

    if (empty) empty.hidden = visibleRows !== 0;
  });
})();
