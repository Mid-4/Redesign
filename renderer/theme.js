// Runs in <head> before the page paints, so the theme never flashes. Mặc định giao diện tối (dashboard navy).
try { document.documentElement.dataset.theme = localStorage.getItem('cr-theme') === 'light' ? 'light' : 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }
