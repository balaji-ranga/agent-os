// Only dismissal enhancements: the native <details> still works without JS.
document.querySelectorAll('.mobile-nav').forEach(menu => {
  const summary = menu.querySelector('summary');
  menu.addEventListener('click', event => {
    if (event.target.closest('a')) menu.open = false;
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      summary.focus();
      event.preventDefault();
    }
  });
  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  const desktop = window.matchMedia('(min-width: 1281px)');
  desktop.addEventListener('change', () => { if (desktop.matches) menu.open = false; });
});
