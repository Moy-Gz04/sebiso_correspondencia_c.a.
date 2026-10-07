// =========================================================
// minisebiso-flotante.js
// Coloca a MiniSEBISO dormido en la esquina inferior derecha.
// Al tocarlo despierta 5 segundos: abre los ojos (siguen el ratón)
// y dice que pronto estará funcionando; luego se vuelve a dormir.
// =========================================================

(function () {
  if (document.querySelector('.ms-flotante')) return;
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = 'css/minisebiso-flotante.css?v=5';
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

// =========================================================
// MiniSEBISO.preguntar(): diálogo de confirmación "hablado" por la mascota.
// Salta desde su esquina hasta un lado de la ventana, la ventana es su globo
// de diálogo y responde con una animación distinta al cancelar o confirmar.
// Devuelve una promesa con true (confirmó) o false (canceló).
// =========================================================
(function () {
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));
  const anim = (el, frames, opts) => quieto ? Promise.resolve() : el.animate(frames, opts).finished.catch(() => {});

  function mascotaHTML() {
    return `
      <div class="ms-cuerpo">
        <span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span>
        <span class="ms-ojo-mov der"><span class="ms-ojo"></span></span>
      </div>
      <div class="ms-estrella"></div>`;
  }

  async function preguntar({ titulo = '¡Hola!', pregunta = '', detalle = '', btnOk = 'Sí, eliminar', btnCancel = 'Cancelar', iconoOk = 'ti-trash' } = {}) {
    const esquina = document.querySelector('.ms-flotante');
    const overlay = document.createElement('div');
    overlay.className = 'ms-dlg-overlay';
    overlay.innerHTML = `
      <div class="ms-dlg-escena" role="alertdialog" aria-modal="true" aria-labelledby="ms-dlg-pregunta">
        <div class="minisebiso ms-dlg-mascota" aria-hidden="true">${mascotaHTML()}</div>
        <div class="ms-dlg-globo">
          <div class="ms-dlg-saludo">${titulo}</div>
          <div class="ms-dlg-pregunta" id="ms-dlg-pregunta">${pregunta}</div>
          ${detalle ? `<div class="ms-dlg-detalle">${detalle}</div>` : ''}
          <div class="ms-dlg-botones">
            <button type="button" class="ms-dlg-btn ms-dlg-cancelar"><i class="ti ti-x"></i> ${btnCancel}</button>
            <button type="button" class="ms-dlg-btn ms-dlg-ok"><i class="ti ${iconoOk}"></i> ${btnOk}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const mascota = overlay.querySelector('.ms-dlg-mascota');
    const globo = overlay.querySelector('.ms-dlg-globo');
    const ojos = mascota.querySelectorAll('.ms-ojo-mov');
    const mirar = (dx, dy) => ojos.forEach(o => { o.style.setProperty('--dx', dx + 'px'); o.style.setProperty('--dy', dy + 'px'); });
    // Durante el vuelo los ojos giran en círculo, como mareado; devuelve una función para detenerlos
    const ojosEnVuelo = (ms) => {
      if (quieto) return () => {};
      const t0 = performance.now(); let id = 0;
      const paso = (t) => {
        const a = (t - t0) / 110;                 // ~una vuelta de ojos cada 0.7 s
        mirar(Math.cos(a) * 5, Math.sin(a) * 4);
        if (t - t0 < ms) id = requestAnimationFrame(paso);
      };
      id = requestAnimationFrame(paso);
      return () => cancelAnimationFrame(id);
    };

    // Desde dónde salta: la mascota de la esquina (o la esquina inferior derecha)
    const destino = mascota.getBoundingClientRect();
    const origen = esquina ? esquina.getBoundingClientRect() : { left: innerWidth - 110, top: innerHeight - 100, width: 92, height: 83 };
    const dx = (origen.left + origen.width / 2) - (destino.left + destino.width / 2);
    const dy = (origen.top + origen.height / 2) - (destino.top + destino.height / 2);
    const s0 = origen.width / destino.width;
    if (esquina) { esquina.classList.remove('dormido', 'hablando'); esquina.style.visibility = 'hidden'; }

    requestAnimationFrame(() => overlay.classList.add('visible'));
    globo.style.opacity = '0';
    // Salto en arco con marometa (una vuelta completa); los ojos van dando vueltas
    const pararOjos = ojosEnVuelo(1000);
    await anim(mascota, [
      { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(0deg)` },
      { transform: `translate(${dx * .7}px, ${dy * .7 - 120}px) scale(${(s0 * 2 + 1) / 3}) rotate(-60deg)`, offset: .25 },
      { transform: `translate(${dx * .4}px, ${dy * .4 - 210}px) scale(${(s0 + 1) / 2}) rotate(-200deg)`, offset: .55 },
      { transform: 'translate(0, -40px) scale(1.04) rotate(-330deg)', offset: .85 },
      { transform: 'translate(0, 0) scale(1) rotate(-360deg)' }
    ], { duration: 1000, easing: 'cubic-bezier(.4, .05, .4, 1)' });
    pararOjos();
    await anim(mascota, [
      { transform: 'scale(1.12, .86)' }, { transform: 'scale(.95, 1.06)' }, { transform: 'scale(1)' }
    ], { duration: 320, easing: 'ease-out' });
    // El globo "sale" de la mascota
    globo.style.opacity = '';
    mirar(4, 0);
    await anim(globo, [
      { opacity: 0, transform: 'translateX(-24px) scale(.6)' },
      { opacity: 1, transform: 'translateX(4px) scale(1.03)', offset: .7 },
      { opacity: 1, transform: 'none' }
    ], { duration: 380, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    overlay.querySelector('.ms-dlg-cancelar').focus();

    const respuesta = await new Promise((resolve) => {
      overlay.querySelector('.ms-dlg-ok').onclick = () => resolve(true);
      overlay.querySelector('.ms-dlg-cancelar').onclick = () => resolve(false);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) resolve(false); });
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') resolve(false); });
    });
    overlay.querySelectorAll('.ms-dlg-btn').forEach(b => { b.disabled = true; });

    if (respuesta) {
      // Confirmó: la mascota se decide (aprieta y brinca), el globo se arruga y sale volando
      globo.querySelector('.ms-dlg-saludo').textContent = '¡Entendido!';
      globo.querySelector('.ms-dlg-pregunta').textContent = 'Lo elimino ahora mismo…';
      mirar(4, 3);
      await anim(mascota, [
        { transform: 'scale(1)' }, { transform: 'scale(1.15, .8)', offset: .35 },
        { transform: 'translateY(-34px) scale(.92, 1.1) rotate(6deg)', offset: .7 }, { transform: 'scale(1)' }
      ], { duration: 520, easing: 'ease-in-out' });
      await anim(globo, [
        { transform: 'none', opacity: 1 },
        { transform: 'scale(.82) rotate(-6deg)', opacity: 1, offset: .35 },
        { transform: 'translate(220px, 260px) scale(.08) rotate(220deg)', opacity: 0 }
      ], { duration: 560, easing: 'cubic-bezier(.55, 0, .75, .4)' });
      globo.style.visibility = 'hidden';
    } else {
      // Canceló: la mascota niega con la cabeza y el globo regresa a ella
      globo.querySelector('.ms-dlg-saludo').textContent = '¡Va!';
      globo.querySelector('.ms-dlg-pregunta').textContent = 'Lo dejamos como está.';
      await anim(mascota, [
        { transform: 'rotate(0deg)' }, { transform: 'rotate(-9deg)' }, { transform: 'rotate(9deg)' },
        { transform: 'rotate(-6deg)' }, { transform: 'rotate(0deg)' }
      ], { duration: 520, easing: 'ease-in-out' });
      await esperar(quieto ? 0 : 350);
      await anim(globo, [
        { opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-30px) scale(.5)' }
      ], { duration: 260, easing: 'ease-in' });
      globo.style.visibility = 'hidden';
    }

    // Regresa saltando a su esquina y se vuelve a dormir
    const ahora = mascota.getBoundingClientRect();
    const rx = (origen.left + origen.width / 2) - (ahora.left + ahora.width / 2);
    const ry = (origen.top + origen.height / 2) - (ahora.top + ahora.height / 2);
    overlay.classList.remove('visible');
    // Regreso con marometa hacia el otro lado y los ojos dando vueltas
    const pararOjos2 = ojosEnVuelo(950);
    await anim(mascota, [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
      { transform: 'translate(0, -50px) scale(1.04) rotate(40deg)', offset: .18 },
      { transform: `translate(${rx * .55}px, ${ry * .55 - 200}px) scale(${(s0 + 1) / 2}) rotate(190deg)`, offset: .5 },
      { transform: `translate(${rx * .85}px, ${ry * .85 - 70}px) scale(${(s0 * 2 + 1) / 3}) rotate(320deg)`, offset: .8 },
      { transform: `translate(${rx}px, ${ry}px) scale(${s0}) rotate(360deg)` }
    ], { duration: 950, easing: 'cubic-bezier(.4, .05, .4, 1)', fill: 'forwards' });
    pararOjos2();
    overlay.remove();
    if (esquina) { esquina.style.visibility = ''; esquina.classList.add('dormido'); }
    return respuesta;
  }

  window.MiniSEBISO = Object.assign(window.MiniSEBISO || {}, { preguntar });
})();
