/* Submenú "Registro" (Registro Automático + Nuevo Registro) del menú
   principal. Se comparte tal cual en todas las páginas que traen el
   menú de navegación. */
document.addEventListener('DOMContentLoaded', () => {
  const li = document.getElementById('menu-registro');
  if (!li) return;
  const trigger = li.querySelector('.menu-item-submenu-trigger');
  if (!trigger) return;

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    li.classList.toggle('abierto');
  });

  document.addEventListener('click', (e) => {
    if (!li.contains(e.target)) li.classList.remove('abierto');
  });
});
