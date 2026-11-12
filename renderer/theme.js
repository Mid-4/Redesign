// Runs in <head> before the page paints, so the dark theme never flashes white.
try { document.documentElement.dataset.theme = localStorage.getItem('cr-theme') === 'dark' ? 'dark' : 'light'; } catch { /* storage off: light */ }
