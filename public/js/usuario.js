/* ═══════════════════════════════════════════════════
   SBIS — Bandeja Personal (Usuario de Área)
   El usuario solo ve los oficios que su área le asignó.
   Puede agregar observaciones, subir docs y marcar atendido.
   ═══════════════════════════════════════════════════ */
const API = window.location.origin + '/api';

const BADGE = {
  sub_turnado: ['b-sub',  'Por Atender'],
  atendido:    ['b-ate',  'Atendido'],
  rechazado:   ['b-rech', 'Por Corregir'],
  completado:  ['b-comp', 'Completado'],
};

let DATOS        = [];
let filtroActual = 'todos';
let TOKEN        = null;
let USUARIO      = null;

/* ════════════════════════════════════════════════════
   SESIÓN
   ════════════════════════════════════════════════════ */
function iniciarSesion() {
  TOKEN   = localStorage.getItem('sbis_token');
  const u = localStorage.getItem('sbis_usuario');
  USUARIO = u ? JSON.parse(u) : null;

  if (!TOKEN || !USUARIO) { window.location.href = '/login.html'; return false; }
  if (USUARIO.rol === 'admin')  { window.location.href = '/historial.html'; return false; }
  if (USUARIO.rol === 'area')   { window.location.href = '/area.html';      return false; }

  const elUser = document.getElementById('header-usuario');
  if (elUser) elUser.textContent = `👤 ${USUARIO.username}`;
  const elArea = document.getElementById('area-nombre');
  if (elArea) elArea.textContent = USUARIO.area || '';
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

/* ════════════════════════════════════════════════════
   MODALES GENÉRICOS
   ════════════════════════════════════════════════════ */
function sbisAlert({ titulo = 'Aviso', mensaje = '', btnOk = 'Aceptar', tipo = 'info', onClose = null } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('sbis-overlay');
    document.getElementById('sbis-title').textContent = titulo;
    document.getElementById('sbis-msg').textContent   = mensaje;
    const MAP = {
      success: ['ico-success', 'ti-circle-check',   'sbis-btn-success'],
      error:   ['ico-error',   'ti-alert-circle',   'sbis-btn-danger'],
      warning: ['ico-warning', 'ti-alert-triangle', 'sbis-btn-primary'],
      info:    ['ico-info',    'ti-info-circle',    'sbis-btn-primary'],
    };
    const [cls, icoName, btnCls] = MAP[tipo] || MAP.info;
    document.getElementById('sbis-ico-circle').className = `ico-circle ${cls}`;
    document.getElementById('sbis-ico').className        = `ti ${icoName}`;
    document.getElementById('sbis-btns').innerHTML = `
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

/* ════════════════════════════════════════════════════
   CARGA Y RENDER
   ════════════════════════════════════════════════════ */
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

function construirTarjeta(r, i) {
  const [cls, lbl] = BADGE[r.estatus] || ['b-sub', r.estatus];

  const doc1HTML = r.ruta_doc1
    ? `<div class="doc-admin-card" onclick="verDoc('${r.ruta_doc1}')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${r.ruta_doc1.replace(/^\d+_/, '')}</span>
           <span class="doc-admin-meta">Documento recibido</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const doc2HTML = r.ruta_doc2
    ? `<div class="doc-admin-card" onclick="verDoc('${r.ruta_doc2}')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${r.ruta_doc2.replace(/^\d+_/, '')}</span>
           <span class="doc-admin-meta">Documento recibido</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const docsAdminHTML = (doc1HTML || doc2HTML)
    ? `<p class="t-docs-titulo">Documentos del Oficio</p>
       <div class="docs-admin-grid">${doc1HTML}${doc2HTML}</div>`
    : '<span style="font-size:12.5px;color:#999;font-style:italic;display:flex;align-items:center;gap:6px;"><i class=\'ti ti-file-off\'></i> No se adjuntaron documentos al oficio</span>';

  const doc3HTML = r.ruta_doc3
    ? `<div class="doc-admin-card" onclick="verDoc('${r.ruta_doc3}')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${r.ruta_doc3.replace(/^\d+_/, '')}</span>
           <span class="doc-admin-meta">Tu documento de respuesta</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const doc4HTML = r.ruta_doc4
    ? `<div class="doc-admin-card" onclick="verDoc('${r.ruta_doc4}')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${r.ruta_doc4.replace(/^\d+_/, '')}</span>
           <span class="doc-admin-meta">Tu documento de respuesta</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const docsRespuestaHTML = (doc3HTML || doc4HTML)
    ? `<p class="t-docs-titulo" style="margin-top:14px">Tus Documentos de Respuesta</p>
       <div class="docs-admin-grid">${doc3HTML}${doc4HTML}</div>`
    : '';

  const notaRechazoHTML = (r.estatus === 'rechazado' && r.nota_rechazo)
    ? `<div class="obs-bloque" style="grid-column:1/-1;margin-bottom:14px;">
         <span class="obs-label" style="color:#c62828;">
           <i class="ti ti-alert-triangle"></i> Nota de corrección de Administración
         </span>
         <div class="nota-rechazo-box">${r.nota_rechazo}</div>
       </div>`
    : '';

  const enConteo    = r.estatus === 'sub_turnado';
  const diasMostrar = enConteo ? (r.dias_transcurridos ?? r.dias_entrega ?? 0) : null;
  const esUrgente   = enConteo && r.dias_entrega != null && r.dias_entrega <= 3;
  const claseExtra  = `${esUrgente ? 'tarjeta-urgente' : ''} ${r.estatus === 'rechazado' ? 'tarjeta-rechazada' : ''}`.trim();

  let botonesHTML = '';
  if (r.estatus === 'sub_turnado') {
    botonesHTML = `
      <button class="btn-accion btn-atender" onclick="abrirAtender(${r.id})">
        <i class="ti ti-circle-check"></i> Atender Oficio
      </button>`;
  } else if (r.estatus === 'rechazado') {
    botonesHTML = `
      <button class="btn-accion btn-atender" onclick="abrirAtender(${r.id})">
        <i class="ti ti-arrow-back-up"></i> Corregir y Reenviar
      </button>`;
  } else if (r.estatus === 'atendido') {
    botonesHTML = `<span style="font-size:11px;color:var(--txt2);font-weight:600;">
      <i class="ti ti-clock"></i> Esperando revisión de Administración
    </span>`;
  } else if (r.estatus === 'completado') {
    botonesHTML = `<span style="font-size:11px;color:var(--verde-ok,#2e7d32);font-weight:600;">
      <i class="ti ti-circle-check"></i> Completado
    </span>`;
  }

  return `
  <div class="tarjeta ${claseExtra}" id="tarjeta-${i}">
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
        <span class="th-label">F. Oficio</span>
        <span class="th-val">${formatFecha(r.f_oficio)}</span>
      </div>
      <div class="th-bloque">
        <span class="th-label">Días</span>
        <span class="th-val" style="${esUrgente ? 'color:#c62828;font-weight:700;' : ''}">
          ${enConteo
            ? (diasMostrar === 0 ? '<span style="color:#c62828;font-weight:700;">¡Hoy!</span>'
              : diasMostrar + ' día' + (diasMostrar !== 1 ? 's' : '') + (esUrgente ? ' 🔴' : ''))
            : '—'}
        </span>
      </div>
      <div class="th-bloque">
        <span class="th-label">Estatus</span>
        <span class="badge ${cls}">${lbl}</span>
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
          <span class="t-extra-label">Instrucción</span>
          <span class="t-extra-val">${r.instruccion || '—'}</span>
        </div>
        <div class="t-extra-item">
          <span class="t-extra-label">Folio Despacho</span>
          <span class="t-extra-val">${r.folio_despacho || '—'}</span>
        </div>
      </div>

      <div class="t-docs-bloque">
        ${docsAdminHTML}
        ${docsRespuestaHTML}
      </div>

      <div class="t-inferior">
        ${notaRechazoHTML}
        <div class="obs-bloque">
          <span class="obs-label">Descripción del Asunto</span>
          <div class="obs-caja">${r.descripcion || '<span style="color:#aaa;font-style:italic;">Sin descripción</span>'}</div>
        </div>
        <div class="obs-bloque">
          <span class="obs-label">Observaciones</span>
          <div class="obs-caja">${r.obs_area || '<span style="color:#aaa;font-style:italic;">Aún no hay observaciones</span>'}</div>
        </div>
        <div class="acciones-col">
          <span class="acc-titulo">Acciones</span>
          ${botonesHTML}
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
  const btnL = document.getElementById('btn-limpiar-busqueda');
  if (btnL) btnL.style.display = 'none';
  cargarOficios(estatus);
}

function buscar(texto) {
  const btnL = document.getElementById('btn-limpiar-busqueda');
  if (btnL) btnL.style.display = texto.trim() ? 'flex' : 'none';
  const q = texto.trim().toLowerCase();
  if (!q) { renderLista(DATOS); return; }
  renderLista(DATOS.filter(r =>
    (r.n_control || '').toLowerCase().includes(q) ||
    (r.remitente || '').toLowerCase().includes(q)
  ));
}

function limpiarBusqueda() {
  document.getElementById('buscador').value = '';
  const btnL = document.getElementById('btn-limpiar-busqueda');
  if (btnL) btnL.style.display = 'none';
  renderLista(DATOS);
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
   MODAL: ATENDER OFICIO
   ════════════════════════════════════════════════════ */
let atendiendoId = null;

function abrirAtender(id) {
  atendiendoId = id;
  const r = DATOS.find(o => o.id === id);
  document.getElementById('atender-obs').value        = r?.obs_area || '';
  document.getElementById('atender-doc3').value       = '';
  document.getElementById('atender-doc4').value       = '';
  document.getElementById('nombre-doc3').textContent  = '';
  document.getElementById('nombre-doc4').textContent  = '';
  document.getElementById('atender-error').textContent = '';
  document.getElementById('modal-atender').style.display = 'flex';
}

function cerrarAtender() {
  document.getElementById('modal-atender').style.display = 'none';
  atendiendoId = null;
}

function mostrarNombreArchivo(input, idDestino) {
  document.getElementById(idDestino).textContent = input.files?.[0]?.name || '';
}

async function guardarAtencion() {
  if (!atendiendoId) return;
  const errEl = document.getElementById('atender-error');
  errEl.textContent = '';
  const btn = document.getElementById('atender-btn-guardar');
  btn.disabled = true;
  btn.innerHTML = 'Guardando...';

  try {
    const fd = new FormData();
    fd.append('estatus',  'atendido');
    fd.append('obs_area', document.getElementById('atender-obs').value || '');
    const doc3 = document.getElementById('atender-doc3').files?.[0];
    const doc4 = document.getElementById('atender-doc4').files?.[0];
    if (doc3) fd.append('doc3', doc3);
    if (doc4) fd.append('doc4', doc4);

    const res = await apiFetch(`${API}/oficios/${atendiendoId}`, { method: 'PUT', body: fd });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.mensaje || 'No se pudo guardar.');
    }
    cerrarAtender();
    cargarOficios(filtroActual);
    await sbisAlert({
      titulo:  'Oficio atendido',
      mensaje: 'Se notificó a Administración para su revisión.',
      tipo:    'success',
      btnOk:   'Aceptar'
    });
  } catch (err) {
    errEl.textContent = err.message || 'No se pudo guardar.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-circle-check"></i> Marcar como Atendido';
  }
}

/* ════════════════════════════════════════════════════
   INICIO
   ════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  if (!iniciarSesion()) return;
  mostrarFecha();
  cargarOficios();
  document.getElementById('modal-atender').addEventListener('click', function (e) {
    if (e.target === this) cerrarAtender();
  });
});