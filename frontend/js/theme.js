// ── CivicGuide AI — Theme Toggle ────────────────────────
// Persists preference in localStorage. Defaults to light.

(function () {
  const STORAGE_KEY = 'civicguide-theme';

  // Apply saved theme immediately (before paint)
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const html = document.documentElement;

      // Add transition class for smooth switch
      html.classList.add('theme-transitioning');

      const isDark = html.getAttribute('data-theme') === 'dark';

      if (isDark) {
        html.removeAttribute('data-theme');
        localStorage.setItem(STORAGE_KEY, 'light');
      } else {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem(STORAGE_KEY, 'dark');
      }

      // Remove transition class after animation
      setTimeout(() => html.classList.remove('theme-transitioning'), 500);
    });
  });
})();
