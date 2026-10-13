// =========================================================
// tablero-oficios.js
// Botón con ícono de gráfica a la izquierda del de asistencia: abre una
// ventana flotante con el resumen de oficios (total, subturnados,
// atendidos, completados y por corregir). Coordinación Administrativa
// ve todas las áreas (con su desglose); cada área ve solo la suya.
// Los datos vienen de /api/oficios/resumen.
// =========================================================
(function () {
  if (window.__tableroOficios) return;
  window.__tableroOficios = true;

  const API = location.origin + '/api';
  const token = () => localStorage.getItem('sbis_token') || sessionStorage.getItem('sbis_token') || '';
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = (n) => Number(n || 0).toLocaleString('es-MX');

  const css = document.createElement('style');
  css.textContent = `
    .tab-caja{ position:relative; display:inline-flex; margin-right:8px; }
    .tab-icono{ display:inline-grid; place-items:center; width:42px; height:42px; padding:0; margin:0; border-radius:50%;
      border:1.5px solid rgba(188,149,92,.55); background:#fff; color:#3D1420; cursor:pointer;
      box-shadow:0 2px 8px rgba(61,20,32,.12); transition:transform .15s ease, box-shadow .2s ease, background .2s ease, color .2s ease; }
    .tab-icono svg{ width:24px; height:24px; }
    .tab-icono:hover{ transform:translateY(-1px); box-shadow:0 4px 14px rgba(61,20,32,.2); }
    .tab-caja.abierta .tab-icono{ background:linear-gradient(135deg,#5F2132,#3D1420); color:#F6EEDD; border-color:#A9824C; }
    .tab-icono:focus-visible{ outline:2px solid #D8B866; outline-offset:2px; }
    .tab-panel{ position:absolute; top:calc(100% + 10px); right:-60px; z-index:2600; width:min(440px, calc(100vw - 24px)); padding:16px;
      background:#FFFDF9; border:1px solid #E4D6C8; border-radius:18px; box-shadow:0 18px 40px rgba(42,10,21,.24);
      font-family:'Montserrat',sans-serif; color:#3D1420; animation:tabEntra .18s ease-out; }
    .tab-panel[hidden]{ display:none; }
    .tab-panel::before{ content:''; position:absolute; top:-7px; right:75px; width:12px; height:12px; background:#FFFDF9;
      border-left:1px solid #E4D6C8; border-top:1px solid #E4D6C8; transform:rotate(45deg); }
    @keyframes tabEntra{ from{ opacity:0; transform:translateY(-6px);} to{ opacity:1; transform:none; } }
    .tab-cab{ display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:12px; }
    .tab-tit{ font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#7C5D31; }
    .tab-area{ font-size:15px; font-weight:700; color:#3D1420; margin-top:2px; }
    .tab-actualizar{ border:0; background:none; color:#A9824C; cursor:pointer; font-size:18px; padding:2px; width:auto; margin:0; }
    .tab-actualizar:hover{ color:#5F2132; }
    .tab-total{ display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:14px;
      background:linear-gradient(135deg,#5F2132,#3D1420); color:#fff; margin-bottom:10px; }
    .tab-total span{ font-size:12px; font-weight:600; letter-spacing:.04em; opacity:.85; }
    .tab-total b{ font-size:26px; font-weight:800; font-variant-numeric:tabular-nums; }
    .tab-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
    .tab-kpi{ padding:10px 12px; border-radius:12px; background:#fff; border:1px solid #EFE4D6; border-left:4px solid var(--c); }
    .tab-kpi span{ display:block; font-size:11px; font-weight:600; color:#6B5563; }
    .tab-kpi b{ display:block; font-size:20px; font-weight:800; color:#3D1420; font-variant-numeric:tabular-nums; margin-top:2px; }
    .tab-kpi small{ font-size:11px; font-weight:600; color:#9A8A90; }
    .tab-barra{ display:flex; height:10px; border-radius:999px; overflow:hidden; background:#EFE6DA; margin:12px 0 4px; }
    .tab-barra i{ display:block; height:100%; background:var(--c); }
    .tab-leyenda{ font-size:10.5px; color:#9A8A90; }
    .tab-areas{ margin-top:12px; max-height:220px; overflow-y:auto; border-top:1px solid #EFE4D6; padding-top:8px; }
    .tab-areas table{ width:100%; border-collapse:collapse; font-size:11.5px; font-variant-numeric:tabular-nums; }
    .tab-areas th{ position:sticky; top:0; background:#FFFDF9; text-align:right; font-weight:700; color:#7C5D31; padding:4px 6px; font-size:10px; letter-spacing:.04em; text-transform:uppercase; }
    .tab-areas th:first-child, .tab-areas td:first-child{ text-align:left; }
    .tab-areas td{ padding:5px 6px; text-align:right; border-top:1px solid #F3ECE4; color:#3D1420; }
    .tab-areas td:first-child{ font-weight:600; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tab-msg{ padding:20px; text-align:center; color:#6B5563; font-size:13px; }
    @media (prefers-reduced-motion:reduce){ .tab-panel{ animation:none; } }`;
  document.head.appendChild(css);

  const ESTADOS = [
    { k: 'sub_turnado', t: 'Subturnados',   c: '#B7791F' },
    { k: 'atendido',    t: 'Atendidos',     c: '#2F6FB0' },
    { k: 'completado',  t: 'Completados',   c: '#2E7D32' },
    { k: 'rechazado',   t: 'Por corregir',  c: '#7A1E35' },
  ];

  function pintar(panel, d) {
    const t = d.totales, pct = (n) => t.total ? Math.round(n / t.total * 100) : 0;
    const otros = t.total - ESTADOS.reduce((s, e) => s + t[e.k], 0);
    panel.querySelector('.tab-cuerpo').innerHTML = `
      <div class="tab-total"><span>Oficios totales</span><b>${num(t.total)}</b></div>
      <div class="tab-grid">
        ${ESTADOS.map(e => `<div class="tab-kpi" style="--c:${e.c}"><span>${e.t}</span><b>${num(t[e.k])}</b><small>${pct(t[e.k])}%</small></div>`).join('')}
      </div>
      <div class="tab-barra" role="img" aria-label="Proporción por estatus">
        ${ESTADOS.map(e => t[e.k] ? `<i style="--c:${e.c}; width:${t[e.k] / t.total * 100}%" title="${e.t}: ${num(t[e.k])}"></i>` : '').join('')}
        ${otros > 0 ? `<i style="--c:#CDBFB0; width:${otros / t.total * 100}%" title="Por turnar o turnados: ${num(otros)}"></i>` : ''}
      </div>
      <div class="tab-leyenda">${otros > 0 ? `Gris: ${num(otros)} por turnar o turnados, sin subturnar aún.` : ''}</div>
      ${d.general && d.areas.length ? `
        <div class="tab-areas"><table>
          <thead><tr><th>Área</th><th>Total</th><th>Subt.</th><th>Aten.</th><th>Comp.</th><th>Corr.</th></tr></thead>
          <tbody>${d.areas.map(a => `<tr><td title="${esc(a.nombre)}">${esc(a.nombre)}</td><td>${num(a.total)}</td><td>${num(a.sub_turnado)}</td><td>${num(a.atendido)}</td><td>${num(a.completado)}</td><td>${num(a.rechazado)}</td></tr>`).join('')}</tbody>
        </table></div>` : ''}`;
    panel.querySelector('.tab-area').textContent = d.area;
  }

  async function cargar(panel) {
    panel.querySelector('.tab-cuerpo').innerHTML = '<div class="tab-msg">Cargando…</div>';
    try {
      const r = await fetch(API + '/oficios/resumen', { headers: { Authorization: 'Bearer ' + token() } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.mensaje || 'No se pudo cargar el resumen.');
      pintar(panel, d);
    } catch (e) {
      panel.querySelector('.tab-cuerpo').innerHTML = `<div class="tab-msg">${esc(e.message)}</div>`;
    }
  }

  function preparar() {
    const salir = document.querySelector('.btn-cerrar-sesion');
    if (!salir || document.querySelector('.tab-caja') || !token()) return false;
    const caja = document.createElement('div');
    caja.className = 'tab-caja';
    caja.innerHTML = `
      <button type="button" class="tab-icono" aria-haspopup="true" aria-expanded="false" aria-label="Tablero de oficios" title="Tablero de oficios">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx=".6"/><rect x="12" y="8" width="3" height="10" rx=".6"/><rect x="17" y="5" width="3" height="13" rx=".6"/>
        </svg>
      </button>
      <div class="tab-panel" role="dialog" aria-label="Tablero de oficios" hidden>
        <div class="tab-cab">
          <div><div class="tab-tit">Tablero de oficios</div><div class="tab-area">…</div></div>
          <button type="button" class="tab-actualizar" title="Actualizar" aria-label="Actualizar"><i class="ti ti-refresh" aria-hidden="true"></i></button>
        </div>
        <div class="tab-cuerpo"></div>
      </div>`;
    // A la izquierda del botón de asistencia (o de «Cerrar sesión» si no está)
    const ancla = document.querySelector('.nav-asis-caja') || salir;
    ancla.parentNode.insertBefore(caja, ancla);
    const icono = caja.querySelector('.tab-icono'), panel = caja.querySelector('.tab-panel');
    const abrir = (si) => {
      panel.hidden = !si; icono.setAttribute('aria-expanded', si ? 'true' : 'false'); caja.classList.toggle('abierta', si);
      if (si) cargar(panel);
    };
    icono.addEventListener('click', (e) => { e.stopPropagation(); abrir(panel.hidden); });
    caja.querySelector('.tab-actualizar').addEventListener('click', () => cargar(panel));
    document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !caja.contains(e.target)) abrir(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { abrir(false); icono.focus(); } });
    return true;
  }

  // El botón del asistente se agrega después; se espera a que exista para quedar a su izquierda
  let intentos = 0;
  const intentar = () => { if (document.querySelector('.nav-asis-caja') || intentos > 20) preparar(); else { intentos++; setTimeout(intentar, 150); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', intentar); else intentar();
})();
