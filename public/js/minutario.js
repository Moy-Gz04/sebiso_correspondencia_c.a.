/* ═══════════════════════════════════════════════════
   SBIS — Minutario
   Misma tabla que No. de Oficio; aquí solo se captura
   Fecha de Sello / Hora de Sello por registro, con guardado
   automático al cambiar cada campo. Exclusivo de
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
   Datos
   ════════════════════════════════════════════════════ */
let REGISTROS = [];

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

async function cargarTabla() {
  try {
    const res = await fetch(`${API}/no-oficio`, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al cargar los registros.');
    REGISTROS = data;
    pintarTabla();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
  }
}

function pintarTabla() {
  const tbody = document.getElementById('tabla-body');
  document.getElementById('tot').textContent = REGISTROS.length;

  if (!REGISTROS.length) {
    tbody.innerHTML = `<tr class="fila-vacia"><td colspan="9">Sin registros todavía. Créalos desde "No. de Oficio".</td></tr>`;
    return;
  }

  tbody.innerHTML = REGISTROS.map(r => `
    <tr data-id="${r.id}">
      <td class="td-numero">${r.no_oficio}</td>
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
        <input type="time" class="input-sello" value="${valorHoraInput(r.hora_sello)}"
               onchange="guardarSello(${r.id}, 'hora_sello', this)"/>
      </td>
    </tr>`).join('');
}

/* Guardado automático de un campo de sello al cambiarlo: PUT solo con
   ese campo, sin necesidad de un botón "Guardar" por fila. */
async function guardarSello(id, campo, input) {
  input.classList.add('guardando');
  try {
    const res = await fetch(`${API}/no-oficio/${id}`, {
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
});

window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) verificarAcceso();
});