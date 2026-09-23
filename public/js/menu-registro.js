/* Submenú "Registro" (Registro Automático + Nuevo Registro) del menú
   principal. Se comparte tal cual en todas las páginas que traen el
   menú de navegación. */
document.addEventListener('DOMContentLoaded', () => {
  const li = document.getElementById('menu-registro');
  if (!li) return;
  const trigger = li.querySelector('.menu-item-submenu-trigger');
  const lista = li.querySelector('.submenu-lista');
  if (!trigger || !lista) return;

  // El submenú es position:fixed (ver styles.css) para escapar el
  // overflow del contenedor del menú, así que su posición hay que
  // calcularla a mano justo al abrirse -- y en escritorio, no en el
  // menú hamburguesa de móvil (ahí es position:static por CSS y no
  // debe llevar top/left).
  function esEscritorio() {
    return window.matchMedia('(min-width: 1401px)').matches;
  }

  function posicionar() {
    if (!esEscritorio()) return;
    const r = trigger.getBoundingClientRect();
    lista.style.top = `${r.bottom + 6}px`;
    lista.style.left = `${r.left}px`;
  }

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const seVaAbrir = !li.classList.contains('abierto');
    if (seVaAbrir) posicionar();
    li.classList.toggle('abierto', seVaAbrir);
  });

  window.addEventListener('resize', () => {
    if (li.classList.contains('abierto')) posicionar();
  });

  document.addEventListener('click', (e) => {
    if (!li.contains(e.target) && !lista.contains(e.target)) {
      li.classList.remove('abierto');
    }
  });
});
