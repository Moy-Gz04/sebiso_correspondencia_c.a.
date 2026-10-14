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
  // Nombres largos en las píldoras del tablero (el nombre completo va en el título)
  const corto = (n) => String(n)
    .replace(/^Coordinación Administrativa$/i, 'Coord. Admva.')
    .replace(/^Seguimiento de Auditorías$/i, 'Seg. de Auditorías');

  // Colores por estatus (mismo orden en tarjetas, dona, barras y leyenda)
  const ESTADOS = [
    { k: 'por_turnar',  t: 'Por turnar',   c: '#7B61C9', c2: '#A08BE8', ic: 'ti-inbox' },
    { k: 'turnado',     t: 'Turnados',     c: '#2C8FC9', c2: '#62B6E6', ic: 'ti-send' },
    { k: 'sub_turnado', t: 'Subturnados',  c: '#E39A2D', c2: '#F5C26B', ic: 'ti-arrows-split-2' },
    { k: 'atendido',    t: 'Atendidos',    c: '#14A39A', c2: '#4CD1C6', ic: 'ti-checks' },
    { k: 'completado',  t: 'Completados',  c: '#2E9D5B', c2: '#5FCB8A', ic: 'ti-circle-check' },
    { k: 'rechazado',   t: 'Por corregir', c: '#D1405E', c2: '#EE7F95', ic: 'ti-alert-triangle' },
  ];
  const OTROS = { t: 'Otros', c: '#CDBFB0' };
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = document.createElement('style');
  css.textContent = `
    .tab-icono{ display:inline-grid; place-items:center; width:42px; height:42px; padding:0; margin:0 8px 0 0; border-radius:50%;
      border:1.5px solid rgba(188,149,92,.55); background:#fff; color:#3D1420; cursor:pointer;
      box-shadow:0 2px 8px rgba(61,20,32,.12); transition:transform .15s ease, box-shadow .2s ease; }
    .tab-icono svg{ width:21px; height:21px; }
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

    .tab-kpis{ display:grid; grid-template-columns:1.3fr repeat(3,1fr); gap:14px; }
    .tab-kpi{ position:relative; padding:16px 18px; border-radius:16px; overflow:hidden; border:1px solid color-mix(in srgb, var(--c) 22%, #fff);
      background:linear-gradient(145deg, color-mix(in srgb, var(--c) 9%, #fff) 0%, #fff 70%);
      box-shadow:0 2px 8px color-mix(in srgb, var(--c) 10%, transparent); transition:transform .2s ease, box-shadow .2s ease;
      opacity:0; transform:translateY(10px); animation:tabSube .5s cubic-bezier(.2,.9,.3,1) forwards; animation-delay:calc(var(--i) * 60ms); }
    .tab-kpi:hover{ transform:translateY(-3px); box-shadow:0 10px 22px color-mix(in srgb, var(--c) 22%, transparent); }
    @keyframes tabSube{ to{ opacity:1; transform:none; } }
    .tab-kpi::before{ content:''; position:absolute; left:0; top:0; bottom:0; width:5px; background:linear-gradient(180deg, var(--c2), var(--c)); }
    .tab-kpi::after{ content:''; position:absolute; right:-28px; top:-28px; width:90px; height:90px; border-radius:50%; background:radial-gradient(circle, color-mix(in srgb, var(--c) 16%, transparent), transparent 70%); }
    .tab-kpi i{ display:inline-grid; place-items:center; width:34px; height:34px; border-radius:10px; font-size:19px; color:#fff; background:linear-gradient(135deg, var(--c2), var(--c)); box-shadow:0 4px 10px color-mix(in srgb, var(--c) 35%, transparent); }
    .tab-kpi span{ display:block; margin-top:0; font-size:12px; font-weight:600; color:#6B5563; }
    .tab-kpi b{ display:block; margin-top:2px; font-size:30px; font-weight:800; color:#3D1420; font-variant-numeric:tabular-nums; line-height:1.1; }
    .tab-kpi small{ font-size:12px; font-weight:700; color:var(--c); }
    .tab-kpi.total{ grid-row:span 2; display:flex; flex-direction:column; justify-content:center; border-color:transparent; color:#fff;
      background:radial-gradient(circle at 85% 15%, rgba(233,200,115,.35), transparent 45%), linear-gradient(135deg,#7A2A40,#3D1420); }
    .tab-kpi.total::before, .tab-kpi.total::after{ display:none; }
    .tab-kpi.total i{ background:rgba(255,255,255,.14); color:#E9C873; box-shadow:none; width:44px; height:44px; font-size:24px; }
    .tab-kpi.total span{ color:rgba(255,255,255,.85); font-size:13px; } .tab-kpi.total b{ color:#fff; font-size:46px; }
    .tab-kpi.total small{ color:#E9C873; }

    .tab-graficas{ display:grid; grid-template-columns:minmax(260px,340px) 1fr; gap:20px; align-items:stretch; }
    .tab-tarjeta{ padding:20px 22px; border-radius:18px; background:#fff; border:1px solid #EFE4D6; min-width:0; }
    .tab-tarjeta h3{ margin:0 0 14px; font-size:14px; font-weight:700; color:#3D1420; }
    .tab-tarjeta h3 small{ font-weight:500; color:#9A8A90; font-size:12px; margin-left:6px; }
    .tab-dona{ display:flex; flex-direction:column; align-items:center; gap:16px; }
    .tab-dona svg{ width:200px; height:200px; }
    .tab-dona .seg{ transition:opacity .15s, stroke-dasharray 1s cubic-bezier(.2,.9,.3,1); }
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
    .tab-fila .pista i{ display:block; height:100%; width:0; background:linear-gradient(90deg, var(--c), var(--c2, var(--c))); transition:width .9s cubic-bezier(.2,.9,.3,1), filter .15s; }
    .tab-fila .pista i:hover{ filter:brightness(1.12); }
    .tab-fila .tot{ font-size:13px; font-weight:800; text-align:right; font-variant-numeric:tabular-nums; }
    .tab-ley-h{ display:flex; flex-wrap:wrap; gap:14px; margin-top:16px; padding-top:12px; border-top:1px solid #F3ECE4; }
    .tab-ley-h div{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:#6B5563; }
    .tab-ley-h i{ width:10px; height:10px; border-radius:3px; background:var(--c); }

    .tab-col{ display:flex; align-items:flex-end; justify-content:space-around; gap:18px; height:260px; padding:10px 6px 0; border-bottom:2px solid #EFE4D6; }
    .tab-col div{ flex:1; max-width:90px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:6px; }
    .tab-col b{ font-size:15px; font-weight:800; font-variant-numeric:tabular-nums; }
    .tab-col i{ display:block; width:100%; height:0; border-radius:10px 10px 0 0; background:linear-gradient(180deg, var(--c2, var(--c)), var(--c)); min-height:3px; transition:height .9s cubic-bezier(.2,.9,.3,1); }
    .tab-col-et{ display:flex; justify-content:space-around; gap:18px; padding:8px 6px 0; }
    .tab-col-et span{ flex:1; max-width:90px; text-align:center; font-size:11.5px; font-weight:600; color:#6B5563; }

    .tab-areas-sel{ display:grid; grid-template-columns:repeat(auto-fill, minmax(165px, 1fr)); gap:8px; margin:-4px 0 18px; }
    .tab-chip{ display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; min-width:0; margin:0; padding:8px 12px; border-radius:12px; cursor:pointer; text-align:left;
      border:1px solid #E4D6C8; background:#fff; color:#4A0A1D; font:600 12px 'Montserrat',sans-serif; transition:background .15s, transform .12s, box-shadow .15s; }
    .tab-chip b{ flex-shrink:0; font-weight:800; color:#A9824C; font-variant-numeric:tabular-nums; }
    .tab-chip span{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tab-chip:hover{ background:#F6EEDD; transform:translateY(-1px); }
    .tab-chip.activo{ background:linear-gradient(135deg,#5F2132,#3D1420); color:#fff; border-color:transparent; box-shadow:0 4px 12px rgba(61,20,32,.25); }
    .tab-chip.activo b{ color:#E9C873; }
    .tab-chip:focus-visible{ outline:2px solid #D8B866; outline-offset:2px; }
    .tab-msg{ padding:60px 20px; text-align:center; color:#6B5563; font-size:14px; }
    @media (max-width:900px){ .tab-kpis{ grid-template-columns:repeat(2,1fr); } .tab-kpi.total{ grid-column:1 / -1; grid-row:auto; } .tab-graficas{ grid-template-columns:1fr; } }
    @media (max-width:560px){ .tab-cab, .tab-cuerpo{ padding-left:18px; padding-right:18px; } .tab-fila{ grid-template-columns:96px 1fr 44px; } }
    @media (prefers-reduced-motion:reduce){ .tab-fondo, .tab-ventana, .tab-kpi{ animation:none; opacity:1; transform:none; } .tab-fila .pista i, .tab-col i, .tab-dona .seg{ transition:none; } }    /* Versión compacta: todo cabe en la ventana sin barra de desplazamiento */
    .tab-ventana{ width:min(1040px,100%); max-height:calc(100vh - 32px); border-radius:20px; }
    .tab-cab{ padding:14px 22px 12px; }
    .tab-tit{ font-size:10px; } .tab-area{ font-size:18px; }
    .tab-btn{ width:32px; height:32px; font-size:16px; }
    .tab-cuerpo{ padding:14px 22px 18px; gap:14px; }
    .tab-kpis{ gap:10px; }
    .tab-kpi{ padding:10px 14px; border-radius:13px; }
    .tab-kpi span{ font-size:11px; }
    .tab-kpi b{ font-size:22px; }
    .tab-kpi small{ font-size:10.5px; }
    .tab-kpi.total span{ font-size:12px; } .tab-kpi.total b{ font-size:36px; }
    .tab-graficas{ grid-template-columns:minmax(230px,280px) 1fr; gap:14px; }
    .tab-tarjeta{ padding:14px 16px; border-radius:15px; }
    .tab-tarjeta h3{ margin:0 0 10px; font-size:13px; } .tab-tarjeta h3 small{ font-size:11px; }
    .tab-dona{ gap:10px; } .tab-dona svg{ width:140px; height:140px; }
    .tab-leyenda{ gap:3px; } .tab-leyenda div{ font-size:11.5px; } .tab-leyenda i{ width:10px; height:10px; }
    .tab-areas-sel{ grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:6px; margin:-2px 0 10px; }
    .tab-chip{ padding:5px 10px; border-radius:10px; font-size:11px; }
    .tab-col{ height:160px; gap:12px; padding-top:30px; }
    .tab-col b{ font-size:12.5px; }
    .tab-col-pct{ font-style:normal; font-size:10.5px; font-weight:700; color:#9A8A90; margin-top:-4px; font-variant-numeric:tabular-nums; }
    .tab-col-et{ gap:12px; padding-top:6px; } .tab-col-et span{ font-size:10.5px; }
    .flj{ padding:2px 0 0; }
    .flj-montos, .flj-grid, .flj-riel, .flj-et{ display:grid; }
    .flj-montos b{ text-align:center; font:800 14px 'Montserrat',sans-serif; color:var(--c); font-variant-numeric:tabular-nums; }
    .flj-montos b.flj-cero{ color:#B9ADB2; font-weight:600; }
    .flj-barras{ position:relative; height:150px; margin-top:8px; border-bottom:2px solid #E4D6C8; }
    .flj-barras svg{ position:absolute; inset:0; width:100%; height:100%; }
    .flj-grid{ position:absolute; inset:0; }
    .flj-col{ display:flex; align-items:flex-end; justify-content:center; height:100%; }
    .flj-col i{ display:block; width:56%; height:var(--h); background:var(--c); border-radius:8px 8px 0 0; transform-origin:bottom; animation:fljCrece .9s cubic-bezier(.2,.9,.3,1) var(--d) both; transition:filter .15s; }
    .flj-col i:hover{ filter:brightness(1.15); }
    .flj-col i.vacia{ height:20px; background:none; border:2px dashed #CDB79A; border-bottom:0; animation:none; }
    @keyframes fljCrece{ from{ transform:scaleY(0); } to{ transform:scaleY(1); } }
    .flj-riel{ position:relative; margin-top:10px; }
    .flj-riel::before{ content:''; position:absolute; left:8.33%; right:8.33%; top:50%; height:2px; background:#E4D6C8; }
    .flj-riel div{ display:flex; justify-content:center; position:relative; }
    .flj-riel span{ display:grid; place-items:center; width:20px; height:20px; border-radius:50%; font:800 10px 'Montserrat',sans-serif; color:#fff; background:var(--c); border:2px solid var(--c); }
    .flj-riel span[data-activo="false"]{ background:#fff; color:var(--c); }
    .flj-et{ margin-top:8px; text-align:center; }
    .flj-et div{ display:flex; flex-direction:column; align-items:center; gap:4px; min-width:0; }
    .flj-et strong{ font:700 11px 'Montserrat',sans-serif; color:#2A1018; }
    .flj-et em{ padding:1px 7px; border-radius:999px; border:1.5px solid var(--c); color:var(--c); font:700 10px 'Montserrat',sans-serif; font-style:normal; font-variant-numeric:tabular-nums; }
    @media (max-height:720px){ .flj-barras{ height:110px; } }
    @media (prefers-reduced-motion:reduce){ .flj-col i{ animation:none; } }
    @media (max-height:720px){ .tab-col{ height:120px; } .tab-dona svg{ width:120px; height:120px; } .tab-kpi b{ font-size:19px; } }
`;

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
        stroke-dasharray="0 ${C}" data-largo="${Math.max(largo - sep, 0)}" data-c="${C}" stroke-dashoffset="${-acum}" transform="rotate(-90 100 100)"><title>${esc(p.t)}: ${num(p.v)}</title></circle>`;
      acum += largo; return a;
    }).join('');
    return `<svg viewBox="0 0 200 200" role="img" aria-label="Proporción de oficios por estatus">
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="#F3ECE4" stroke-width="30"/>${arcos}
      <text x="100" y="96" text-anchor="middle" font-family="Montserrat,sans-serif" font-size="30" font-weight="800" fill="#3D1420">${num(t.total)}</text>
      <text x="100" y="118" text-anchor="middle" font-family="Montserrat,sans-serif" font-size="11" font-weight="600" fill="#9A8A90">oficios</text>
    </svg>`;
  }

  function pintar(cuerpo, d) {
    const t = d.totales;
    // Porcentajes con 2 decimales que suman exactamente 100.00 (método del mayor residuo:
    // se reparten las centésimas que faltan a los que más se redondearon hacia abajo)
    const exactos = (() => {
      const vals = ESTADOS.map(e => t[e.k]);
      const resto = t.total - vals.reduce((a, b) => a + b, 0);
      if (resto > 0) vals.push(resto);
      if (!t.total) return new Map();
      const crudos = vals.map(v => v / t.total * 10000);
      const base = crudos.map(Math.floor);
      let faltan = 10000 - base.reduce((a, b) => a + b, 0);
      crudos.map((c, i) => [c - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (faltan > 0) { base[i]++; faltan--; } });
      const m = new Map();
      vals.forEach((v, i) => m.set(i, base[i] / 100));
      return m;
    })();
    const pct = (n, i) => (exactos.get(i) ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const otros = t.total - ESTADOS.reduce((s, e) => s + t[e.k], 0);
    const leyenda = [...ESTADOS.map(e => ({ t: e.t, c: e.c, c2: e.c2, v: t[e.k] })), ...(otros > 0 ? [{ t: OTROS.t, c: OTROS.c, v: otros }] : [])];

    // Derecha: gráfica de barras por estatus. C.A. elige el área (o todas); cada área ve la suya
    // Porcentajes exactos (2 decimales que suman 100.00) de una lista de cantidades
    const repartir = (lista, total) => {
      if (!total) return lista.map(() => 0);
      const crudos = lista.map(v => v / total * 10000), base = crudos.map(Math.floor);
      let faltan = 10000 - base.reduce((a, b) => a + b, 0);
      crudos.map((c, i) => [c - base[i], i]).sort((x, y) => y[0] - x[0]).forEach(([, i]) => { if (faltan > 0) { base[i]++; faltan--; } });
      return base.map(v => v / 100);
    };
    const fmtPct = (p) => p.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
    // Flujo de oficios por estatus (mismo estilo que Programas y Contratos)
    const barras = (o) => {
      const vals = ESTADOS.map(e => ({ t: e.t, c: e.c, v: o[e.k] }));
      const restoO = o.total - vals.reduce((a, l) => a + l.v, 0);
      const pcts = repartir([...vals.map(l => l.v), ...(restoO > 0 ? [restoO] : [])], o.total);
      const N = vals.length, H = 100, slot = 100, medio = slot * 0.28;
      const max = Math.max(...vals.map(l => l.v), 1);
      const alt = vals.map(l => l.v > 0 ? Math.max(l.v / max * H, 3) : 0);
      let listones = '';
      for (let i = 0; i < N - 1; i++) {
        if (!alt[i] && !alt[i + 1]) continue;
        const x1 = i * slot + slot / 2 + medio, x2 = (i + 1) * slot + slot / 2 - medio, xm = (x1 + x2) / 2;
        const y1 = H - alt[i], y2 = H - alt[i + 1];
        listones += `<path d="M ${x1} ${y1} C ${xm} ${y1}, ${xm} ${y2}, ${x2} ${y2} L ${x2} ${H} L ${x1} ${H} Z" fill="${vals[i].c}" opacity=".16"/>`;
      }
      const cols = `grid-template-columns:repeat(${N},1fr)`;
      return `<div class="flj">
        <div class="flj-montos" style="${cols}">${vals.map(l => l.v > 0 ? `<b style="--c:${l.c}" data-n="${l.v}">0</b>` : '<b class="flj-cero">0</b>').join('')}</div>
        <div class="flj-barras">
          <svg viewBox="0 0 ${N * slot} ${H}" preserveAspectRatio="none" aria-hidden="true">${listones}</svg>
          <div class="flj-grid" style="${cols}">${vals.map((l, i) => `<div class="flj-col">${alt[i] ? `<i style="--c:${l.c}; --h:${alt[i]}%; --d:${i * 80}ms" title="${esc(l.t)}: ${num(l.v)}"></i>` : '<i class="vacia"></i>'}</div>`).join('')}</div>
        </div>
        <div class="flj-riel" style="${cols}">${vals.map((l, i) => `<div><span style="--c:${l.c}" data-activo="${l.v > 0}">${i + 1}</span></div>`).join('')}</div>
        <div class="flj-et" style="${cols}">${vals.map((l, k) => `<div><strong>${esc(l.t)}</strong><em style="--c:${l.c}">${fmtPct(pcts[k])}</em></div>`).join('')}</div>
      </div>`;
    };
    const derecha = d.general && d.areas.length
      ? `<div class="tab-tarjeta"><h3>Oficios por área<small>elige un área para ver su gráfica</small></h3>
          <div class="tab-areas-sel" role="tablist" aria-label="Área">
            <button type="button" class="tab-chip activo" data-area="" role="tab" aria-selected="true"><span>Todas</span><b>${num(t.total)}</b></button>
            ${d.areas.map(a => `<button type="button" class="tab-chip" data-area="${esc(a.nombre)}" role="tab" aria-selected="false" title="${esc(a.nombre)}"><span>${esc(corto(a.nombre))}</span><b>${num(a.total)}</b></button>`).join('')}
          </div>
          <div class="tab-area-graf">${barras(t)}</div></div>`
      : `<div class="tab-tarjeta"><h3>Avance del área<small>oficios por estatus</small></h3><div class="tab-area-graf">${barras(t)}</div></div>`;

    cuerpo.innerHTML = `
      <div class="tab-kpis">
        <div class="tab-kpi total" style="--i:0"><span>Oficios totales</span><b data-n="${t.total}">0</b><small>${d.general ? 'en todas las áreas' : 'turnados a tu área'}</small></div>
        ${ESTADOS.map((e, i) => `<div class="tab-kpi" style="--c:${e.c}; --c2:${e.c2}; --i:${i + 1}"><span>${e.t}</span><b data-n="${t[e.k]}">0</b><small>${pct(t[e.k], i)}% del total</small></div>`).join('')}
      </div>
      <div class="tab-graficas">
        <div class="tab-tarjeta"><h3>Distribución<small>por estatus</small></h3>
          <div class="tab-dona">${dona(t)}
            <div class="tab-leyenda">${leyenda.map((l, i) => `<div><i style="--c:${l.c}"></i>${esc(l.t)}<b>${num(l.v)}</b><em>${pct(l.v, i)}%</em></div>`).join('')}</div>
          </div>
        </div>
        ${derecha}
      </div>`;
    animar(cuerpo);
    cuerpo.querySelectorAll('.tab-chip').forEach(b => b.addEventListener('click', () => {
      cuerpo.querySelectorAll('.tab-chip').forEach(x => { x.classList.toggle('activo', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      const a = b.dataset.area ? d.areas.find(x => x.nombre === b.dataset.area) : t;
      const graf = cuerpo.querySelector('.tab-area-graf');
      graf.innerHTML = barras(a);
      animar(graf);
    }));
  }

  /* Animaciones: cifras que cuentan, dona que se dibuja y barras que crecen */
  function animar(cuerpo) {
    const fin = () => {
      cuerpo.querySelectorAll('[data-n]').forEach(b => b.textContent = num(b.dataset.n));
      cuerpo.querySelectorAll('.seg').forEach(c => c.setAttribute('stroke-dasharray', `${c.dataset.largo} ${c.dataset.c}`));
      cuerpo.querySelectorAll('[data-w]').forEach(i => i.style.width = i.dataset.w);
      cuerpo.querySelectorAll('[data-h]').forEach(i => i.style.height = i.dataset.h);
    };
    if (quieto) return fin();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cuerpo.querySelectorAll('.seg').forEach(c => c.setAttribute('stroke-dasharray', `${c.dataset.largo} ${c.dataset.c}`));
      cuerpo.querySelectorAll('.tab-fila').forEach((f, k) => f.querySelectorAll('[data-w]').forEach(i => { i.style.transitionDelay = (k * 70) + 'ms'; i.style.width = i.dataset.w; }));
      cuerpo.querySelectorAll('[data-h]').forEach((i, k) => { i.style.transitionDelay = (k * 80) + 'ms'; i.style.height = i.dataset.h; });
    }));
    const inicio = performance.now(), dur = 1100;
    const cifras = [...cuerpo.querySelectorAll('[data-n]')];
    const paso = (ahora) => {
      const p = Math.min(1, (ahora - inicio) / dur), suave = 1 - Math.pow(1 - p, 3);
      cifras.forEach(b => b.textContent = num(Math.round(Number(b.dataset.n) * suave)));
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
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
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round">
      <path d="M5.5 19V13M10.5 19V8.5M15.5 19V11M20.5 19V5" stroke-width="2.6"/><path d="M3 21.2h20" stroke-width="1.3" opacity=".45"/></svg>`;
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
