/* ═══════════════════════════════════════════════════
   SBIS — Minutario
   Misma tabla que No. de Oficio; aquí solo se captura
   Fecha de Sello / Fecha de Firma / Nota por registro, con
   guardado automático al cambiar cada campo. Exclusivo de
   Coordinación Administrativa (o el admin legado).
   ═══════════════════════════════════════════════════ */

const API = window.location.origin + '/api';

let TOKEN   = localStorage.getItem('sbis_token');
let USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');

const AREA_CON_GESTION_COMPLETA = 'Coordinación Administrativa';
function tieneGestionCompleta(usuario) {
  return usuario?.rol === 'admin' ||
    (usuario?.rol === 'area' && usuario?.area === AREA_CON_GESTION_COMPLETA);
}

function verificarAcceso() {
  TOKEN   = localStorage.getItem('sbis_token');
  USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');

  if (!TOKEN || (USUARIO?.rol !== 'admin' && USUARIO?.rol !== 'area')) {
    window.location.href = '/login';
    return false;
  }
  if (!tieneGestionCompleta(USUARIO)) {
    window.location.href = '/area';
    return false;
  }
  return true;
}

function cerrarSesion() {
  localStorage.removeItem('sbis_token');
  localStorage.removeItem('sbis_usuario');
  window.location.href = '/login';
}

function pintarUsuarioHeader(username) {
  const el = document.getElementById('header-usuario');
  if (!el) return;
  el.innerHTML = `<span class="ico-usuario"><i class="ti ti-user-circle"></i></span><span>${username}</span>`;
}

function mostrarFecha() {
  const el = document.getElementById('header-fecha');
  if (!el) return;
  const txt = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  el.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
}

function iniciarHeartbeat() {
  const ping = () => fetch(`${API}/heartbeat`, { method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}` } }).catch(() => {});
  ping();
  setInterval(ping, 60000);
}

/* ── Modal genérico de aviso (solo para errores) ── */
function sbisAlert({ titulo = 'Aviso', mensaje = '', btnOk = 'Aceptar', tipo = 'info' } = {}) {
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
    const cerrar = () => { overlay.classList.remove('visible'); resolve(); };
    document.getElementById('sbis-ok').onclick = cerrar;
    overlay.onclick = e => { if (e.target === overlay) cerrar(); };
  });
}

/* ════════════════════════════════════════════════════
   Módulos disponibles dentro del submenú del Minutario.
   Cada uno tiene su propia tabla/API/consecutivo, pero
   comparten exactamente la misma mecánica de captura de
   sello, filtros y tabla — solo cambia de dónde se leen
   y a dónde se guardan los datos.
   ════════════════════════════════════════════════════ */
const MODULOS = {
  'no-oficio': {
    api: 'no-oficio',
    campoNumero: 'no_oficio',
    columna: 'No. Oficio',
    vacioMsg: 'Sin registros todavía. Créalos desde "No. de Oficio".',
  },
  'circular': {
    api: 'circular',
    campoNumero: 'no_circular',
    columna: 'No. Circular',
    vacioMsg: 'Sin registros todavía. Créalos desde "No. Circular".',
  },
  'tarjeta-informativa': {
    api: 'tarjeta-informativa',
    campoNumero: 'no_tarjeta',
    columna: 'No. Tarjeta Informativa',
    vacioMsg: 'Sin registros todavía. Créalos desde "No. Tarjeta Informativa".',
  },
};

let TIPO_ACTIVO = 'no-oficio';

function moduloActivo() {
  return MODULOS[TIPO_ACTIVO];
}

/* ════════════════════════════════════════════════════
   Datos
   ════════════════════════════════════════════════════ */
let REGISTROS = [];

/* Estado de los filtros (búsqueda + rango de fechas). Se aplican en
   conjunto sobre REGISTROS cada vez que se repinta la tabla. */
let FILTRO_TEXTO  = '';
let FILTRO_DESDE  = '';
let FILTRO_HASTA  = '';

function formatearFecha(f) {
  if (!f) return '';
  const d = new Date(f);
  if (isNaN(d.getTime())) return f;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function formatearHora(h) {
  if (!h) return '';
  return h.slice(0, 5);
}

/* Valor listo para un <input type="date"> / <input type="time">:
   a diferencia de formatearFecha/formatearHora (que son solo para
   mostrar texto), estos deben quedar en formato ISO (yyyy-mm-dd /
   HH:mm) para que el propio input los entienda. */
function valorFechaInput(f) {
  if (!f) return '';
  const d = new Date(f);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function valorHoraInput(h) {
  if (!h) return '';
  return h.slice(0, 5);
}

/* Alias de valorFechaInput usado también para comparar contra el
   rango de fechas del filtro (mismo formato ISO yyyy-mm-dd). */
function fechaISO(f) {
  return valorFechaInput(f);
}

/* Escapa el valor de una nota para poder insertarlo dentro del
   atributo value="" del input sin romper el HTML si el usuario
   escribió comillas, & o < / >. */
function escaparAtributo(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* Caché por tipo de módulo, así cambiar de pestaña no vuelve a pedir
   al servidor los datos que ya se cargaron en esta visita. */
const CACHE_REGISTROS = {};

function actualizarBadge(tipo, cantidad) {
  const el = document.getElementById(`tab-badge-${tipo}`);
  if (el) el.textContent = cantidad;
}

async function cargarModulo(tipo, { forzar = false } = {}) {
  if (CACHE_REGISTROS[tipo] && !forzar) return CACHE_REGISTROS[tipo];
  const cfg = MODULOS[tipo];
  const res = await fetch(`${API}/${cfg.api}`, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
  if (res.status === 401) { cerrarSesion(); return []; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.mensaje || 'Error al cargar los registros.');
  CACHE_REGISTROS[tipo] = data;
  actualizarBadge(tipo, data.length);
  return data;
}

async function cargarTabla() {
  try {
    REGISTROS = await cargarModulo(TIPO_ACTIVO);
    pintarTabla();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
  }
}

/* Cambia el tipo de registro visible en el submenú (No. de Oficio /
   Circular / Tarjeta Informativa) sin salir de la página. */
async function cambiarTipo(tipo) {
  if (!MODULOS[tipo] || tipo === TIPO_ACTIVO) return;
  TIPO_ACTIVO = tipo;

  document.querySelectorAll('#minutario-tabs .minutario-tab').forEach(btn => {
    btn.classList.toggle('activo', btn.dataset.tipo === tipo);
  });
  document.getElementById('th-numero').textContent = MODULOS[tipo].columna;

  limpiarFiltros();
  await cargarTabla();
}

/* Precarga en segundo plano los otros dos módulos solo para mostrar
   el contador en cada pestaña del submenú, sin bloquear la vista
   principal ni afectar la tabla visible. */
function precargarBadges() {
  Object.keys(MODULOS).forEach(tipo => {
    if (tipo === TIPO_ACTIVO) return;
    cargarModulo(tipo).catch(() => {});
  });
}

/* Aplica búsqueda de texto libre (sobre todos los campos visibles,
   incluidos Fecha de Sello/Fecha de Firma/Nota) y el rango de fechas
   seleccionado (sobre la fecha del oficio). */
function registrosFiltrados() {
  const q = FILTRO_TEXTO.trim().toLowerCase();

  return REGISTROS.filter(r => {
    if (FILTRO_DESDE && (!r.fecha || fechaISO(r.fecha) < FILTRO_DESDE)) return false;
    if (FILTRO_HASTA && (!r.fecha || fechaISO(r.fecha) > FILTRO_HASTA)) return false;

    if (!q) return true;

    const campos = [
      r[moduloActivo().campoNumero],
      formatearFecha(r.fecha),
      r.a_quien_se_dirige,
      r.asunto,
      r.area_solicitante,
      r.solicitante,
      formatearHora(r.hora),
      formatearFecha(r.fecha_sello),
      formatearFecha(r.fecha_firma),
      r.nota,
    ];
    return campos.some(c => String(c || '').toLowerCase().includes(q));
  });
}

function onFiltroChange() {
  FILTRO_TEXTO = document.getElementById('buscador').value;
  FILTRO_DESDE = document.getElementById('filtro-desde').value;
  FILTRO_HASTA = document.getElementById('filtro-hasta').value;
  pintarTabla();
}

function limpiarFiltros() {
  document.getElementById('buscador').value = '';
  document.getElementById('filtro-desde').value = '';
  document.getElementById('filtro-hasta').value = '';
  FILTRO_TEXTO = '';
  FILTRO_DESDE = '';
  FILTRO_HASTA = '';
  pintarTabla();
}

function pintarTabla() {
  const tbody     = document.getElementById('tabla-body');
  const filtrados = registrosFiltrados();
  const hayFiltro = !!(FILTRO_TEXTO.trim() || FILTRO_DESDE || FILTRO_HASTA);
  const cfg       = moduloActivo();

  document.getElementById('tot').textContent = REGISTROS.length;
  document.getElementById('tot-filtrado').textContent = filtrados.length;
  document.getElementById('tot-filtrado-wrap').style.display = hayFiltro ? 'inline' : 'none';
  actualizarBadge(TIPO_ACTIVO, REGISTROS.length);

  if (!REGISTROS.length) {
    tbody.innerHTML = `<tr class="fila-vacia"><td colspan="10">${cfg.vacioMsg}</td></tr>`;
    return;
  }
  if (!filtrados.length) {
    tbody.innerHTML = `<tr class="fila-vacia"><td colspan="10">Ningún registro coincide con la búsqueda o el rango de fechas.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(r => `
    <tr data-id="${r.id}">
      <td class="td-numero">${r[cfg.campoNumero]}</td>
      <td>${formatearFecha(r.fecha)}</td>
      <td>${r.a_quien_se_dirige || ''}</td>
      <td class="td-asunto">${r.asunto || '<span class="td-vacio">—</span>'}</td>
      <td>${r.area_solicitante || '<span class="td-vacio">—</span>'}</td>
      <td>${r.solicitante || '<span class="td-vacio">—</span>'}</td>
      <td>${formatearHora(r.hora) || '<span class="td-vacio">—</span>'}</td>
      <td class="td-sello">
        <input type="date" class="input-sello" value="${valorFechaInput(r.fecha_sello)}"
               onchange="guardarSello(${r.id}, 'fecha_sello', this)"/>
      </td>
      <td class="td-sello">
        <input type="date" class="input-sello${r.fecha_firma ? ' sello-lleno' : ''}" value="${valorFechaInput(r.fecha_firma)}"
               onchange="guardarSello(${r.id}, 'fecha_firma', this)"/>
      </td>
      <td class="td-nota">
        <input type="text" class="input-nota" maxlength="500" placeholder="Agregar nota…" value="${escaparAtributo(r.nota)}"
               onchange="guardarSello(${r.id}, 'nota', this)"/>
      </td>
    </tr>`).join('');
}

/* Guardado automático de un campo de sello (o de la Nota) al
   cambiarlo: PUT solo con ese campo, sin necesidad de un botón
   "Guardar" por fila. En el caso de "Fecha de Firma", además se
   marca (o desmarca) la clase .sello-lleno para que el separador "/"
   se pinte de verde en cuanto ya quedó capturada una fecha — ver
   no-oficio.css. */
async function guardarSello(id, campo, input) {
  input.classList.add('guardando');
  try {
    const res = await fetch(`${API}/${moduloActivo().api}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ [campo]: input.value }),
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo guardar.');

    // Refleja el dato guardado en memoria, sin repintar toda la tabla
    // (así no se pierde el foco si el usuario sigue capturando).
    const idx = REGISTROS.findIndex(r => r.id === id);
    if (idx !== -1) REGISTROS[idx] = data;
    if (CACHE_REGISTROS[TIPO_ACTIVO] && idx !== -1) CACHE_REGISTROS[TIPO_ACTIVO][idx] = data;

    if (campo === 'fecha_firma') {
      input.classList.toggle('sello-lleno', !!input.value);
    }
  } catch (err) {
    await sbisAlert({ titulo: 'No se pudo guardar', mensaje: err.message, tipo: 'error' });
  } finally {
    input.classList.remove('guardando');
  }
}

/* ════════════════════════════════════════════════════
   Inicio
   ════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  if (!verificarAcceso()) return;

  pintarUsuarioHeader(USUARIO?.username || '');
  mostrarFecha();
  iniciarHeartbeat();
  cargarTabla();
  precargarBadges();
});

window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) verificarAcceso();
});