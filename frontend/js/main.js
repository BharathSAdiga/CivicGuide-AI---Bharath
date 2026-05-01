// ── CivicGuide AI — Main JS ──────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // ─── Scroll Reveal Animation ──────────────────────────
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, i * 80);
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.reveal').forEach((el) => {
    revealObserver.observe(el);
  });

  // ─── Animated Counter ────────────────────────────────
  function animateCounter(el, target, suffix = '', duration = 1800) {
    const start = performance.now();
    const isDecimal = target % 1 !== 0;

    const tick = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const value = isDecimal
        ? (eased * target).toFixed(1)
        : Math.floor(eased * target);
      el.textContent = value + suffix;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const statsObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(document.getElementById('stat-services'), 500, '+');
          animateCounter(document.getElementById('stat-accuracy'), 98, '%');
          statsObserver.disconnect();
        }
      });
    },
    { threshold: 0.5 }
  );

  const statsBar = document.querySelector('.stats-bar');
  if (statsBar) statsObserver.observe(statsBar);

  // ─── Navbar Scroll Effect ─────────────────────────────
  const navbar = document.querySelector('.navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
      navbar.style.background = 'rgba(10, 14, 26, 0.96)';
    } else {
      navbar.style.background = 'rgba(10, 14, 26, 0.8)';
    }
  }, { passive: true });

  // ─── Smooth Scroll for anchor links ──────────────────
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ─── API Status Ping ──────────────────────────────────
  async function checkAPIStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Non-200');
      const data = await res.json();
      console.log('[CivicGuide AI] API Status:', data);
    } catch {
      console.log('[CivicGuide AI] API not reachable — running in static mode.');
    }
  }
  checkAPIStatus();

});
