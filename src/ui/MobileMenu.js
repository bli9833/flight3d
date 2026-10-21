/** Keep secondary controls reachable without covering the flight view. */
export function initMobileMenu() {
  const button = document.createElement('button');
  button.className = 'btn mobile-menu-toggle';
  button.textContent = '☰ 메뉴';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'mobile-menu');
  const panel = document.createElement('div');
  panel.id = 'mobile-menu';
  panel.className = 'mobile-menu';
  panel.setAttribute('aria-label', '비행 설정 및 추가 조작');
  document.getElementById('hud-overlay').append(button, panel);
  const controls = [...document.querySelectorAll('.presets-bar, .action-panel, .touch-left-actions, .touch-right-actions')]
    .map(node => {
      const marker = document.createComment('original control position');
      node.before(marker);
      return { node, marker };
    });
  const compact = window.matchMedia('(max-width: 1024px), (pointer: coarse)');
  function close() {
    panel.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
  }
  function layout() {
    close();
    document.body.classList.toggle('compact-ui', compact.matches);
    for (const { node, marker } of controls) {
      if (compact.matches) panel.append(node);
      else marker.after(node);
    }
  }
  button.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(open));
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('button')) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  compact.addEventListener('change', layout);
  layout();
}
