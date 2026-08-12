/* ═══════════════════════════════════════════════════
   SBIS — Historial de Oficios (Admin)
   Flujo: por_turnar → turnado → atendido → completado
                                    ↳ rechazado (con nota) → atendido
   ═══════════════════════════════════════════════════ */
const API = window.location.origin + '/api';

const BADGE = {
  por_turnar: ['b-portu', 'Por Turnar'],
  turnado:    ['b-tur',   'Turnado'],
  atendido:   ['b-ate',   'Atendido'],
  rechazado:  ['b-rech',  'Rechazado'],
  completado: ['b-comp',  'Completado'],
};

let DATOS        = [];
let filtroActual = 'todos';
let TOKEN        = null;
let USUARIO      = null;
let SELECCION    = []; // ids de oficios seleccionados, en orden de selección (máx. 4)
let SELECCION_PDF = []; // ids de PDFs generados seleccionados para eliminación masiva

/* ════════════════════════════════════════════════════
   SISTEMA DE MODALES GENÉRICO
   ════════════════════════════════════════════════════ */
function inyectarModales() {
  if (document.getElementById('sbis-modal-root')) return;
  const div = document.createElement('div');
  div.id = 'sbis-modal-root';
  div.innerHTML = `
    <style>
      .sbis-overlay {
        display: none;
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.48);
        backdrop-filter: blur(2px);
        z-index: 10000;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .sbis-overlay.visible { display: flex; }
      .sbis-modal {
        background: #fff;
        border-radius: 14px;
        width: 100%; max-width: 400px;
        font-family: 'Montserrat', sans-serif;
        overflow: hidden;
        animation: sbisSlide .22s cubic-bezier(.22,1,.36,1);
      }
      @keyframes sbisSlide {
        from { transform: translateY(-18px) scale(.97); opacity: 0; }
        to   { transform: translateY(0)     scale(1);   opacity: 1; }
      }
      .sbis-modal-icon {
        display: flex; align-items: center; justify-content: center;
        padding: 28px 0 16px;
      }
      .sbis-modal-icon .ico-circle {
        width: 58px; height: 58px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 26px;
        box-shadow: 0 4px 12px rgba(0,0,0,.12);
      }
      .ico-confirm  { background: #fff3e0; color: #e65100; }
      .ico-success  { background: #e8f5e9; color: #2e7d32; }
      .ico-error    { background: #fce4ec; color: #c62828; }
      .ico-info     { background: #e3f2fd; color: #1565c0; }
      .ico-warning  { background: #fff8e1; color: #f57f17; }
      .sbis-modal-body { padding: 0 28px 20px; text-align: center; }
      .sbis-modal-title {
        font-family: 'Montserrat', sans-serif;
        font-size: 1.35rem; font-weight: 700;
        color: #1a1a1a; margin: 0 0 8px;
      }
      .sbis-modal-msg {
        font-size: 0.92rem; color: #555;
        line-height: 1.5; margin: 0;
      }
      .sbis-modal-btns {
        padding: 0 20px 22px;
        display: flex; gap: 10px; justify-content: center;
      }
      .sbis-btn {
        padding: 10px 26px; border-radius: 999px;
        font-size: 13.5px; font-weight: 600;
        font-family: 'Montserrat', sans-serif;
        cursor: pointer; border: none;
        display: inline-flex; align-items: center; gap: 7px;
        transition: background .18s, transform .1s;
      }
      .sbis-btn:active { transform: scale(.97); }
      .sbis-btn-primary   { background: #6B0F2B; color: #fff; }
      .sbis-btn-primary:hover { background: #8B1535; }
      .sbis-btn-danger    { background: #c62828; color: #fff; }
      .sbis-btn-danger:hover  { background: #b71c1c; }
      .sbis-btn-secondary { background: #eeeeee; color: #333; }
      .sbis-btn-secondary:hover { background: #e0e0e0; }
      .sbis-btn-success   { background: #2e7d32; color: #fff; }
      .sbis-btn-success:hover { background: #1b5e20; }
    </style>

    <div class="sbis-overlay" id="sbis-overlay">
      <div class="sbis-modal" id="sbis-modal">
        <div class="sbis-modal-icon">
          <div class="ico-circle" id="sbis-ico-circle">
            <i id="sbis-ico" class="ti ti-alert-triangle"></i>
          </div>
        </div>
        <div class="sbis-modal-body">
          <p class="sbis-modal-title" id="sbis-title">Título</p>
          <p class="sbis-modal-msg"   id="sbis-msg">Mensaje</p>
        </div>
        <div class="sbis-modal-btns" id="sbis-btns"></div>
      </div>
    </div>
  `;
  document.body.appendChild(div);
}

function sbisConfirm({
  titulo  = '¿Estás seguro?',
  mensaje = '',
  btnOk   = 'Aceptar',
  btnCancel = 'Cancelar',
  tipo    = 'confirm'
} = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('sbis-overlay');
    document.getElementById('sbis-title').textContent = titulo;
    document.getElementById('sbis-msg').textContent   = mensaje;

    const circle = document.getElementById('sbis-ico-circle');
    const ico    = document.getElementById('sbis-ico');
    circle.className = `ico-circle ${tipo === 'danger' ? 'ico-error' : 'ico-warning'}`;
    ico.className    = `ti ${tipo === 'danger' ? 'ti-trash' : 'ti-alert-triangle'}`;

    const btns = document.getElementById('sbis-btns');
    btns.innerHTML = `
      <button class="sbis-btn sbis-btn-secondary" id="sbis-cancel">
        <i class="ti ti-x"></i> ${btnCancel}
      </button>
      <button class="sbis-btn ${tipo === 'danger' ? 'sbis-btn-danger' : 'sbis-btn-primary'}" id="sbis-ok">
        <i class="ti ${tipo === 'danger' ? 'ti-trash' : 'ti-check'}"></i> ${btnOk}
      </button>`;

    overlay.classList.add('visible');

    const cerrar = (val) => {
      overlay.classList.remove('visible');
      resolve(val);
    };
    document.getElementById('sbis-ok').onclick     = () => cerrar(true);
    document.getElementById('sbis-cancel').onclick = () => cerrar(false);
    overlay.onclick = e => { if (e.target === overlay) cerrar(false); };
  });
}

function sbisAlert({
  titulo  = 'Aviso',
  mensaje = '',
  btnOk   = 'Aceptar',
  tipo    = 'info',
  onClose = null
} = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('sbis-overlay');
    document.getElementById('sbis-title').textContent = titulo;
    document.getElementById('sbis-msg').textContent   = mensaje;

    const circle = document.getElementById('sbis-ico-circle');
    const ico    = document.getElementById('sbis-ico');

    const MAP = {
      success: ['ico-success', 'ti-circle-check', 'sbis-btn-success'],
      error:   ['ico-error',   'ti-alert-circle',  'sbis-btn-danger'],
      warning: ['ico-warning', 'ti-alert-triangle','sbis-btn-primary'],
      info:    ['ico-info',    'ti-info-circle',   'sbis-btn-primary'],
    };
    const [cls, icoName, btnCls] = MAP[tipo] || MAP.info;
    circle.className = `ico-circle ${cls}`;
    ico.className    = `ti ${icoName}`;

    const btns = document.getElementById('sbis-btns');
    btns.innerHTML = `
      <button class="sbis-btn ${btnCls}" id="sbis-ok">
        <i class="ti ti-check"></i> ${btnOk}
      </button>`;

    overlay.classList.add('visible');

    const cerrar = () => {
      overlay.classList.remove('visible');
      if (onClose) onClose();
      resolve();
    };
    document.getElementById('sbis-ok').onclick = cerrar;
    overlay.onclick = e => { if (e.target === overlay) cerrar(); };
  });
}

/* ── Sesión ── */
function iniciarSesion() {
  TOKEN   = localStorage.getItem('sbis_token');
  const u = localStorage.getItem('sbis_usuario');
  USUARIO = u ? JSON.parse(u) : null;

  if (!TOKEN || !USUARIO) { window.location.href = '/login.html'; return false; }
  if (USUARIO.rol !== 'admin' && USUARIO.rol !== 'area') { window.location.href = '/area.html'; return false; }
  const navBandeja = document.getElementById('nav-bandeja');
  if (navBandeja && USUARIO.rol === 'area') navBandeja.style.display = '';

  pintarUsuarioHeader(USUARIO.username);
  return true;
}

/* Icono elegante en vez de emoji para el usuario del header */
function pintarUsuarioHeader(username) {
  const elUser = document.getElementById('header-usuario');
  if (!elUser) return;
  elUser.innerHTML = `<span class="ico-usuario"><i class="ti ti-user-circle"></i></span><span>${username}</span>`;
}

function cerrarSesion() {
  localStorage.removeItem('sbis_token');
  localStorage.removeItem('sbis_usuario');
  window.location.href = '/login.html';
}

async function apiFetch(url, opciones = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: { ...opciones.headers, 'Authorization': `Bearer ${TOKEN}` }
  });
  if (res.status === 401) { cerrarSesion(); throw new Error('Sesión expirada'); }
  return res;
}

/* ── Cargar oficios ── */
async function cargarOficios(estatus = 'todos') {
  const lista = document.getElementById('lista');
  lista.innerHTML = `<div class="cargando-msg">
    <i class="ti ti-loader-2 spin"></i> Cargando registros...
  </div>`;

  try {
    const params = new URLSearchParams();
    if (estatus !== 'todos') params.set('estatus', estatus);
    // En Historial, un "área" ve SU PROPIO historial (lo que ella creó),
    // no lo que otras áreas le turnaron a ella (eso vive en area.html).
    if (USUARIO?.rol === 'area') params.set('origen', 'mio');
    const qs  = params.toString();
    const url = `${API}/oficios${qs ? '?' + qs : ''}`;
    const res = await apiFetch(url);
    if (!res.ok) throw new Error();
    DATOS = await res.json();
    renderLista(DATOS);
  } catch {
    lista.innerHTML = `<div class="cargando-msg error">
      <i class="ti ti-alert-circle"></i> No se pudo conectar con el servidor.
    </div>`;
  }
}

/* ── Render ── */
function construirTarjeta(r, i) {
  const [cls, lbl] = BADGE[r.estatus] || ['b-tur', 'Turnado'];

  const badgeHTML = r.turnado_a
    ? `<span class="badge ${cls}">${lbl}</span>
       <span style="font-size:10px;color:var(--txt2);margin-top:2px;">→ ${r.turnado_a}</span>`
    : `<span class="badge ${cls}">${lbl}</span>`;

  const doc1HTML = r.ruta_doc1
    ? `<button class="btn-doc" onclick="verDoc('${r.ruta_doc1}')">
         <i class="ti ti-file-type-pdf"></i> ${nombreVisibleDoc(r.ruta_doc1)}
       </button>`
    : null;

  const doc2HTML = r.ruta_doc2
    ? `<button class="btn-doc" onclick="verDoc('${r.ruta_doc2}')">
         <i class="ti ti-file-type-pdf"></i> ${nombreVisibleDoc(r.ruta_doc2)}
       </button>`
    : null;

  const docsAdminHTML = (doc1HTML || doc2HTML)
    ? (doc1HTML || '') + (doc2HTML || '')
    : '<span style="font-size:12.5px;color:#999;font-style:italic;display:flex;align-items:center;gap:6px;"><i class=\'ti ti-file-off\'></i> No se proporcionaron archivos al momento de registrar</span>';

  const doc3HTML = r.ruta_doc3
    ? `<div class="doc-area-card" onclick="verDoc('${r.ruta_doc3}')">
         <div class="doc-area-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-area-info">
           <span class="doc-area-nombre">${nombreVisibleDoc(r.ruta_doc3)}</span>
           <span class="doc-area-meta">Documento del área</span>
         </div>
         <div class="doc-area-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const doc4HTML = r.ruta_doc4
    ? `<div class="doc-area-card" onclick="verDoc('${r.ruta_doc4}')">
         <div class="doc-area-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-area-info">
           <span class="doc-area-nombre">${nombreVisibleDoc(r.ruta_doc4)}</span>
           <span class="doc-area-meta">Documento del área</span>
         </div>
         <div class="doc-area-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const docsAreaHTML = (doc3HTML || doc4HTML)
    ? `<p class="t-docs-titulo" style="margin-top:14px">Documentos del Área</p>
       <div class="docs-area-grid">${doc3HTML}${doc4HTML}</div>`
    : '';

  /* Nota de rechazo enviada al área (visible también para admin como referencia) */
  const notaRechazoHTML = (r.estatus === 'rechazado' && r.nota_rechazo)
    ? `<div class="obs-bloque" style="grid-column:1/-1;margin-bottom:14px;">
         <span class="obs-label" style="color:var(--alerta);">
           <i class="ti ti-alert-triangle"></i> Nota de corrección enviada al área
         </span>
         <div class="nota-rechazo-box">${r.nota_rechazo}</div>
       </div>`
    : '';

  let botonesHTML = '';
  if (r.estatus === 'por_turnar') {
    botonesHTML = `
      <button class="btn-accion btn-turnar" onclick="abrirTurnar(${r.id})">
        <i class="ti ti-arrow-forward"></i> Turnar a Área
      </button>`;
  } else if (r.estatus === 'atendido') {
    botonesHTML = `
      <button class="btn-accion btn-enviar" onclick="abrirRechazar(${r.id})">
        <i class="ti ti-arrow-back-up"></i> Rechazar
      </button>
      <button class="btn-accion btn-finalizar" onclick="finalizar(${r.id})">
        <i class="ti ti-circle-check"></i> Finalizar
      </button>`;
  } else if (r.estatus === 'completado') {
    botonesHTML = `<span style="font-size:11px;color:var(--verde-ok);font-weight:600;">
      <i class="ti ti-circle-check"></i> Completado
    </span>`;
  } else if (r.estatus === 'rechazado') {
    botonesHTML = `<span style="font-size:11px;color:var(--alerta);font-weight:600;">
      <i class="ti ti-clock"></i> Esperando corrección del área
    </span>`;
  } else {
    botonesHTML = `<span style="font-size:11px;color:var(--txt2);">
      <i class="ti ti-clock"></i> Pendiente de área
    </span>`;
  }

  /* Días transcurridos desde creación (turnado o por_turnar) */
  const enConteo   = (r.estatus === 'turnado' || r.estatus === 'por_turnar');
  /* dias_entrega: 0 o null = "No aplica" (sin plazo). Si tiene plazo,
     se muestran los días RESTANTES (plazo - transcurridos), no los
     transcurridos — antes se mostraban mal como si fueran lo mismo. */
  const tienePlazo    = enConteo && r.dias_entrega != null && r.dias_entrega > 0;
  const diasRestantes = tienePlazo ? (r.dias_entrega - (r.dias_transcurridos ?? 0)) : null;
  const esUrgente      = tienePlazo && diasRestantes <= 3;

  const textoVencimiento = diasRestantes == null ? '—'
    : diasRestantes < 0
      ? `<span style="color:var(--alerta);font-weight:700;">Vencido (${Math.abs(diasRestantes)} día${Math.abs(diasRestantes) !== 1 ? 's' : ''} tarde) 🔴</span>`
    : diasRestantes === 0
      ? '<span style="color:var(--alerta);font-weight:700;">¡Hoy!</span>'
      : diasRestantes + ' día' + (diasRestantes !== 1 ? 's' : '') + (esUrgente ? ' 🔴' : '');

  const bannerTexto = diasRestantes == null ? ''
    : diasRestantes < 0 ? `Vencido desde hace ${Math.abs(diasRestantes)} día${Math.abs(diasRestantes) !== 1 ? 's' : ''}`
    : diasRestantes === 0 ? '¡Vence hoy!'
    : `Atender en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}`;

  const claseExtra = `${esUrgente ? 'tarjeta-urgente' : ''} ${r.estatus === 'rechazado' ? 'tarjeta-rechazada' : ''}`.trim();

  return `
  <div class="tarjeta ${claseExtra}" id="tarjeta-${i}">
    <div class="t-header-row" onclick="toggleTarjeta(${i})" role="button" aria-expanded="false">
      <label class="th-check" onclick="event.stopPropagation();" title="Seleccionar para generar PDF">
        <input type="checkbox" data-oficio-id="${r.id}" onchange="toggleSeleccion(${r.id}, this)"/>
      </label>
      <div class="t-header">
      <div class="th-bloque">
        <span class="th-label">N. Control</span>
        <span class="th-val mono">${r.n_control}</span>
        ${esUrgente ? `<span class="tag-prioridad"><i class="ti ti-clock"></i> ${bannerTexto}</span>` : ''}
      </div>
      <div class="th-bloque th-remitente">
        <span class="th-label">Remitente / Dependencia</span>
        <span class="th-val">${r.remitente || '—'}</span>
        <span class="th-val muted">${r.dependencia || ''}</span>
      </div>
      <div class="th-bloque">
        <span class="th-label">F. Sello</span>
        <span class="th-val">${formatFecha(r.f_sello)}</span>
      </div>
      <div class="th-bloque">
        <span class="th-label">F. Oficio</span>
        <span class="th-val">${formatFecha(r.f_oficio)}</span>
      </div>
      <div class="th-bloque">
        <span class="th-label">Días</span>
        <span class="th-val" style="${esUrgente ? 'color:var(--alerta);font-weight:700;' : ''}">
          ${textoVencimiento}
        </span>
      </div>
      <div class="th-bloque">
        <span class="th-label">Estatus</span>
        <div style="display:flex;flex-direction:column;gap:2px;">${badgeHTML}</div>
      </div>
      <button class="btn-toggle" aria-label="Expandir">
        <i class="ti ti-chevron-down"></i>
      </button>
      </div>
    </div>

    <div class="t-body" id="cuerpo-${i}">
      <div class="t-extra">
        <div class="t-extra-item">
          <span class="t-extra-label">N. Referencia</span>
          <span class="t-extra-val">${r.n_referencia || '—'}</span>
        </div>
        <div class="t-extra-item">
          <span class="t-extra-label">Turnado a</span>
          <span class="t-extra-val" style="font-weight:600;color:var(--guinda)">
            ${r.turnado_a || '—'}
          </span>
        </div>
        <div class="t-extra-item">
          <span class="t-extra-label">F. Registro</span>
          <span class="t-extra-val">${formatFecha(r.f_registro)}</span>
        </div>
        <div class="t-extra-item">
          <span class="t-extra-label">Registrado el</span>
          <span class="t-extra-val">${formatFechaHora(r.created_at)}</span>
        </div>
        <div class="t-extra-item">
          <span class="t-extra-label">Hora Recibido</span>
          <span class="t-extra-val">${r.hora_recibido || '—'}</span>
        </div>
        <div class="t-extra-item">
          <span class="t-extra-label">Folio Despacho</span>
          <span class="t-extra-val">${r.folio_despacho || '—'}</span>
        </div>
        <div class="t-extra-item t-extra-instruccion">
          <span class="t-extra-label">Instrucción</span>
          <span class="t-extra-val">${r.instruccion || '—'}</span>
        </div>
      </div>

      <div class="t-docs-bloque">
        <p class="t-docs-titulo">Documentos adjuntos</p>
        <div class="t-docs">${docsAdminHTML}</div>
        ${docsAreaHTML}
      </div>

      <div class="t-inferior">
        ${notaRechazoHTML}
        <div class="obs-bloque">
          <span class="obs-label">Descripción del Asunto</span>
          <div style="
            background: var(--fondo-par, #faf5f7);
            border: 0.5px solid var(--borde, #e8d8de);
            border-radius: 5px;
            padding: 10px 12px;
            font-size: 13px;
            color: #333;
            line-height: 1.55;
            min-height: 60px;
            font-family: 'Montserrat', sans-serif;
          ">${r.descripcion || '<span style="color:#aaa;font-style:italic;">Sin descripción</span>'}</div>
        </div>
        <div class="obs-bloque">
          <span class="obs-label">Observaciones Administración</span>
          <textarea class="obs-area" placeholder="Observaciones administración..."
            onblur="guardarObs(${r.id}, this.value)">${r.obs_admin || ''}</textarea>
        </div>
        <div class="acciones-col">
          <span class="acc-titulo">Acciones</span>
          ${botonesHTML}
          <button class="btn-accion btn-editar" onclick="abrirEditar(${r.id}); event.stopPropagation();">
            <i class="ti ti-edit"></i> Editar
          </button>
          <button class="btn-accion btn-eliminar" onclick="eliminar(${r.id}); event.stopPropagation();">
            <i class="ti ti-trash"></i> Eliminar
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderLista(lista) {
  const el = document.getElementById('lista');
  el.innerHTML = lista.length
    ? lista.map((r, i) => construirTarjeta(r, i)).join('')
    : '<div class="cargando-msg">No hay registros con ese filtro.</div>';
  document.getElementById('tot').textContent = lista.length;
  document.getElementById('pie-txt').textContent =
    `Mostrando 1–${lista.length} de ${lista.length} registros`;
  actualizarBarraSeleccion(); // conserva la selección al cambiar de filtro/búsqueda
}

/* ── Toggle tarjeta ── */
function toggleTarjeta(i) {
  const t = document.getElementById(`tarjeta-${i}`);
  const a = t.classList.toggle('abierta');
  t.querySelector('.t-header').setAttribute('aria-expanded', a);
}

function filtrar(btn, estatus) {
  document.querySelectorAll('.chip').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  filtroActual = estatus;
  const buscador = document.getElementById('buscador');
  if (buscador) buscador.value = '';
  const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
  if (btnLimpiar) btnLimpiar.style.display = 'none';
  cargarOficios(estatus);
}

/* ── Búsqueda en tiempo real (filtra sobre DATOS ya cargados) ── */
function buscar(texto) {
  const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
  if (btnLimpiar) btnLimpiar.style.display = texto.trim() ? 'flex' : 'none';

  const q = texto.trim().toLowerCase();
  if (!q) { renderLista(DATOS); return; }

  const filtrados = DATOS.filter(r =>
    (r.n_control   || '').toLowerCase().includes(q) ||
    (r.n_referencia|| '').toLowerCase().includes(q) ||
    (r.turnado_a   || '').toLowerCase().includes(q) ||
    (r.remitente   || '').toLowerCase().includes(q) ||
    (r.dependencia || '').toLowerCase().includes(q)
  );
  renderLista(filtrados);
}

function limpiarBusqueda() {
  const buscador = document.getElementById('buscador');
  if (buscador) buscador.value = '';
  const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
  if (btnLimpiar) btnLimpiar.style.display = 'none';
  renderLista(DATOS);
}

async function guardarObs(id, valor) {
  try {
    await apiFetch(`${API}/oficios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obs_admin: valor })
    });
  } catch (err) { console.error('[guardarObs]', err); }
}

/* ── Finalizar ── */
async function finalizar(id) {
  const ok = await sbisConfirm({
    titulo:  'Finalizar oficio',
    mensaje: '¿Marcar este oficio como Completado? Esta acción es definitiva.',
    btnOk:   'Finalizar',
    tipo:    'confirm'
  });
  if (!ok) return;
  try {
    const res = await apiFetch(`${API}/oficios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estatus: 'completado' })
    });
    if (res.ok) {
      await sbisAlert({ titulo: 'Completado', mensaje: 'El oficio fue marcado como completado.', tipo: 'success', btnOk: 'Aceptar' });
      cargarOficios(filtroActual);
    } else {
      const d = await res.json();
      await sbisAlert({ titulo: 'Error', mensaje: d.mensaje || 'No se pudo finalizar.', tipo: 'error' });
    }
  } catch (err) {
    await sbisAlert({ titulo: 'Error de conexión', mensaje: err.message, tipo: 'error' });
  }
}

/* ── Eliminar ── */
async function eliminar(id) {
  const ok = await sbisConfirm({
    titulo:   'Eliminar oficio',
    mensaje:  'Esta acción no se puede deshacer. ¿Confirmas eliminar este registro?',
    btnOk:    'Eliminar',
    btnCancel:'Cancelar',
    tipo:     'danger'
  });
  if (!ok) return;
  try {
    const res = await apiFetch(`${API}/oficios/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await sbisAlert({ titulo: 'Eliminado', mensaje: 'El registro fue eliminado correctamente.', tipo: 'success', btnOk: 'Aceptar' });
      cargarOficios(filtroActual);
    } else {
      const d = await res.json();
      await sbisAlert({ titulo: 'Error', mensaje: d.mensaje || 'No se pudo eliminar.', tipo: 'error' });
    }
  } catch (err) {
    await sbisAlert({ titulo: 'Error de conexión', mensaje: err.message, tipo: 'error' });
  }
}

function verDoc(ruta) {
  // Archivos nuevos: ya es un link completo de Drive → se abre directo.
  // Archivos viejos (antes de la migración a Drive): ruta local heredada.
  if (/^https?:\/\//i.test(ruta)) {
    window.open(ruta, '_blank');
  } else {
    window.open(`${API.replace('/api', '')}/uploads/${ruta}`, '_blank');
  }
}

function nombreVisibleDoc(ruta) {
  if (!ruta) return '';
  if (/^https?:\/\//i.test(ruta)) return 'Ver documento';
  return ruta.replace(/^\d+_/, '');
}

function formatFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}

/* Fecha + hora de un timestamp (ej. created_at), en horario de México */
function formatFechaHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const fecha = d.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora  = d.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: true });
  return `${fecha} — ${hora}`;
}

function mostrarFecha() {
  const el = document.getElementById('header-fecha');
  if (!el) return;
  const txt = new Date().toLocaleDateString('es-MX',
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  el.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
}

/* ════════════════════════════════════════════════════
   MODAL DE EDICIÓN
   ════════════════════════════════════════════════════ */
let editandoId = null;

function abrirEditar(id) {
  const r = DATOS.find(o => o.id === id);
  if (!r) return;
  editandoId = id;

  document.getElementById('edit-f-oficio').value      = r.f_oficio?.split('T')[0] || '';
  document.getElementById('edit-f-sello').value       = r.f_sello?.split('T')[0]  || '';
  document.getElementById('edit-remitente').value     = r.remitente    || '';
  document.getElementById('edit-dependencia').value   = r.dependencia  || '';
  document.getElementById('edit-numero').value        = r.numero       || '';
  document.getElementById('edit-n-referencia').value  = r.n_referencia || '';
  document.getElementById('edit-instruccion').value   = r.instruccion  || '';
  document.getElementById('edit-folio').value         = r.folio_despacho || '';
  document.getElementById('edit-hora').value          = r.hora_recibido  || '';
  document.getElementById('edit-dias').value          = r.dias_entrega != null ? String(r.dias_entrega) : '';
  document.getElementById('edit-descripcion').value   = r.descripcion    || '';
  document.getElementById('edit-turnado').value       = r.turnado_a      || '';
  document.getElementById('edit-error').textContent   = '';

  document.getElementById('modal-editar').style.display = 'flex';
}

function cerrarEditar() {
  document.getElementById('modal-editar').style.display = 'none';
  editandoId = null;
}

async function guardarEdicion() {
  if (!editandoId) return;

  const fOficio   = document.getElementById('edit-f-oficio').value;
  const remitente = document.getElementById('edit-remitente').value.trim();
  const errEl     = document.getElementById('edit-error');

  if (!fOficio || !remitente) {
    errEl.textContent = 'F. Oficio y Remitente son obligatorios.';
    return;
  }
  errEl.textContent = '';

  const payload = {
    f_oficio:       document.getElementById('edit-f-oficio').value      || null,
    f_sello:        document.getElementById('edit-f-sello').value       || null,
    remitente:      document.getElementById('edit-remitente').value     || null,
    dependencia:    document.getElementById('edit-dependencia').value   || null,
    numero:         document.getElementById('edit-numero').value        || null,
    n_referencia:   document.getElementById('edit-n-referencia').value  || null,
    instruccion:    document.getElementById('edit-instruccion').value   || null,
    folio_despacho: document.getElementById('edit-folio').value         || null,
    hora_recibido:  document.getElementById('edit-hora').value          || null,
    dias_entrega:   document.getElementById('edit-dias').value ? Number(document.getElementById('edit-dias').value) : null,
    descripcion:    document.getElementById('edit-descripcion').value   || null,
    turnado_a:      document.getElementById('edit-turnado').value       || null,
  };

  const btnGuardar = document.getElementById('edit-btn-guardar');
  btnGuardar.disabled     = true;
  btnGuardar.textContent  = 'Guardando...';

  try {
    const res = await apiFetch(`${API}/oficios/${editandoId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.mensaje || 'Error al guardar');
    }
    cerrarEditar();
    cargarOficios(filtroActual);
    await sbisAlert({
      titulo:  'Cambios guardados',
      mensaje: 'El registro fue actualizado correctamente.',
      tipo:    'success',
      btnOk:   'Aceptar'
    });
  } catch (err) {
    errEl.textContent = err.message || 'No se pudo guardar.';
    await sbisAlert({
      titulo:  'Error al guardar',
      mensaje: err.message || 'No se pudo actualizar el registro.',
      tipo:    'error'
    });
  } finally {
    btnGuardar.disabled    = false;
    btnGuardar.textContent = 'Guardar cambios';
  }
}

/* ════════════════════════════════════════════════════
   MODAL: TURNAR A ÁREA  (por_turnar → turnado)
   ════════════════════════════════════════════════════ */
let turnandoId = null;

function abrirTurnar(id) {
  turnandoId = id;
  document.getElementById('turnar-area').value  = '';
  document.getElementById('turnar-hora').value  = '';
  document.getElementById('turnar-error').textContent = '';
  document.getElementById('modal-turnar').style.display = 'flex';
}

function cerrarTurnar() {
  document.getElementById('modal-turnar').style.display = 'none';
  turnandoId = null;
}

async function guardarTurnado() {
  if (!turnandoId) return;

  const area  = document.getElementById('turnar-area').value;
  const hora  = document.getElementById('turnar-hora').value;
  const errEl = document.getElementById('turnar-error');

  if (!area) {
    errEl.textContent = 'Selecciona un área para turnar el oficio.';
    return;
  }
  errEl.textContent = '';

  const btn = document.getElementById('turnar-btn-guardar');
  btn.disabled    = true;
  btn.textContent = 'Turnando...';

  try {
    const res = await apiFetch(`${API}/oficios/${turnandoId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ estatus: 'turnado', turnado_a: area, hora_recibido: hora || null })
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.mensaje || 'No se pudo turnar el oficio.');
    }
    cerrarTurnar();
    cargarOficios(filtroActual);
    await sbisAlert({
      titulo:  'Oficio turnado',
      mensaje: `Turnado correctamente a: ${area}`,
      tipo:    'success',
      btnOk:   'Aceptar'
    });
  } catch (err) {
    errEl.textContent = err.message || 'No se pudo turnar el oficio.';
  } finally {
    btn.disabled    = false;
    btn.innerHTML   = '<i class="ti ti-arrow-forward"></i> Turnar';
  }
}

/* ════════════════════════════════════════════════════
   MODAL: RECHAZAR / SOLICITAR CORRECCIÓN (atendido → rechazado)
   ════════════════════════════════════════════════════ */
let rechazandoId = null;

function abrirRechazar(id) {
  rechazandoId = id;
  document.getElementById('rechazar-nota').value = '';
  document.getElementById('rechazar-error').textContent = '';
  document.getElementById('modal-rechazar').style.display = 'flex';
}

function cerrarRechazar() {
  document.getElementById('modal-rechazar').style.display = 'none';
  rechazandoId = null;
}

async function guardarRechazo() {
  if (!rechazandoId) return;

  const nota  = document.getElementById('rechazar-nota').value.trim();
  const errEl = document.getElementById('rechazar-error');

  if (!nota) {
    errEl.textContent = 'Describe el motivo de la corrección.';
    return;
  }
  errEl.textContent = '';

  const btn = document.getElementById('rechazar-btn-guardar');
  btn.disabled  = true;
  btn.innerHTML = 'Enviando...';

  try {
    const res = await apiFetch(`${API}/oficios/${rechazandoId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ estatus: 'rechazado', nota_rechazo: nota })
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.mensaje || 'No se pudo rechazar el oficio.');
    }
    cerrarRechazar();
    cargarOficios(filtroActual);
    await sbisAlert({
      titulo:  'Oficio rechazado',
      mensaje: 'Se notificó al área para que realice las correcciones indicadas.',
      tipo:    'warning',
      btnOk:   'Aceptar'
    });
  } catch (err) {
    errEl.textContent = err.message || 'No se pudo rechazar el oficio.';
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<i class="ti ti-arrow-back-up"></i> Rechazar y enviar nota';
  }
}

/* ════════════════════════════════════════════════════
   SELECCIÓN DE HASTA 4 REGISTROS → GENERAR PDF (Sheets)
   ════════════════════════════════════════════════════ */
function toggleSeleccion(id, checkbox) {
  if (checkbox.checked) {
    if (SELECCION.length >= 4) {
      checkbox.checked = false;
      sbisAlert({
        titulo:  'Máximo 4 registros',
        mensaje: 'Solo puedes seleccionar hasta 4 registros para generar el PDF.',
        tipo:    'warning'
      });
      return;
    }
    SELECCION.push(id);
  } else {
    SELECCION = SELECCION.filter(x => x !== id);
  }
  actualizarBarraSeleccion();
}

function actualizarBarraSeleccion() {
  const barra   = document.getElementById('barra-seleccion');
  const count   = document.getElementById('bs-count');
  const btnGen  = document.getElementById('bs-btn-generar');

  count.textContent = SELECCION.length;
  btnGen.disabled    = SELECCION.length === 0;
  barra.classList.toggle('visible', SELECCION.length > 0);

  // Marcar visualmente las tarjetas seleccionadas y deshabilitar checkboxes
  // cuando ya se alcanzó el máximo, para que no confunda al usuario.
  document.querySelectorAll('[data-oficio-id]').forEach(cb => {
    const id = Number(cb.getAttribute('data-oficio-id'));
    const marcado = SELECCION.includes(id);
    cb.checked = marcado;
    cb.disabled = !marcado && SELECCION.length >= 4;
    const tarjeta = cb.closest('.tarjeta');
    if (tarjeta) tarjeta.classList.toggle('seleccionada', marcado);
  });
}

function limpiarSeleccion() {
  SELECCION = [];
  actualizarBarraSeleccion();
}

async function generarPdfSeleccion() {
  if (!SELECCION.length) return;

  const btn = document.getElementById('bs-btn-generar');
  btn.disabled  = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Generando...';

  try {
    const res = await apiFetch(`${API}/oficios/generar-pdf`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids: SELECCION })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo generar el PDF.');

    agregarPdfAlPanel(data);
    limpiarSeleccion();

    await sbisAlert({
      titulo:  'PDF generado',
      mensaje: `Se generó correctamente el PDF con los N. de Control: ${data.folios.join(', ')}.`,
      tipo:    'success',
      btnOk:   'Aceptar'
    });
  } catch (err) {
    await sbisAlert({
      titulo:  'Error al generar PDF',
      mensaje: err.message || 'Ocurrió un error al generar el PDF.',
      tipo:    'error'
    });
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<i class="ti ti-file-type-pdf"></i> Generar PDF';
  }
}

/* ════════════════════════════════════════════════════
   PANEL DE PDFs GENERADOS (historial persistente)
   Selección múltiple + eliminación masiva, sin botón
   de eliminar por cada PDF individual.
   ════════════════════════════════════════════════════ */
async function cargarPdfsGenerados() {
  try {
    const res = await apiFetch(`${API}/pdfs-generados`);
    if (!res.ok) return;
    const rows = await res.json();
    const panel = document.getElementById('panel-pdfs');
    const lista = document.getElementById('panel-pdfs-lista');
    lista.innerHTML = '';
    SELECCION_PDF = [];
    rows.forEach(row => lista.appendChild(crearBotonPdf(row)));
    panel.classList.toggle('visible', rows.length > 0);
    actualizarPdfBarraSeleccion();
  } catch (err) {
    console.error('[cargarPdfsGenerados]', err);
  }
}

function crearBotonPdf(row) {
  const wrap = document.createElement('div');
  wrap.className = 'pdf-item';
  wrap.dataset.pdfId = row.id;

  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.className = 'pdf-chk';
  chk.title = 'Seleccionar este PDF';
  chk.addEventListener('change', () => togglePdfSeleccion(row.id, chk, wrap));

  const a = document.createElement('a');
  a.href = row.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.className = 'btn-ver-pdf';
  const controles = (row.folios || []).join(', ');
  a.innerHTML = `<i class="ti ti-eye"></i> Ver PDF N. Control ${controles}`;

  wrap.appendChild(chk);
  wrap.appendChild(a);
  return wrap;
}

function togglePdfSeleccion(id, checkbox, wrapEl) {
  if (checkbox.checked) {
    if (!SELECCION_PDF.includes(id)) SELECCION_PDF.push(id);
  } else {
    SELECCION_PDF = SELECCION_PDF.filter(x => x !== id);
  }
  wrapEl.classList.toggle('seleccionado', checkbox.checked);
  actualizarPdfBarraSeleccion();
}

function togglePdfSeleccionarTodos(checkboxTodos) {
  const marcar = checkboxTodos.checked;
  document.querySelectorAll('#panel-pdfs-lista .pdf-item').forEach(wrap => {
    const chk = wrap.querySelector('.pdf-chk');
    const id  = Number(wrap.dataset.pdfId);
    chk.checked = marcar;
    wrap.classList.toggle('seleccionado', marcar);
    if (marcar) {
      if (!SELECCION_PDF.includes(id)) SELECCION_PDF.push(id);
    }
  });
  if (!marcar) SELECCION_PDF = [];
  actualizarPdfBarraSeleccion();
}

function actualizarPdfBarraSeleccion() {
  const btn   = document.getElementById('btn-eliminar-pdfs-sel');
  const count = document.getElementById('pdf-sel-count');
  const chkTodos = document.getElementById('pdf-chk-todos');
  if (!btn || !count) return;

  count.textContent = SELECCION_PDF.length;
  btn.classList.toggle('visible', SELECCION_PDF.length > 0);

  const total = document.querySelectorAll('#panel-pdfs-lista .pdf-item').length;
  if (chkTodos) {
    chkTodos.checked = total > 0 && SELECCION_PDF.length === total;
    chkTodos.indeterminate = SELECCION_PDF.length > 0 && SELECCION_PDF.length < total;
  }
}

async function eliminarPdfsSeleccionados() {
  if (!SELECCION_PDF.length) return;

  const ok = await sbisConfirm({
    titulo:   `Eliminar ${SELECCION_PDF.length} PDF${SELECCION_PDF.length !== 1 ? 's' : ''}`,
    mensaje:  'Se eliminarán del sistema y, si es posible, también los archivos en Drive. Esta acción no se puede deshacer.',
    btnOk:    'Eliminar',
    btnCancel:'Cancelar',
    tipo:     'danger'
  });
  if (!ok) return;

  const btn = document.getElementById('btn-eliminar-pdfs-sel');
  btn.disabled  = true;
  const idsAEliminar = [...SELECCION_PDF];

  try {
    const resultados = await Promise.allSettled(
      idsAEliminar.map(id => apiFetch(`${API}/pdfs-generados/${id}`, { method: 'DELETE' }))
    );
    const fallidos = resultados.filter(r => r.status === 'rejected' || (r.value && !r.value.ok)).length;

    idsAEliminar.forEach(id => {
      const wrap = document.querySelector(`#panel-pdfs-lista .pdf-item[data-pdf-id="${id}"]`);
      if (wrap) wrap.remove();
    });
    SELECCION_PDF = [];

    const lista = document.getElementById('panel-pdfs-lista');
    const panel = document.getElementById('panel-pdfs');
    if (!lista.children.length) panel.classList.remove('visible');
    actualizarPdfBarraSeleccion();

    if (fallidos > 0) {
      await sbisAlert({ titulo: 'Eliminación parcial', mensaje: `${fallidos} PDF(s) no se pudieron eliminar.`, tipo: 'warning' });
    } else {
      await sbisAlert({ titulo: 'PDFs eliminados', mensaje: 'Los PDFs seleccionados se eliminaron correctamente.', tipo: 'success' });
    }
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message || 'No se pudieron eliminar los PDFs.', tipo: 'error' });
  } finally {
    btn.disabled = false;
  }
}

function agregarPdfAlPanel(row) {
  const panel = document.getElementById('panel-pdfs');
  const lista = document.getElementById('panel-pdfs-lista');
  lista.prepend(crearBotonPdf(row));
  panel.classList.add('visible');
  actualizarPdfBarraSeleccion();
}

document.addEventListener('DOMContentLoaded', () => {
  if (!iniciarSesion()) return;
  inyectarModales();
  mostrarFecha();
  cargarOficios();
  cargarPdfsGenerados();

  document.getElementById('modal-editar').addEventListener('click', function(e) {
    if (e.target === this) cerrarEditar();
  });
  document.getElementById('modal-turnar').addEventListener('click', function(e) {
    if (e.target === this) cerrarTurnar();
  });
  document.getElementById('modal-rechazar').addEventListener('click', function(e) {
    if (e.target === this) cerrarRechazar();
  });
});