// Keep the existing account checks and actions as the single source of truth.
(() => {
  const menu = document.getElementById('mobile-menu');
  document.getElementById('mobile-more-nav').onclick = () => {
    const admin = menu.querySelector('[data-mobile-forward="manage-nav"]');
    admin.hidden = document.getElementById('manage-nav').hidden;
    menu.showModal();
  };
  menu.querySelectorAll('[data-mobile-forward]').forEach((button) => {
    button.onclick = () => {
      menu.close();
      document.getElementById(button.dataset.mobileForward).click();
    };
  });
  const viewport = window.visualViewport;
  const updateViewport = () => {
    document.documentElement.style.setProperty('--community-height', `${Math.round(viewport?.height || window.innerHeight)}px`);
    document.documentElement.style.setProperty('--community-top', `${Math.round(viewport?.offsetTop || 0)}px`);
  };
  viewport?.addEventListener('resize', updateViewport);
  viewport?.addEventListener('scroll', updateViewport);
  window.addEventListener('resize', updateViewport);
  updateViewport();
})();
