/* ═══════════════════════════════════════════════════
   SBIS — Bandeja de Oficios (Área)
   El usuario de área ve los oficios turnados a su área.
   Puede sub-turnar a uno de sus usuarios (turnado → sub_turnado),
   o turnárselo a sí mismo para atenderlo directamente.
   ═══════════════════════════════════════════════════ */
const API = window.location.origin + '/api';

const BADGE = {
  turnado:     ['b-tur',       'Pendiente'],
  sub_turnado: ['b-sub',       'Sub-turnado'],
  atendido:    ['b-ate',       'Atendido'],
  rechazado:   ['b-rech',      'Por Corregir'],
  completado:  ['b-comp',      'Completado'],
};

/* Solo Coordinación Administrativa (o el admin legado) puede crear
   Nuevos Registros y consultar el Historial. Para las demás áreas,
   esas opciones de menú quedan ocultas y sus páginas son inaccesibles
   (ver historial.html/js/app.js y captura.html/js/captura.js). */
const AREA_CON_GESTION_COMPLETA = 'Coordinación Administrativa';
function tieneGestionCompleta(usuario) {
  return usuario?.rol === 'admin' ||
    (usuario?.rol === 'area' && usuario?.area === AREA_CON_GESTION_COMPLETA);
}

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
  if (USUARIO.rol === 'admin')         { window.location.href = '/historial.html'; return false; }
  if (USUARIO.rol === 'usuario_area')  { window.location.href = '/usuario.html';   return false; }

  pintarUsuarioHeader(USUARIO.username);
  aplicarMenuSegunPermiso();
  const elArea = document.getElementById('area-nombre');
  if (elArea) elArea.textContent = USUARIO.area || '';
  return true;
}

/* Oculta del menú las opciones de Historial y Nuevo Registro para
   cualquier usuario que no sea Coordinación Administrativa (ni el
   admin legado), dejando visible únicamente Bandeja de Oficios. */
function aplicarMenuSegunPermiso() {
  if (tieneGestionCompleta(USUARIO)) return;
  document.querySelectorAll('.menu-solo-gestion').forEach(el => el.remove());
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

/* ════════════════════════════════════════════════════
   SISTEMA DE MODALES (alert / confirm)
   ════════════════════════════════════════════════════ */
function sbisAlert({ titulo = 'Aviso', mensaje = '', btnOk = 'Aceptar', tipo = 'info', onClose = null } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('sbis-overlay');
    document.getElementById('sbis-title').textContent = titulo;
    document.getElementById('sbis-msg').textContent   = mensaje;
    const MAP = {
      success: ['ico-success', 'ti-circle-check',  'sbis-btn-success'],
      error:   ['ico-error',   'ti-alert-circle',  'sbis-btn-danger'],
      warning: ['ico-warning', 'ti-alert-triangle','sbis-btn-primary'],
      info:    ['ico-info',    'ti-info-circle',   'sbis-btn-primary'],
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

function sbisConfirm({ titulo = '¿Estás seguro?', mensaje = '', btnOk = 'Aceptar', btnCancel = 'Cancelar', tipo = 'confirm' } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('sbis-overlay');
    document.getElementById('sbis-title').textContent = titulo;
    document.getElementById('sbis-msg').textContent   = mensaje;
    const circle = document.getElementById('sbis-ico-circle');
    const ico    = document.getElementById('sbis-ico');
    circle.className = `ico-circle ${tipo === 'danger' ? 'ico-error' : 'ico-warning'}`;
    ico.className    = `ti ${tipo === 'danger' ? 'ti-trash' : 'ti-alert-triangle'}`;
    document.getElementById('sbis-btns').innerHTML = `
      <button class="sbis-btn sbis-btn-secondary" id="sbis-cancel">
        <i class="ti ti-x"></i> ${btnCancel}
      </button>
      <button class="sbis-btn ${tipo === 'danger' ? 'sbis-btn-danger' : 'sbis-btn-primary'}" id="sbis-ok">
        <i class="ti ${tipo === 'danger' ? 'ti-trash' : 'ti-check'}"></i> ${btnOk}
      </button>`;
    overlay.classList.add('visible');
    const cerrar = (val) => { overlay.classList.remove('visible'); resolve(val); };
    document.getElementById('sbis-ok').onclick     = () => cerrar(true);
    document.getElementById('sbis-cancel').onclick = () => cerrar(false);
    overlay.onclick = e => { if (e.target === overlay) cerrar(false); };
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
  const [cls, lbl] = BADGE[r.estatus] || ['b-tur', r.estatus];

  // Documentos del admin (solo lectura)
  const doc1HTML = r.ruta_doc1
    ? `<div class="doc-admin-card" onclick="verDoc('${r.ruta_doc1}')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${nombreVisibleDoc(r.ruta_doc1)}</span>
           <span class="doc-admin-meta">Documento recibido</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const doc2HTML = r.ruta_doc2
    ? `<div class="doc-admin-card" onclick="verDoc('${r.ruta_doc2}')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${nombreVisibleDoc(r.ruta_doc2)}</span>
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
           <span class="doc-admin-nombre">${nombreVisibleDoc(r.ruta_doc3)}</span>
           <span class="doc-admin-meta">Documento de respuesta</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const doc4HTML = r.ruta_doc4
    ? `<div class="doc-admin-card" onclick="verDoc('${r.ruta_doc4}')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${nombreVisibleDoc(r.ruta_doc4)}</span>
           <span class="doc-admin-meta">Documento de respuesta</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const docsRespuestaHTML = (doc3HTML || doc4HTML)
    ? `<p class="t-docs-titulo" style="margin-top:14px">Documentos de Respuesta</p>
       <div class="docs-admin-grid">${doc3HTML}${doc4HTML}</div>`
    : '';

  // ¿Este oficio está autoasignado al propio encargado de turnar que está viendo la bandeja?
  const esAutoasignado = r.usuario_asignado_id === USUARIO.id;

  // Chip de usuario asignado
  const usuarioAsignadoHTML = r.usuario_asignado_nombre
    ? `<div class="chip-usuario-asignado">
         <i class="ti ti-user-check"></i>
         Asignado a: <strong>${esAutoasignado ? `${r.usuario_asignado_nombre} (yo)` : r.usuario_asignado_nombre}</strong>
       </div>`
    : '';

  const enConteo    = ['turnado', 'sub_turnado'].includes(r.estatus);
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

  // Botones de acción para el área
  let botonesHTML = '';
  if (r.estatus === 'turnado') {
    botonesHTML = `
      <button class="btn-accion btn-subturnar" onclick="abrirSubturnar(${r.id})">
        <i class="ti ti-user-share"></i> Turnar / Atender
      </button>`;
  } else if (r.estatus === 'sub_turnado') {
    if (esAutoasignado) {
      // El propio encargado de turnar se autoasignó este oficio: puede
      // atenderlo directamente o reasignarlo a alguien más.
      botonesHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn-accion btn-atender" onclick="abrirAtender(${r.id})">
            <i class="ti ti-circle-check"></i> Atender Oficio
          </button>
          <button class="btn-accion btn-reasignar" onclick="abrirSubturnar(${r.id})">
            <i class="ti ti-user-swap"></i> Reasignar
          </button>
        </div>`;
    } else {
      botonesHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-size:11px;color:var(--txt2);font-weight:600;">
            <i class="ti ti-clock"></i> En atención por ${r.usuario_asignado_nombre || 'usuario asignado'}
          </span>
          <button class="btn-accion btn-reasignar" onclick="abrirSubturnar(${r.id})">
            <i class="ti ti-user-swap"></i> Reasignar
          </button>
        </div>`;
    }
  } else if (r.estatus === 'atendido') {
    botonesHTML = `<span style="font-size:11px;color:var(--txt2);font-weight:600;">
      <i class="ti ti-clock"></i> Esperando revisión de Administración
    </span>`;
  } else if (r.estatus === 'rechazado') {
    if (esAutoasignado) {
      botonesHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn-accion btn-atender" onclick="abrirAtender(${r.id})">
            <i class="ti ti-arrow-back-up"></i> Corregir y Reenviar
          </button>
          <button class="btn-accion btn-subturnar" onclick="abrirSubturnar(${r.id})">
            <i class="ti ti-user-share"></i> Re-asignar para Corrección
          </button>
        </div>`;
    } else {
      botonesHTML = `
        <button class="btn-accion btn-subturnar" onclick="abrirSubturnar(${r.id})">
          <i class="ti ti-user-share"></i> Re-asignar para Corrección
        </button>`;
    }
  } else if (r.estatus === 'completado') {
    botonesHTML = `<span style="font-size:11px;color:var(--verde-ok,#2e7d32);font-weight:600;">
      <i class="ti ti-circle-check"></i> Completado
    </span>`;
  }

  return `
  <div class="tarjeta ${claseExtra}" id="tarjeta-${i}">
    <div class="t-header" onclick="toggleTarjeta(${i})" role="button" aria-expanded="false">
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
        <span class="badge ${cls}">${lbl}</span>
      </div>
      <button class="btn-toggle" aria-label="Expandir">
        <i class="ti ti-chevron-down"></i>
      </button>
    </div>

    <div class="t-body" id="cuerpo-${i}">

      ${usuarioAsignadoHTML}

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
        <div class="t-extra-item">
          <span class="t-extra-label">Registrado el</span>
          <span class="t-extra-val">${formatFechaHora(r.created_at)}</span>
        </div>
      </div>

      <div class="t-docs-bloque">
        ${docsAdminHTML}
        ${docsRespuestaHTML}
      </div>

      <div class="t-inferior">
        <div class="obs-bloque">
          <span class="obs-label">Descripción del Asunto</span>
          <div class="obs-caja">${r.descripcion || '<span style="color:#aaa;font-style:italic;">Sin descripción</span>'}</div>
        </div>
        <div class="obs-bloque">
          <span class="obs-label">Observaciones del Área</span>
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
  const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
  if (btnLimpiar) btnLimpiar.style.display = 'none';
  cargarOficios(estatus);
}

/* Búsqueda en tiempo real sobre los datos ya cargados: N. Control,
   N. Referencia, remitente y también el Asunto (descripción). */
function buscar(texto) {
  const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
  if (btnLimpiar) btnLimpiar.style.display = texto.trim() ? 'flex' : 'none';
  const q = texto.trim().toLowerCase();
  if (!q) { renderLista(DATOS); return; }
  const filtrados = DATOS.filter(r =>
    (r.n_control || '').toLowerCase().includes(q) ||
    (r.n_referencia || '').toLowerCase().includes(q) ||
    (r.remitente || '').toLowerCase().includes(q) ||
    (r.descripcion || '').toLowerCase().includes(q)
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

function verDoc(ruta) {
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
   MODAL: SUB-TURNAR A USUARIO (o a sí mismo)
   ════════════════════════════════════════════════════ */
let subturnandoId = null;

async function abrirSubturnar(id) {
  subturnandoId = id;

  // Limpiar estado del modal
  document.getElementById('subturnar-error').textContent = '';
  document.getElementById('subturnar-select').innerHTML  =
    '<option value="">Cargando usuarios...</option>';
  document.getElementById('modal-subturnar').style.display = 'flex';

  // Cargar usuarios del área
  try {
    const res = await apiFetch(`${API}/usuarios/area/${encodeURIComponent(USUARIO.area)}`);
    if (!res.ok) throw new Error('No se pudieron cargar los usuarios.');
    const usuarios = await res.json();

    const select = document.getElementById('subturnar-select');
    const oficio = DATOS.find(o => o.id === id);

    // El encargado de turnar siempre puede turnárselo a sí mismo para
    // atenderlo directamente, sin depender de que existan usuarios
    // registrados en el área.
    const opcionYo = `<option class="opcion-yo-mismo" value="${USUARIO.id}" ${oficio?.usuario_asignado_id === USUARIO.id ? 'selected' : ''}>
          Yo mismo (${USUARIO.username}) — lo atenderé directamente
        </option>`;

    const opcionesUsuarios = usuarios.map(u =>
      `<option value="${u.id}" ${oficio?.usuario_asignado_id === u.id ? 'selected' : ''}>
          ${u.username}
        </option>`
    ).join('');

    select.innerHTML = '<option value="">— Selecciona una opción —</option>' + opcionYo + opcionesUsuarios;
  } catch (err) {
    // Aunque falle la carga de usuarios del área, se deja disponible
    // la opción de autoasignación para no bloquear al encargado de turnar.
    const oficio = DATOS.find(o => o.id === id);
    document.getElementById('subturnar-select').innerHTML =
      '<option value="">— Selecciona una opción —</option>' +
      `<option class="opcion-yo-mismo" value="${USUARIO.id}" ${oficio?.usuario_asignado_id === USUARIO.id ? 'selected' : ''}>
          Yo mismo (${USUARIO.username}) — lo atenderé directamente
        </option>`;
    document.getElementById('subturnar-error').textContent = err.message;
  }
}

function cerrarSubturnar() {
  document.getElementById('modal-subturnar').style.display = 'none';
  subturnandoId = null;
}

async function guardarSubturnar() {
  if (!subturnandoId) return;

  const errEl  = document.getElementById('subturnar-error');
  const select = document.getElementById('subturnar-select');
  errEl.textContent = '';

  const usuarioId = select.value;
  if (!usuarioId) {
    errEl.textContent = 'Debes seleccionar una opción.';
    return;
  }

  const btn = document.getElementById('subturnar-btn-guardar');
  btn.disabled  = true;
  btn.innerHTML = 'Guardando...';

  try {
    const fd = new FormData();
    fd.append('usuario_asignado_id', usuarioId);

    const res = await apiFetch(`${API}/oficios/${subturnandoId}`, {
      method: 'PUT',
      body:   fd
    });

    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.mensaje || 'No se pudo turnar el oficio.');
    }

    const meAutoasigne = Number(usuarioId) === USUARIO.id;

    cerrarSubturnar();
    cargarOficios(filtroActual);
    await sbisAlert({
      titulo:  meAutoasigne ? 'Oficio autoasignado' : 'Oficio sub-turnado',
      mensaje: meAutoasigne
        ? 'Te asignaste este oficio. Ya puedes atenderlo desde tu bandeja.'
        : 'El oficio fue asignado correctamente al usuario seleccionado.',
      tipo:    'success',
      btnOk:   'Aceptar'
    });
  } catch (err) {
    errEl.textContent = err.message || 'No se pudo turnar el oficio.';
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<i class="ti ti-user-share"></i> Confirmar Asignación';
  }
}

/* ════════════════════════════════════════════════════
   MODAL: ATENDER OFICIO (solo para oficios autoasignados)
   ════════════════════════════════════════════════════ */
let atendiendoId = null;

function abrirAtender(id) {
  atendiendoId = id;
  const r = DATOS.find(o => o.id === id);
  document.getElementById('atender-obs').value        = r?.obs_area || '';
  document.getElementById('atender-doc3').value        = '';
  document.getElementById('atender-doc4').value        = '';
  document.getElementById('nombre-doc3').textContent   = '';
  document.getElementById('nombre-doc4').textContent   = '';
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
  btn.disabled  = true;
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
    btn.disabled  = false;
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

  document.getElementById('modal-subturnar').addEventListener('click', function (e) {
    if (e.target === this) cerrarSubturnar();
  });
  document.getElementById('modal-atender').addEventListener('click', function (e) {
    if (e.target === this) cerrarAtender();
  });
});