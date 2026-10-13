// The last theme applied (src/lib/theme.ts), set before first paint so a
// light theme never flashes dark while the config loads. A file rather
// than an inline script: the app's Content-Security-Policy allows no
// inline scripts.
try {
  var pref = localStorage.getItem("parallax-theme") || "system";
  if (pref === "light" || (pref === "system" && matchMedia("(prefers-color-scheme: light)").matches)) {
    document.documentElement.dataset.theme = "light";
  }
} catch (e) {}
