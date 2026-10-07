// =========================================================
// minisebiso-flotante.js
// Coloca a MiniSEBISO dormido en la esquina inferior derecha.
// Al tocarlo despierta 5 segundos: abre los ojos (siguen el ratón)
// y dice que pronto estará funcionando; luego se vuelve a dormir.
// =========================================================

(function () {
  if (document.querySelector('.ms-flotante')) return;
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = 'css/minisebiso-flotante.css?v=2';
  document.head.appendChild(css);

  const ms = document.createElement('div');
  ms.className = 'minisebiso ms-flotante dormido';
  ms.setAttribute('role', 'button');
  ms.setAttribute('tabindex', '0');
  ms.setAttribute('aria-label', 'MiniSEBISO, el asistente del sistema (dormido). Toca para despertarlo');
  ms.innerHTML = `
    <div class="ms-burbuja" aria-live="polite">¡Hola! Soy el asistente de este sistema, pronto estaré funcionando…</div>
    <div class="ms-zzz" aria-hidden="true"><span>z</span><span>z</span><span>Z</span></div>
    <div class="ms-cuerpo">
      <span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span>
      <span class="ms-ojo-mov der"><span class="ms-ojo"></span></span>
    </div>
    <div class="ms-estrella"></div>`;
  document.body.appendChild(ms);

  const ojos = ms.querySelectorAll('.ms-ojo-mov');
  const centrar = () => ojos.forEach(o => { o.style.setProperty('--dx', '0px'); o.style.setProperty('--dy', '0px'); });
  window.addEventListener('pointermove', (e) => {
    if (ms.classList.contains('dormido')) return;
    ojos.forEach(o => {
      const r = o.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1, f = Math.min(1, dist / 220);
      o.style.setProperty('--dx', (dx / dist * r.width * .55 * f).toFixed(1) + 'px');
      o.style.setProperty('--dy', (dy / dist * r.height * .32 * f).toFixed(1) + 'px');
    });
  });

  let dormir = null;
  function despertar() {
    clearTimeout(dormir);
    ms.classList.remove('dormido', 'saltando'); void ms.offsetWidth;
    ms.classList.add('saltando', 'hablando');
    ms.setAttribute('aria-label', 'MiniSEBISO, el asistente del sistema');
    dormir = setTimeout(() => {
      ms.classList.remove('hablando');
      centrar();
      ms.classList.add('dormido');
      ms.setAttribute('aria-label', 'MiniSEBISO, el asistente del sistema (dormido). Toca para despertarlo');
    }, 5000);
  }
  ms.addEventListener('click', despertar);
  ms.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); despertar(); } });
  ms.addEventListener('animationend', (e) => { if (e.animationName === 'msSalto') ms.classList.remove('saltando'); });
})();
