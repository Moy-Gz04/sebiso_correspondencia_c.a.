/* ═══════════════════════════════════════════════════
   SBIS — No. de Oficio
   Folio consecutivo de oficios EMITIDOS. Exclusivo de
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

/* ════════════════════════════════════════════════════
   Modales genéricos (alerta / confirmación) — operan
   sobre el markup ya presente en no-oficio.html.
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
    const cerrar = () => { overlay.classList.remove('visible'); if (onClose) onClose(); resolve(); };
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
   Datos
   ════════════════════════════════════════════════════ */
let REGISTROS = [];
let LIBRES    = [];

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
    tbody.innerHTML = `<tr class="fila-vacia"><td colspan="8">Sin registros todavía.</td></tr>`;
    return;
  }

  tbody.innerHTML = REGISTROS.map(r => `
    <tr>
      <td class="td-numero">${r.no_oficio}</td>
      <td>${formatearFecha(r.fecha)}</td>
      <td>${r.a_quien_se_dirige || ''}</td>
      <td class="td-asunto">${r.asunto || '<span class="td-vacio">—</span>'}</td>
      <td>${r.area_solicitante || '<span class="td-vacio">—</span>'}</td>
      <td>${r.solicitante || '<span class="td-vacio">—</span>'}</td>
      <td>${formatearHora(r.hora) || '<span class="td-vacio">—</span>'}</td>
      <td class="td-acciones">
        <button class="btn-fila-eliminar" onclick="eliminarFila(${r.id}, '${r.no_oficio}')">
          <i class="ti ti-trash"></i> Eliminar
        </button>
      </td>
    </tr>`).join('');
}

async function cargarLibres() {
  try {
    const res = await fetch(`${API}/no-oficio/liberados`, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al cargar los oficios libres.');
    LIBRES = data;
    pintarLibres();
  } catch { /* silencioso: no bloquea la tabla principal */ }
}

function pintarLibres() {
  const panel = document.getElementById('panel-libres');
  const lista = document.getElementById('panel-libres-lista');

  if (!LIBRES.length) {
    panel.classList.remove('visible');
    lista.innerHTML = '';
  } else {
    panel.classList.add('visible');
    lista.innerHTML = LIBRES.map(l => `<span class="chip-libre">${l.no_oficio}</span>`).join('');
  }

  const sel = document.getElementById('nof-libre');
  sel.innerHTML = '<option value="">— Selecciona un número —</option>' +
    LIBRES.map(l => `<option value="${l.no_oficio}">${l.no_oficio}</option>`).join('');
}

/* ════════════════════════════════════════════════════
   Modal: Nuevo No. de Oficio
   ════════════════════════════════════════════════════ */
function onModoChange() {
  const modo = document.querySelector('input[name="modo"]:checked').value;
  document.getElementById('modo-op-auto').classList.toggle('activo', modo === 'automatico');
  document.getElementById('modo-op-anterior').classList.toggle('activo', modo === 'anterior');
  document.getElementById('campo-select-libres').style.display = modo === 'anterior' ? 'block' : 'none';
}

function limpiarModalNuevo() {
  document.getElementById('nof-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('nof-hora').value = '';
  document.getElementById('nof-dirige').value = '';
  document.getElementById('nof-area').value = '';
  document.getElementById('nof-solicitante').value = '';
  document.getElementById('nof-asunto').value = '';
  document.getElementById('nof-libre').value = '';
  document.getElementById('nof-error').textContent = '';
  document.querySelector('input[name="modo"][value="automatico"]').checked = true;
  onModoChange();
}

function abrirNuevo() {
  limpiarModalNuevo();
  cargarLibres();
  document.getElementById('modal-nuevo-no-of').classList.add('visible');
}

function cerrarNuevo() {
  document.getElementById('modal-nuevo-no-of').classList.remove('visible');
}

async function guardarNuevo() {
  const errorEl = document.getElementById('nof-error');
  errorEl.textContent = '';

  const modo      = document.querySelector('input[name="modo"]:checked').value;
  const fecha     = document.getElementById('nof-fecha').value;
  const hora      = document.getElementById('nof-hora').value;
  const dirige    = document.getElementById('nof-dirige').value.trim();
  const area      = document.getElementById('nof-area').value.trim();
  const solicita  = document.getElementById('nof-solicitante').value.trim();
  const asunto    = document.getElementById('nof-asunto').value.trim();
  const libre     = document.getElementById('nof-libre').value;

  if (!fecha || !dirige) {
    errorEl.textContent = 'Fecha y "A quién se dirige" son obligatorios.';
    return;
  }
  if (modo === 'anterior' && !libre) {
    errorEl.textContent = 'Selecciona un número de la lista de Oficios Libres.';
    return;
  }

  const btn = document.getElementById('nof-btn-guardar');
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/no-oficio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({
        modo, no_oficio: modo === 'anterior' ? libre : undefined,
        fecha, hora, a_quien_se_dirige: dirige,
        area_solicitante: area, solicitante: solicita, asunto,
      }),
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo guardar.');

    cerrarNuevo();
    await cargarTabla();
    await cargarLibres();
    await sbisAlert({
      titulo: `No. de Oficio ${data.no_oficio} registrado`,
      mensaje: 'El registro se guardó correctamente.',
      tipo: 'success',
    });
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════
   Eliminar (libera el número)
   ════════════════════════════════════════════════════ */
async function eliminarFila(id, numero) {
  const ok = await sbisConfirm({
    titulo: `¿Eliminar el No. de Oficio ${numero}?`,
    mensaje: 'El registro se eliminará y el número quedará libre para reasignarse después desde "Asignar Anteriores". No se reutilizará en automático.',
    btnOk: 'Eliminar',
    tipo: 'danger',
  });
  if (!ok) return;

  try {
    const res = await fetch(`${API}/no-oficio/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo eliminar.');

    await cargarTabla();
    await cargarLibres();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
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
  cargarLibres();
});

window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) verificarAcceso();
});