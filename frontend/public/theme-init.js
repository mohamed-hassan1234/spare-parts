// Applies the saved light/dark theme before React renders (external file so the strict CSP can forbid inline scripts).
try {
  var t = localStorage.getItem('theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {
  /* storage unavailable */
}
