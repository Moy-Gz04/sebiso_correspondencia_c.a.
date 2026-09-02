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

  if (!TOKEN || !USUARIO) { window.location.href = '/login'; return false; }
  if (USUARIO.rol === 'admin')  { window.location.href = '/historial'; return false; }
  if (USUARIO.rol === 'area')   { window.location.href = '/area';      return false; }

  pintarUsuarioHeader(USUARIO.username);
  const elArea = document.getElementById('area-nombre');
  if (elArea) elArea.textContent = USUARIO.area || '';
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
  window.location.href = '/login';
}

async function apiFetch(url, opciones = {}) {
  const res = await fetch(url, {
    ...opciones,
    headers: { ...opciones.headers, 'Authorization': `Bearer ${TOKEN}` }
  });
  if (res.status === 401) { cerrarSesion(); throw new Error('Sesión expirada'); }
  return res;
}

/* ── Usuarios Activos: heartbeat (ver nota en area.js) ── */
function iniciarHeartbeat() {
  apiFetch(`${API}/heartbeat`, { method: 'POST' }).catch(() => {});
  setInterval(() => apiFetch(`${API}/heartbeat`, { method: 'POST' }).catch(() => {}), 60000);
}

/* ── Usuarios Activos: badge discreto en el header con panel al pasar
   el cursor ──
   Se inyecta una sola vez el CSS del panel (inyectarEstilosUsuariosActivos)
   y luego, cada vez que se actualiza el contador, se repinta la lista
   de usuario + área/rol dentro del panel. El panel se muestra por CSS
   (:hover / :focus-within), sin depender del title nativo del navegador. */
function inyectarEstilosUsuariosActivos() {
  if (document.getElementById('estilos-usuarios-activos')) return;
  const style = document.createElement('style');
  style.id = 'estilos-usuarios-activos';
  style.textContent = `
    .badge-usuarios-activos {
      position: relative;
      display: flex; align-items: center; gap: 5px;
      color: #6b6b6b; font-size: 12.5px; font-weight: 600;
      font-family: 'Montserrat', sans-serif; white-space: nowrap;
      cursor: default; padding: 3px 6px; border-radius: 6px;
      transition: background .15s;
    }
    .badge-usuarios-activos:hover,
    .badge-usuarios-activos:focus-within { background: #f4eef0; }
    .badge-usuarios-activos:hover .panel-usuarios-activos,
    .badge-usuarios-activos:focus-within .panel-usuarios-activos {
      opacity: 1; visibility: visible; transform: translateY(0);
    }
    .panel-usuarios-activos {
      position: absolute; top: calc(100% + 8px); right: 0;
      min-width: 220px; max-width: 280px;
      background: #fff; border: 1px solid #e6dde1; border-radius: 10px;
      box-shadow: 0 10px 26px rgba(0,0,0,.14);
      padding: 10px 12px; z-index: 20000;
      opacity: 0; visibility: hidden; transform: translateY(-4px);
      transition: opacity .15s ease, transform .15s ease, visibility .15s;
      text-align: left; white-space: normal; cursor: default;
    }
    .panel-usuarios-activos-titulo {
      font-size: 10.5px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .5px; color: #999; margin-bottom: 7px;
    }
    .panel-usuarios-activos-lista {
      display: flex; flex-direction: column; gap: 6px;
      max-height: 190px; overflow-y: auto;
    }
    .panel-usuarios-activos-fila {
      display: flex; align-items: center; gap: 7px;
      font-size: 12px; color: #333;
    }
    .panel-usuarios-activos-nombre {
      font-weight: 600; color: #222;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .panel-usuarios-activos-area {
      color: #918a8d; font-size: 10.5px; margin-left: auto;
      text-align: right; flex-shrink: 0; max-width: 120px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .punto-activo {
      width: 6px; height: 6px; border-radius: 50%;
      background: #2e7d32; flex-shrink: 0;
    }
    .panel-usuarios-activos-vacio { font-size: 12px; color: #999; font-style: italic; }
  `;
  document.head.appendChild(style);
}

function pintarPanelUsuariosActivos(usuarios) {
  const listaEl = document.getElementById('lista-usuarios-activos');
  if (!listaEl) return;
  listaEl.innerHTML = usuarios.length
    ? usuarios.map(u => `
        <div class="panel-usuarios-activos-fila">
          <span class="punto-activo"></span>
          <span class="panel-usuarios-activos-nombre">${u.username}</span>
          <span class="panel-usuarios-activos-area">${u.area || (u.rol === 'admin' ? 'Administración' : u.rol)}</span>
        </div>`).join('')
    : '<span class="panel-usuarios-activos-vacio">Sin usuarios activos en este momento</span>';
}

function iniciarContadorUsuariosActivos() {
  inyectarEstilosUsuariosActivos();

  const badge = document.createElement('div');
  badge.id = 'badge-usuarios-activos';
  badge.className = 'badge-usuarios-activos';
  badge.tabIndex = 0;
  badge.innerHTML = `
    <span style="position:relative; display:inline-flex;">
      <i class="ti ti-users" style="font-size:17px; line-height:1;"></i>
      <span style="position:absolute; bottom:-1px; right:-2px; width:7px; height:7px;
                   background:#2e7d32; border:1.5px solid #fff; border-radius:50%;"></span>
    </span>
    <span id="txt-usuarios-activos">—</span>
    <div class="panel-usuarios-activos">
      <div class="panel-usuarios-activos-titulo">Usuarios activos</div>
      <div class="panel-usuarios-activos-lista" id="lista-usuarios-activos">
        <span class="panel-usuarios-activos-vacio">Cargando…</span>
      </div>
    </div>`;

  const headerDerecha = document.querySelector('.header-derecha');
  if (headerDerecha) headerDerecha.prepend(badge);

  const actualizar = async () => {
    try {
      const res  = await apiFetch(`${API}/usuarios-activos`);
      const data = await res.json();
      const txt  = document.getElementById('txt-usuarios-activos');
      if (txt) txt.textContent = data.total;
      pintarPanelUsuariosActivos(data.usuarios || []);
    } catch { /* silencioso */ }
  };

  actualizar();
  setInterval(actualizar, 30000);
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

  const doc1HTML = r.doc1
    ? `<div class="doc-admin-card" onclick="verDocSeguro(${r.id}, 'doc1')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${r.doc1.nombre}</span>
           <span class="doc-admin-meta">Documento recibido</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const doc2HTML = r.doc2
    ? `<div class="doc-admin-card" onclick="verDocSeguro(${r.id}, 'doc2')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${r.doc2.nombre}</span>
           <span class="doc-admin-meta">Documento recibido</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const docsAdminHTML = (doc1HTML || doc2HTML)
    ? `<p class="t-docs-titulo">Documentos del Oficio</p>
       <div class="docs-admin-grid">${doc1HTML}${doc2HTML}</div>`
    : '<span style="font-size:12.5px;color:#999;font-style:italic;display:flex;align-items:center;gap:6px;"><i class=\'ti ti-file-off\'></i> No se adjuntaron documentos al oficio</span>';

  const doc3HTML = r.doc3
    ? `<div class="doc-admin-card" onclick="verDocSeguro(${r.id}, 'doc3')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${r.doc3.nombre}</span>
           <span class="doc-admin-meta">Tu documento de respuesta</span>
         </div>
         <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
       </div>` : '';

  const doc4HTML = r.doc4
    ? `<div class="doc-admin-card" onclick="verDocSeguro(${r.id}, 'doc4')">
         <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
         <div class="doc-admin-info">
           <span class="doc-admin-nombre">${r.doc4.nombre}</span>
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
         <span class="obs-label" style="color:var(--alerta);">
           <i class="ti ti-alert-triangle"></i> Nota de corrección de Administración
         </span>
         <div class="nota-rechazo-box">${r.nota_rechazo}</div>
       </div>`
    : '';

  const enConteo    = r.estatus === 'sub_turnado';
  const tienePlazo    = enConteo && r.dias_entrega != null && r.dias_entrega > 0;
  const diasRestantes = tienePlazo ? (r.dias_entrega - (r.dias_transcurridos ?? 0)) : null;
  const esUrgente      = tienePlazo && diasRestantes <= 3;
  const claseExtra  = `${esUrgente ? 'tarjeta-urgente' : ''} ${r.estatus === 'rechazado' ? 'tarjeta-rechazada' : ''}`.trim();

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
        ${notaRechazoHTML}
        ${r.instrucciones_turno ? `
        <div class="obs-bloque" style="grid-column:1/-1;margin-bottom:14px;">
          <span class="obs-label"><i class="ti ti-clipboard-text"></i> Instrucción para Atender</span>
          <div class="obs-caja instruccion-turno-caja">${r.instrucciones_turno}</div>
        </div>` : ''}
        <div class="obs-bloque">
          <span class="obs-label">Descripción del Asunto</span>
          <div class="obs-caja">${r.descripcion || '<span style="color:#aaa;font-style:italic;">Sin descripción</span>'}</div>
        </div>
        <div class="obs-bloque">
          <span class="obs-label">Mis Observaciones</span>
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

/* Búsqueda en tiempo real: N. Control, N. Referencia, remitente y
   también el Asunto (descripción). */
function buscar(texto) {
  const btnL = document.getElementById('btn-limpiar-busqueda');
  if (btnL) btnL.style.display = texto.trim() ? 'flex' : 'none';
  const q = texto.trim().toLowerCase();
  if (!q) { renderLista(DATOS); return; }
  renderLista(DATOS.filter(r =>
    (r.n_control || '').toLowerCase().includes(q) ||
    (r.n_referencia || '').toLowerCase().includes(q) ||
    (r.remitente || '').toLowerCase().includes(q) ||
    (r.descripcion || '').toLowerCase().includes(q)
  ));
}

function limpiarBusqueda() {
  document.getElementById('buscador').value = '';
  const btnL = document.getElementById('btn-limpiar-busqueda');
  if (btnL) btnL.style.display = 'none';
  renderLista(DATOS);
}

/* ── Ver documento de forma segura ──
   Se pide un token de un solo uso y corta duración (3 min) al
   servidor, y se navega a ese enlace; la URL real del documento
   nunca viaja en las respuestas normales de la API. */
async function verDocSeguro(oficioId, slot) {
  const nuevaVentana = window.open('', '_blank');
  try {
    const res = await apiFetch(`${API}/oficios/${oficioId}/doc-token/${slot}`);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.mensaje || 'No se pudo abrir el documento.');
    }
    const { url } = await res.json();
    if (nuevaVentana) nuevaVentana.location.href = url;
    else window.open(url, '_blank', 'noopener');
  } catch (err) {
    if (nuevaVentana) nuevaVentana.close();
    await sbisAlert({ titulo: 'Error', mensaje: err.message || 'No se pudo abrir el documento.', tipo: 'error' });
  }
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
   MODAL: ATENDER OFICIO

   El documento de Turno (doc3) puede haber llegado ya adjunto desde
   el sub-turnado (si el encargado de turnar que asignó el oficio lo
   subió ahí): en ese caso aquí solo se puede visualizar, y este
   usuario únicamente sube el Seguimiento (doc4). Si nadie lo ha
   subido todavía, se pide aquí mismo y es obligatorio para poder
   marcar el oficio como atendido.
   ════════════════════════════════════════════════════ */
let atendiendoId = null;

function abrirAtender(id) {
  atendiendoId = id;
  const r = DATOS.find(o => o.id === id);
  document.getElementById('atender-obs').value        = r?.obs_area || '';
  document.getElementById('atender-doc4').value        = '';
  document.getElementById('nombre-doc4').textContent   = '';
  document.getElementById('atender-error').textContent = '';

  const slot = document.getElementById('atender-doc3-slot');
  if (slot) {
    if (r?.doc3) {
      slot.innerHTML = `
        <div class="doc-admin-card doc-solo-vista" onclick="verDocSeguro(${id}, 'doc3')">
          <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
          <div class="doc-admin-info">
            <span class="doc-admin-nombre">${r.doc3.nombre}</span>
            <span class="doc-admin-meta">Turno — ya adjunto, clic para ver</span>
          </div>
          <div class="doc-admin-abrir"><i class="ti ti-external-link"></i></div>
        </div>`;
    } else {
      slot.innerHTML = `
        <div class="archivo-drop">
          <input type="file" id="atender-doc3" accept=".pdf,.doc,.docx,image/*" onchange="mostrarNombreArchivo(this,'nombre-doc3')"/>
          <i class="ti ti-file-upload"></i>
          <div class="archivo-drop-label">Turno <span class="archivo-drop-req">*</span></div>
          <div class="archivo-drop-desc">Oficio recepcionado sin atención</div>
          <div class="archivo-drop-nombre" id="nombre-doc3"></div>
        </div>`;
    }
  }

  const infoInstruccion = document.getElementById('atender-instruccion');
  if (infoInstruccion) {
    if (r?.instrucciones_turno) {
      infoInstruccion.style.display = 'flex';
      infoInstruccion.querySelector('span').textContent = r.instrucciones_turno;
    } else {
      infoInstruccion.style.display = 'none';
    }
  }
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

  const r         = DATOS.find(o => o.id === atendiendoId);
  const doc3Input = document.getElementById('atender-doc3'); // no existe si el doc3 ya venía adjunto
  const doc3File  = doc3Input?.files?.[0];

  // Si nadie subió el documento de Turno todavía, es obligatorio subirlo
  // ahora para poder marcar el oficio como atendido.
  if (!r?.doc3 && !doc3File) {
    errEl.textContent = 'Debes adjuntar el documento de Turno para poder atender este oficio.';
    return;
  }

  const btn = document.getElementById('atender-btn-guardar');
  btn.disabled = true;
  btn.innerHTML = 'Guardando...';

  try {
    const fd = new FormData();
    fd.append('estatus',  'atendido');
    fd.append('obs_area', document.getElementById('atender-obs').value || '');
    const doc4 = document.getElementById('atender-doc4').files?.[0];
    if (doc3File) fd.append('doc3', doc3File);
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
  iniciarHeartbeat();
  iniciarContadorUsuariosActivos();
  document.getElementById('modal-atender').addEventListener('click', function (e) {
    if (e.target === this) cerrarAtender();
  });
});

/* ── Romper el acceso vía botón "Atrás" tras cerrar sesión ──
   Ver la nota equivalente en app.js: si el navegador restaura esta
   página desde bfcache, se revalida el token guardado antes de dejar
   nada visible. */
window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) {
    if (!iniciarSesion()) return;
    cargarOficios(filtroActual);
  }
});