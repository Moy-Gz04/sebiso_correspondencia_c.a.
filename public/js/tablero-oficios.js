// =========================================================
// tablero-oficios.js
// Botón con ícono de gráfica a la izquierda del de asistencia: abre una
// ventana grande con el tablero de oficios (total, subturnados,
// atendidos, completados y por corregir), con gráficas:
//   - dona con la proporción por estatus;
//   - Coordinación Administrativa: barras apiladas por área;
//   - cada área: barras de su propio avance.
// C.A. ve todas las áreas; cada área ve solo la suya.
// Los datos vienen de /api/oficios/resumen.
// =========================================================
(function () {
  if (window.__tableroOficios) return;
  window.__tableroOficios = true;

  const API = location.origin + '/api';
  const token = () => localStorage.getItem('sbis_token') || sessionStorage.getItem('sbis_token') || '';
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = (n) => Number(n || 0).toLocaleString('es-MX');

  // Colores por estatus (mismo orden en tarjetas, dona, barras y leyenda)
  const ESTADOS = [
    { k: 'sub_turnado', t: 'Subturnados',  c: '#C08A2E', ic: 'ti-arrows-split-2' },
    { k: 'atendido',    t: 'Atendidos',    c: '#2F6FB0', ic: 'ti-checks' },
    { k: 'completado',  t: 'Completados',  c: '#2E7D4F', ic: 'ti-circle-check' },
    { k: 'rechazado',   t: 'Por corregir', c: '#8A2440', ic: 'ti-alert-triangle' },
  ];
  const OTROS = { t: 'Por turnar / turnados', c: '#CDBFB0' };

  const css = document.createElement('style');
  css.textContent = `
    .tab-icono{ display:inline-grid; place-items:center; width:42px; height:42px; padding:0; margin:0 8px 0 0; border-radius:50%;
      border:1.5px solid rgba(188,149,92,.55); background:#fff; color:#3D1420; cursor:pointer;
      box-shadow:0 2px 8px rgba(61,20,32,.12); transition:transform .15s ease, box-shadow .2s ease; }
    .tab-icono svg{ width:24px; height:24px; }
    .tab-icono:hover{ transform:translateY(-1px); box-shadow:0 4px 14px rgba(61,20,32,.2); }
    .tab-icono:focus-visible{ outline:2px solid #D8B866; outline-offset:2px; }

    .tab-fondo{ position:fixed; inset:0; z-index:12500; display:grid; place-items:center; padding:20px;
      background:rgba(42,10,21,.42); backdrop-filter:blur(3px); animation:tabFondo .2s ease-out; }
    @keyframes tabFondo{ from{ opacity:0; } to{ opacity:1; } }
    .tab-ventana{ width:min(1080px, 100%); max-height:calc(100vh - 40px); overflow-y:auto; box-sizing:border-box;
      background:#FFFDF9; border:1px solid #E4D6C8; border-radius:24px; box-shadow:0 30px 70px rgba(42,10,21,.35);
      font-family:'Montserrat',sans-serif; color:#3D1420; animation:tabEntra .24s cubic-bezier(.2,.9,.3,1.1); }
    @keyframes tabEntra{ from{ opacity:0; transform:translateY(14px) scale(.98);} to{ opacity:1; transform:none; } }
    .tab-cab{ position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:16px;
      padding:22px 30px 18px; background:linear-gradient(180deg,#FFFFFF,#FBF6EE); border-bottom:1px solid #E4D6C8; }
    .tab-cab::after{ content:''; position:absolute; left:0; right:0; bottom:-1px; height:3px;
      background:linear-gradient(90deg,#5F2132 0 30%,#A9824C 30% 70%,#5F2132 70% 100%); }
    .tab-tit{ font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:#7C5D31; }
    .tab-area{ font-size:22px; font-weight:800; color:#3D1420; margin-top:2px; letter-spacing:-.01em; }
    .tab-acc{ display:flex; gap:8px; }
    .tab-btn{ display:inline-grid; place-items:center; width:38px; height:38px; margin:0; padding:0; border-radius:50%; cursor:pointer;
      border:1px solid #E4D6C8; background:#fff; color:#5F2132; font-size:18px; }
    .tab-btn:hover{ background:#F6EEDD; }
    .tab-cuerpo{ padding:24px 30px 30px; display:flex; flex-direction:column; gap:24px; }

    .tab-kpis{ display:grid; grid-template-columns:1.25fr repeat(4,1fr); gap:14px; }
    .tab-kpi{ position:relative; padding:16px 18px; border-radius:16px; background:#fff; border:1px solid #EFE4D6; overflow:hidden; }
    .tab-kpi::before{ content:''; position:absolute; left:0; top:0; bottom:0; width:5px; background:var(--c); }
    .tab-kpi i{ font-size:20px; color:var(--c); }
    .tab-kpi span{ display:block; margin-top:6px; font-size:12px; font-weight:600; color:#6B5563; }
    .tab-kpi b{ display:block; margin-top:2px; font-size:30px; font-weight:800; color:#3D1420; font-variant-numeric:tabular-nums; line-height:1.1; }
    .tab-kpi small{ font-size:12px; font-weight:700; color:var(--c); }
    .tab-kpi.total{ background:linear-gradient(135deg,#5F2132,#3D1420); border-color:transparent; color:#fff; }
    .tab-kpi.total::before{ display:none; }
    .tab-kpi.total i{ color:#E9C873; } .tab-kpi.total span{ color:rgba(255,255,255,.8); } .tab-kpi.total b{ color:#fff; font-size:38px; }

    .tab-graficas{ display:grid; grid-template-columns:minmax(260px,340px) 1fr; gap:20px; align-items:stretch; }
    .tab-tarjeta{ padding:20px 22px; border-radius:18px; background:#fff; border:1px solid #EFE4D6; min-width:0; }
    .tab-tarjeta h3{ margin:0 0 14px; font-size:14px; font-weight:700; color:#3D1420; }
    .tab-tarjeta h3 small{ font-weight:500; color:#9A8A90; font-size:12px; margin-left:6px; }
    .tab-dona{ display:flex; flex-direction:column; align-items:center; gap:16px; }
    .tab-dona svg{ width:200px; height:200px; }
    .tab-dona .seg{ transition:opacity .15s; }
    .tab-dona svg:hover .seg{ opacity:.45; } .tab-dona svg .seg:hover{ opacity:1; }
    .tab-leyenda{ display:grid; grid-template-columns:1fr; gap:6px; width:100%; }
    .tab-leyenda div{ display:flex; align-items:center; gap:8px; font-size:12.5px; color:#3D1420; }
    .tab-leyenda i{ width:12px; height:12px; border-radius:4px; background:var(--c); flex-shrink:0; }
    .tab-leyenda b{ margin-left:auto; font-variant-numeric:tabular-nums; }
    .tab-leyenda em{ font-style:normal; color:#9A8A90; font-size:11.5px; width:42px; text-align:right; }

    .tab-barras{ display:flex; flex-direction:column; gap:12px; }
    .tab-fila{ display:grid; grid-template-columns:minmax(120px,190px) 1fr 52px; align-items:center; gap:12px; }
    .tab-fila .nom{ font-size:12.5px; font-weight:600; color:#3D1420; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tab-fila .pista{ display:flex; height:18px; border-radius:999px; background:#F3ECE4; overflow:hidden; }
    .tab-fila .pista i{ display:block; height:100%; background:var(--c); transition:filter .15s; }
    .tab-fila .pista i:hover{ filter:brightness(1.12); }
    .tab-fila .tot{ font-size:13px; font-weight:800; text-align:right; font-variant-numeric:tabular-nums; }
    .tab-ley-h{ display:flex; flex-wrap:wrap; gap:14px; margin-top:16px; padding-top:12px; border-top:1px solid #F3ECE4; }
    .tab-ley-h div{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:#6B5563; }
    .tab-ley-h i{ width:10px; height:10px; border-radius:3px; background:var(--c); }

    .tab-col{ display:flex; align-items:flex-end; justify-content:space-around; gap:18px; height:230px; padding:10px 6px 0; border-bottom:2px solid #EFE4D6; }
    .tab-col div{ flex:1; max-width:90px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:6px; }
    .tab-col b{ font-size:15px; font-weight:800; font-variant-numeric:tabular-nums; }
    .tab-col i{ display:block; width:100%; border-radius:10px 10px 0 0; background:var(--c); min-height:3px; }
    .tab-col-et{ display:flex; justify-content:space-around; gap:18px; padding:8px 6px 0; }
    .tab-col-et span{ flex:1; max-width:90px; text-align:center; font-size:11.5px; font-weight:600; color:#6B5563; }

    .tab-msg{ padding:60px 20px; text-align:center; color:#6B5563; font-size:14px; }
    @media (max-width:900px){ .tab-kpis{ grid-template-columns:repeat(2,1fr); } .tab-kpi.total{ grid-column:1 / -1; } .tab-graficas{ grid-template-columns:1fr; } }
    @media (max-width:560px){ .tab-cab, .tab-cuerpo{ padding-left:18px; padding-right:18px; } .tab-fila{ grid-template-columns:96px 1fr 44px; } }
    @media (prefers-reduced-motion:reduce){ .tab-fondo, .tab-ventana{ animation:none; } }`;
  document.head.appendChild(css);

  /* Dona en SVG: un arco por estatus (y «otros» en gris) */
  function dona(t) {
    const partes = ESTADOS.map(e => ({ v: t[e.k], c: e.c, t: e.t }));
    const otros = t.total - partes.reduce((s, p) => s + p.v, 0);
    if (otros > 0) partes.push({ v: otros, c: OTROS.c, t: OTROS.t });
    const R = 80, C = 2 * Math.PI * R;
    let acum = 0;
    const arcos = partes.filter(p => p.v > 0).map(p => {
      const largo = p.v / t.total * C, sep = partes.filter(x => x.v > 0).length > 1 ? 2 : 0;
      const a = `<circle class="seg" cx="100" cy="100" r="${R}" fill="none" stroke="${p.c}" stroke-width="30"
        stroke-dasharray="${Math.max(largo - sep, 0)} ${C}" stroke-dashoffset="${-acum}" transform="rotate(-90 100 100)"><title>${esc(p.t)}: ${num(p.v)}</title></circle>`;
      acum += largo; return a;
    }).join('');
    return `<svg viewBox="0 0 200 200" role="img" aria-label="Proporción de oficios por estatus">
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="#F3ECE4" stroke-width="30"/>${arcos}
      <text x="100" y="96" text-anchor="middle" font-family="Montserrat,sans-serif" font-size="30" font-weight="800" fill="#3D1420">${num(t.total)}</text>
      <text x="100" y="118" text-anchor="middle" font-family="Montserrat,sans-serif" font-size="11" font-weight="600" fill="#9A8A90">oficios</text>
    </svg>`;
  }

  function pintar(cuerpo, d) {
    const t = d.totales, pct = (n) => t.total ? Math.round(n / t.total * 100) : 0;
    const otros = t.total - ESTADOS.reduce((s, e) => s + t[e.k], 0);
    const leyenda = [...ESTADOS.map(e => ({ t: e.t, c: e.c, v: t[e.k] })), ...(otros > 0 ? [{ t: OTROS.t, c: OTROS.c, v: otros }] : [])];

    // Derecha: por área (C.A.) o el avance del área
    let derecha;
    if (d.general && d.areas.length) {
      const max = Math.max(...d.areas.map(a => a.total), 1);
      derecha = `<div class="tab-tarjeta"><h3>Oficios por área<small>barras apiladas por estatus</small></h3>
        <div class="tab-barras">${d.areas.map(a => {
          const otrosA = a.total - ESTADOS.reduce((s, e) => s + a[e.k], 0);
          const segs = ESTADOS.map(e => a[e.k] ? `<i style="--c:${e.c}; width:${a[e.k] / max * 100}%" title="${esc(e.t)}: ${num(a[e.k])}"></i>` : '').join('')
            + (otrosA > 0 ? `<i style="--c:${OTROS.c}; width:${otrosA / max * 100}%" title="${OTROS.t}: ${num(otrosA)}"></i>` : '');
          return `<div class="tab-fila"><span class="nom" title="${esc(a.nombre)}">${esc(a.nombre)}</span><span class="pista">${segs}</span><span class="tot">${num(a.total)}</span></div>`;
        }).join('')}</div>
        <div class="tab-ley-h">${leyenda.map(l => `<div><i style="--c:${l.c}"></i>${esc(l.t)}</div>`).join('')}</div></div>`;
    } else {
      const max = Math.max(...leyenda.map(l => l.v), 1);
      derecha = `<div class="tab-tarjeta"><h3>Avance del área<small>oficios por estatus</small></h3>
        <div class="tab-col">${leyenda.map(l => `<div><b>${num(l.v)}</b><i style="--c:${l.c}; height:${l.v / max * 85}%"></i></div>`).join('')}</div>
        <div class="tab-col-et">${leyenda.map(l => `<span>${esc(l.t)}</span>`).join('')}</div></div>`;
    }

    cuerpo.innerHTML = `
      <div class="tab-kpis">
        <div class="tab-kpi total"><i class="ti ti-files"></i><span>Oficios totales</span><b>${num(t.total)}</b></div>
        ${ESTADOS.map(e => `<div class="tab-kpi" style="--c:${e.c}"><i class="ti ${e.ic}"></i><span>${e.t}</span><b>${num(t[e.k])}</b><small>${pct(t[e.k])}% del total</small></div>`).join('')}
      </div>
      <div class="tab-graficas">
        <div class="tab-tarjeta"><h3>Distribución<small>por estatus</small></h3>
          <div class="tab-dona">${dona(t)}
            <div class="tab-leyenda">${leyenda.map(l => `<div><i style="--c:${l.c}"></i>${esc(l.t)}<b>${num(l.v)}</b><em>${pct(l.v)}%</em></div>`).join('')}</div>
          </div>
        </div>
        ${derecha}
      </div>`;
  }

  let fondo = null;
  function cerrar() { if (!fondo) return; fondo.remove(); fondo = null; document.removeEventListener('keydown', teclas); document.querySelector('.tab-icono')?.focus(); }
  function teclas(e) { if (e.key === 'Escape') cerrar(); }
  async function cargar() {
    const cuerpo = fondo.querySelector('.tab-cuerpo');
    cuerpo.innerHTML = '<div class="tab-msg">Cargando el tablero…</div>';
    try {
      const r = await fetch(API + '/oficios/resumen', { headers: { Authorization: 'Bearer ' + token() } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.mensaje || 'No se pudo cargar el resumen.');
      if (!fondo) return;
      fondo.querySelector('.tab-area').textContent = d.area;
      pintar(cuerpo, d);
    } catch (e) {
      if (fondo) cuerpo.innerHTML = `<div class="tab-msg">${esc(e.message)}</div>`;
    }
  }
  function abrir() {
    if (fondo) return;
    fondo = document.createElement('div');
    fondo.className = 'tab-fondo';
    fondo.innerHTML = `
      <div class="tab-ventana" role="dialog" aria-modal="true" aria-label="Tablero de oficios">
        <div class="tab-cab">
          <div><div class="tab-tit">Tablero de oficios</div><div class="tab-area">…</div></div>
          <div class="tab-acc">
            <button type="button" class="tab-btn tab-actualizar" title="Actualizar" aria-label="Actualizar"><i class="ti ti-refresh"></i></button>
            <button type="button" class="tab-btn tab-cerrar" title="Cerrar" aria-label="Cerrar"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <div class="tab-cuerpo"></div>
      </div>`;
    document.body.appendChild(fondo);
    fondo.addEventListener('pointerdown', (e) => { if (e.target === fondo) cerrar(); });
    fondo.querySelector('.tab-cerrar').onclick = cerrar;
    fondo.querySelector('.tab-actualizar').onclick = cargar;
    document.addEventListener('keydown', teclas);
    fondo.querySelector('.tab-cerrar').focus();
    cargar();
  }

  function preparar() {
    const salir = document.querySelector('.btn-cerrar-sesion');
    if (!salir || document.querySelector('.tab-icono') || !token()) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab-icono';
    b.setAttribute('aria-label', 'Tablero de oficios'); b.title = 'Tablero de oficios';
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx=".6"/><rect x="12" y="8" width="3" height="10" rx=".6"/><rect x="17" y="5" width="3" height="13" rx=".6"/></svg>`;
    // A la izquierda del botón de asistencia (o de «Cerrar sesión» si no está)
    const ancla = document.querySelector('.nav-asis-caja') || salir;
    ancla.parentNode.insertBefore(b, ancla);
    b.addEventListener('click', abrir);
  }

  // El botón del asistente se agrega después; se espera a que exista para quedar a su izquierda
  let intentos = 0;
  const intentar = () => { if (document.querySelector('.nav-asis-caja') || intentos > 20) preparar(); else { intentos++; setTimeout(intentar, 150); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', intentar); else intentar();
})();
