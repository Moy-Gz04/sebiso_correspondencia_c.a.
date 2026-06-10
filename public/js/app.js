/* ═══════════════════════════════════════════════════
   SBIS — Historial de Oficios (Admin)
   ═══════════════════════════════════════════════════ */
const API = 'http://localhost:3000/api';

const BADGE = {
  turnado:    ['b-tur',  'Turnado'],
  atendido:   ['b-ate',  'Atendido'],
  completado: ['b-comp', 'Completado'],
};

let DATOS        = [];
let filtroActual = 'todos';
let TOKEN        = null;
let USUARIO      = null;

/* ════════════════════════════════════════════════════
   SISTEMA DE MODALES GENÉRICO
   ════════════════════════════════════════════════════ */

/* Inyecta el HTML del sistema de modales una sola vez */
function inyectarModales() {
  if (document.getElementById('sbis-modal-root')) return;
  const div = document.createElement('div');
  div.id = 'sbis-modal-root';
  div.innerHTML = `
    <style>
      /* ── Overlay ── */
      .sbis-overlay {
        display: none;
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.48);
        z-index: 10000;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .sbis-overlay.visible { display: flex; }

      /* ── Caja ── */
      .sbis-modal {
        background: #fff;
        border-radius: 10px;
        width: 100%; max-width: 400px;
        box-shadow: 0 12px 48px rgba(107,15,43,0.22);
        font-family: 'Source Sans 3', sans-serif;
        overflow: hidden;
        animation: sbisSlide .18s ease;
      }
      @keyframes sbisSlide {
        from { transform: translateY(-18px); opacity: 0; }
        to   { transform: translateY(0);     opacity: 1; }
      }

      /* ── Icono superior ── */
      .sbis-modal-icon {
        display: flex; align-items: center; justify-content: center;
        padding: 28px 0 16px;
      }
      .sbis-modal-icon .ico-circle {
        width: 58px; height: 58px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 26px;
      }
      .ico-confirm  { background: #fff3e0; color: #e65100; }
      .ico-success  { background: #e8f5e9; color: #2e7d32; }
      .ico-error    { background: #fce4ec; color: #c62828; }
      .ico-info     { background: #e3f2fd; color: #1565c0; }
      .ico-warning  { background: #fff8e1; color: #f57f17; }

      /* ── Texto ── */
      .sbis-modal-body { padding: 0 28px 20px; text-align: center; }
      .sbis-modal-title {
        font-family: 'Crimson Pro', serif;
        font-size: 1.35rem; font-weight: 700;
        color: #1a1a1a; margin: 0 0 8px;
      }
      .sbis-modal-msg {
        font-size: 0.92rem; color: #555;
        line-height: 1.5; margin: 0;
      }

      /* ── Botones ── */
      .sbis-modal-btns {
        padding: 0 20px 22px;
        display: flex; gap: 10px; justify-content: center;
      }
      .sbis-btn {
        padding: 10px 26px; border-radius: 6px;
        font-size: 13.5px; font-weight: 600;
        font-family: 'Source Sans 3', sans-serif;
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

    <!-- Modal de confirmación / alerta / éxito / error -->
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

/**
 * Modal de confirmación. Devuelve Promise<boolean>.
 * tipo: 'confirm' | 'danger'
 */
function sbisConfirm({
  titulo  = '¿Estás seguro?',
  mensaje = '',
  btnOk   = 'Aceptar',
  btnCancel = 'Cancelar',
  tipo    = 'confirm'           /* 'confirm' | 'danger' */
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

/**
 * Modal de notificación (sin cancelar).
 * tipo: 'success' | 'error' | 'info' | 'warning'
 */
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
  if (USUARIO.rol !== 'admin') { window.location.href = '/area.html'; return false; }

  const elUser = document.getElementById('header-usuario');
  if (elUser) elUser.textContent = `👤 ${USUARIO.username}`;
  return true;
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
    const url = estatus === 'todos' ? `${API}/oficios` : `${API}/oficios?estatus=${estatus}`;
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
         <i class="ti ti-file-type-pdf"></i> ${r.ruta_doc1.replace(/^\d+_/, '')}
       </button>`
    : null;

  const doc2HTML = r.ruta_doc2
    ? `<button class="btn-doc" onclick="verDoc('${r.ruta_doc2}')">
         <i class="ti ti-file-type-pdf"></i> ${r.ruta_doc2.replace(/^\d+_/, '')}
       </button>`
    : null;

  const docsAdminHTML = (doc1HTML || doc2HTML)
    ? (doc1HTML || '') + (doc2HTML || '')
    : '<span style="font-size:12.5px;color:#999;font-style:italic;display:flex;align-items:center;gap:6px;"><i class=\'ti ti-file-off\'></i> No se proporcionaron archivos al momento de registrar</span>';

  const doc3HTML = r.ruta_doc3
    ? `<div class="doc-area-card" onclick="verDoc('${r.ruta_doc3}')">
         <div class="doc-area-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-area-info">
           <span class="doc-area-nombre">${r.ruta_doc3.replace(/^\d+_/, '')}</span>
           <span class="doc-area-meta">Documento del área</span>
         </div>
         <div class="doc-area-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const doc4HTML = r.ruta_doc4
    ? `<div class="doc-area-card" onclick="verDoc('${r.ruta_doc4}')">
         <div class="doc-area-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-area-info">
           <span class="doc-area-nombre">${r.ruta_doc4.replace(/^\d+_/, '')}</span>
           <span class="doc-area-meta">Documento del área</span>
         </div>
         <div class="doc-area-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const docsAreaHTML = (doc3HTML || doc4HTML)
    ? `<p class="t-docs-titulo" style="margin-top:14px">Documentos del Área</p>
       <div class="docs-area-grid">${doc3HTML}${doc4HTML}</div>`
    : '';

  let botonesHTML = '';
  if (r.estatus === 'atendido') {
    botonesHTML = `
      <button class="btn-accion btn-enviar" onclick="reenviar(${r.id})">
        <i class="ti ti-refresh"></i> Reenviar
      </button>
      <button class="btn-accion btn-finalizar" onclick="finalizar(${r.id})">
        <i class="ti ti-circle-check"></i> Finalizar
      </button>`;
  } else if (r.estatus === 'completado') {
    botonesHTML = `<span style="font-size:11px;color:var(--verde-ok);font-weight:600;">
      <i class="ti ti-circle-check"></i> Completado
    </span>`;
  } else {
    botonesHTML = `<span style="font-size:11px;color:var(--txt2);">
      <i class="ti ti-clock"></i> Pendiente de área
    </span>`;
  }

  /* Días transcurridos desde creación (solo si turnado) */
  const diasMostrar = r.estatus === 'turnado' ? (r.dias_transcurridos ?? r.dias_entrega ?? 0) : null;

  /* Urgente: dias_entrega <= 3 Y sigue en turnado (sin atender aún) */
  const esUrgente = r.estatus === 'turnado' && r.dias_entrega != null && r.dias_entrega <= 3;

  return `
  <div class="tarjeta ${esUrgente ? 'tarjeta-urgente' : ''}" id="tarjeta-${i}">
    ${esUrgente ? `<div class="urgente-banner"><i class="ti ti-alert-triangle"></i> PRIORIDAD ALTA — ${diasMostrar === 0 ? '¡Vence hoy!' : `Atender en ${diasMostrar} día${diasMostrar !== 1 ? 's' : ''}`}</div>` : ''}
    <div class="t-header" onclick="toggleTarjeta(${i})" role="button" aria-expanded="false">
      <div class="th-bloque">
        <span class="th-label">N. Control</span>
        <span class="th-val mono">${r.n_control}</span>
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
        <span class="th-val" style="${esUrgente ? 'color:#c62828;font-weight:700;' : ''}">
          ${r.estatus === 'turnado'
            ? (diasMostrar === 0 ? '<span style="color:#c62828;font-weight:700;">¡Hoy!</span>'
              : diasMostrar + ' día' + (diasMostrar !== 1 ? 's' : '') + (esUrgente ? ' 🔴' : ''))
            : '—'}
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
            font-family: 'Source Sans 3', sans-serif;
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
  /* Limpiar búsqueda al cambiar chip */
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

/* ── Reenviar ── */
async function reenviar(id) {
  const ok = await sbisConfirm({
    titulo:  'Reenviar oficio',
    mensaje: '¿Reenviar este oficio al área? Volverá a aparecer como pendiente.',
    btnOk:   'Reenviar',
    tipo:    'confirm'
  });
  if (!ok) return;
  try {
    const res = await apiFetch(`${API}/oficios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estatus: 'turnado' })
    });
    if (res.ok) {
      await sbisAlert({ titulo: 'Reenviado', mensaje: 'El oficio fue reenviado al área correctamente.', tipo: 'success', btnOk: 'Aceptar' });
      cargarOficios(filtroActual);
    } else {
      const d = await res.json();
      await sbisAlert({ titulo: 'Error', mensaje: d.mensaje || 'No se pudo reenviar.', tipo: 'error' });
    }
  } catch (err) {
    await sbisAlert({ titulo: 'Error de conexión', mensaje: err.message, tipo: 'error' });
  }
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
  window.open(`${API.replace('/api', '')}/uploads/${ruta}`, '_blank');
}

function formatFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
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

document.addEventListener('DOMContentLoaded', () => {
  if (!iniciarSesion()) return;
  inyectarModales();
  mostrarFecha();
  cargarOficios();

  document.getElementById('modal-editar').addEventListener('click', function(e) {
    if (e.target === this) cerrarEditar();
  });
});