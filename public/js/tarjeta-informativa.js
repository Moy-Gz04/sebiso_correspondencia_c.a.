/* ═══════════════════════════════════════════════════
   SBIS — No. Tarjeta Informativa
   Folio consecutivo. Exclusivo de Coordinación
   Administrativa (o el admin legado).
   ═══════════════════════════════════════════════════ */

const API = window.location.origin + '/api';

let TOKEN   = localStorage.getItem('sbis_token');
let USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');

const AREA_CON_GESTION_COMPLETA = 'Coordinación Administrativa';
function tieneGestionCompleta(usuario) {
  return usuario?.rol === 'admin' ||
    (usuario?.rol === 'area' && usuario?.area === AREA_CON_GESTION_COMPLETA);
}

/* Restricción adicional, exclusiva de esta página: aunque el usuario
   tenga el rol/área correctos (Coordinación Administrativa o admin),
   solo estas cuentas pueden navegar en "No. Tarjeta Informativa".
   No aplica a Minutario ni a ninguna otra vista del sistema.
   Comparación sin distinguir mayúsculas/minúsculas. */
const USUARIOS_PERMITIDOS_TARJETA = ['sara', 'moyaispuro', 'mine'];
function tieneAccesoTarjeta(usuario) {
  return USUARIOS_PERMITIDOS_TARJETA.includes((usuario?.username || '').trim().toLowerCase());
}

function mostrarBloqueoAcceso() {
  document.getElementById('bloqueo-acceso')?.classList.add('visible');
  // Oculta el contenido de la página (tabla, panel de libres, etc.),
  // pero el header y el menú de navegación quedan intactos: viven
  // fuera de <main> y nunca se tocan aquí.
  const contenido = document.getElementById('contenido-wrapper');
  if (contenido) contenido.style.display = 'none';
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
  if (!tieneAccesoTarjeta(USUARIO)) {
    mostrarBloqueoAcceso();
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
   sobre el markup ya presente en tarjeta-informativa.html.
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

/* Fecha corta con año a 2 dígitos, usada en los chips de "Tarjetas
   Libres": p. ej. 08/12/25. */
function formatearFechaCorta(f) {
  if (!f) return '';
  const d = new Date(f);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(-2)}`;
}

function formatearHora(h) {
  if (!h) return '';
  return h.slice(0, 5);
}

/* Fecha en formato ISO (yyyy-mm-dd) para comparar contra los filtros
   de rango, sin importar la zona horaria del navegador. */
function fechaISO(f) {
  if (!f) return '';
  const d = new Date(f);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function cargarTabla() {
  try {
    const res = await fetch(`${API}/tarjeta-informativa`, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al cargar los registros.');
    REGISTROS = data;
    pintarTabla();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
  }
}

/* Aplica búsqueda de texto libre (sobre todos los campos visibles) y
   el rango de fechas seleccionado. */
function registrosFiltrados() {
  const q = FILTRO_TEXTO.trim().toLowerCase();

  return REGISTROS.filter(r => {
    if (FILTRO_DESDE && (!r.fecha || fechaISO(r.fecha) < FILTRO_DESDE)) return false;
    if (FILTRO_HASTA && (!r.fecha || fechaISO(r.fecha) > FILTRO_HASTA)) return false;

    if (!q) return true;

    const campos = [
      r.no_tarjeta,
      formatearFecha(r.fecha),
      r.a_quien_se_dirige,
      r.asunto,
      r.area_solicitante,
      r.solicitante,
      formatearHora(r.hora),
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

  document.getElementById('tot').textContent = REGISTROS.length;
  document.getElementById('tot-filtrado').textContent = filtrados.length;
  document.getElementById('tot-filtrado-wrap').style.display = hayFiltro ? 'inline' : 'none';

  if (!REGISTROS.length) {
    tbody.innerHTML = `<tr class="fila-vacia"><td colspan="8">Sin registros todavía.</td></tr>`;
    return;
  }
  if (!filtrados.length) {
    tbody.innerHTML = `<tr class="fila-vacia"><td colspan="8">Ningún registro coincide con la búsqueda o el rango de fechas.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(r => `
    <tr>
      <td class="td-numero">${r.no_tarjeta}</td>
      <td>${formatearFecha(r.fecha)}</td>
      <td>${r.a_quien_se_dirige || ''}</td>
      <td class="td-asunto">${r.asunto || '<span class="td-vacio">—</span>'}</td>
      <td>${r.area_solicitante || '<span class="td-vacio">—</span>'}</td>
      <td>${r.solicitante || '<span class="td-vacio">—</span>'}</td>
      <td>${formatearHora(r.hora) || '<span class="td-vacio">—</span>'}</td>
      <td class="td-acciones">
        <div class="fila-acciones">
          <button class="btn-fila-editar" onclick="editarFila(${r.id})">
            <i class="ti ti-pencil"></i> Editar
          </button>
          <button class="btn-fila-eliminar" onclick="eliminarFila(${r.id}, '${r.no_tarjeta}')">
            <i class="ti ti-trash"></i> Eliminar
          </button>
        </div>
      </td>
    </tr>`).join('');
}

async function cargarLibres() {
  try {
    const res = await fetch(`${API}/tarjeta-informativa/liberados`, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al cargar los tarjetas libres.');
    LIBRES = data;
    pintarLibres();
  } catch { /* silencioso: no bloquea la tabla principal */ }
}

/* El panel de Tarjetas Libres arranca colapsado (solo el título con el
   total es visible): con cientos de números liberados, mostrarlos
   todos de entrada tapaba el resto de la pantalla. Se despliega solo
   al hacer clic en el título (togglePanelLibres) y ese estado se
   conserva mientras se siga en la página, aunque la lista se
   refresque (p. ej. tras "Tarjeta Libre del Día" o un Eliminar). */
let PANEL_LIBRES_EXPANDIDO = false;

function togglePanelLibres() {
  PANEL_LIBRES_EXPANDIDO = !PANEL_LIBRES_EXPANDIDO;
  aplicarEstadoPanelLibres();
}

function aplicarEstadoPanelLibres() {
  const panel = document.getElementById('panel-libres');
  const lista = document.getElementById('panel-libres-lista');
  panel.classList.toggle('expandido', PANEL_LIBRES_EXPANDIDO);
  lista.hidden = !PANEL_LIBRES_EXPANDIDO;
}

/* Agrupa los números liberados por mes (mes + año), usando la fecha
   en que se liberaron. Sirve tanto para el panel de "Tarjetas
   Libres" como para el <select> de "Asignar Anteriores": con cientos
   de números, ubicarlos sueltos era poco práctico, así que se
   organizan cronológicamente (enero, febrero, ...) y los que no
   traen una fecha válida quedan al final bajo "Sin fecha". */
const NOMBRES_MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function agruparLibresPorMes(lista) {
  const grupos = new Map();
  lista.forEach(item => {
    const d = new Date(item.liberado_en);
    let clave, etiqueta;
    if (isNaN(d.getTime())) {
      clave = 'zzzz-sin-fecha';
      etiqueta = 'Sin fecha';
    } else {
      clave = `${d.getUTCFullYear()}-${String(d.getUTCMonth()).padStart(2, '0')}`;
      etiqueta = `${NOMBRES_MES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    if (!grupos.has(clave)) grupos.set(clave, { etiqueta, items: [] });
    grupos.get(clave).items.push(item);
  });
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, grupo]) => grupo);
}

function pintarLibres() {
  const panel = document.getElementById('panel-libres');
  const lista = document.getElementById('panel-libres-lista');
  const total = document.getElementById('panel-libres-total');

  total.textContent = LIBRES.length;

  const grupos = agruparLibresPorMes(LIBRES);

  if (!LIBRES.length) {
    panel.classList.remove('visible');
    lista.innerHTML = '';
  } else {
    panel.classList.add('visible');
    lista.innerHTML = grupos.map(g => `
      <div class="panel-libres-grupo">
        <div class="panel-libres-grupo-titulo">${g.etiqueta}<span class="panel-libres-grupo-total">${g.items.length}</span></div>
        <div class="panel-libres-grupo-chips">
          ${g.items.map(l => `
            <span class="chip-libre">
              ${l.no_tarjeta}<span class="chip-libre-sep">-</span><span class="chip-libre-fecha">${formatearFechaCorta(l.liberado_en)}</span>
            </span>`).join('')}
        </div>
      </div>`).join('');
  }
  aplicarEstadoPanelLibres();

  const sel = document.getElementById('nof-libre');
  sel.innerHTML = '<option value="">— Selecciona un número —</option>' +
    grupos.map(g => `
      <optgroup label="${g.etiqueta}">
        ${g.items.map(l => `<option value="${l.no_tarjeta}">${l.no_tarjeta} — liberado ${formatearFechaCorta(l.liberado_en)}</option>`).join('')}
      </optgroup>`).join('');
}

/* ════════════════════════════════════════════════════
   Modal: Nuevo / Editar No. Tarjeta Informativa
   ════════════════════════════════════════════════════ */
let EDITANDO_ID = null;

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
  EDITANDO_ID = null;
  document.getElementById('modal-nuevo-titulo').textContent = 'Nuevo No. Tarjeta Informativa';
  document.getElementById('modal-nuevo-icono').className = 'ti ti-file-plus';
  document.getElementById('nof-btn-guardar-txt').textContent = 'Guardar';
  document.getElementById('bloque-modo-asignacion').style.display = '';
  limpiarModalNuevo();
  cargarLibres();
  document.getElementById('modal-nuevo-no-of').classList.add('visible');
}

/* Abre el mismo modal en modo edición: precarga los datos del
   registro y oculta el bloque de "¿Cómo se asigna el número?" (el
   número ya está asignado y no cambia desde aquí). Al guardar, envía
   un PUT en vez de un POST. */
function editarFila(id) {
  const r = REGISTROS.find(x => x.id === id);
  if (!r) return;

  EDITANDO_ID = id;
  document.getElementById('modal-nuevo-titulo').textContent = `Editar No. Tarjeta Informativa ${r.no_tarjeta}`;
  document.getElementById('modal-nuevo-icono').className = 'ti ti-pencil';
  document.getElementById('nof-btn-guardar-txt').textContent = 'Guardar cambios';
  document.getElementById('bloque-modo-asignacion').style.display = 'none';
  document.getElementById('campo-select-libres').style.display = 'none';
  document.getElementById('nof-error').textContent = '';

  document.getElementById('nof-fecha').value = fechaISO(r.fecha);
  document.getElementById('nof-hora').value = r.hora ? r.hora.slice(0, 5) : '';
  document.getElementById('nof-dirige').value = r.a_quien_se_dirige || '';
  document.getElementById('nof-area').value = r.area_solicitante || '';
  document.getElementById('nof-solicitante').value = r.solicitante || '';
  document.getElementById('nof-asunto').value = r.asunto || '';

  document.getElementById('modal-nuevo-no-of').classList.add('visible');
}

function cerrarNuevo() {
  document.getElementById('modal-nuevo-no-of').classList.remove('visible');
}

async function guardarNuevo() {
  const errorEl = document.getElementById('nof-error');
  errorEl.textContent = '';

  const editando  = EDITANDO_ID !== null;
  const modo      = editando ? null : document.querySelector('input[name="modo"]:checked').value;
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
  if (!editando && modo === 'anterior' && !libre) {
    errorEl.textContent = 'Selecciona un número de la lista de Tarjetas Libres.';
    return;
  }

  const btn = document.getElementById('nof-btn-guardar');
  btn.disabled = true;

  try {
    const url    = editando ? `${API}/tarjeta-informativa/${EDITANDO_ID}` : `${API}/tarjeta-informativa`;
    const method = editando ? 'PUT' : 'POST';
    const body   = editando
      ? { fecha, hora, a_quien_se_dirige: dirige, area_solicitante: area, solicitante: solicita, asunto }
      : { modo, no_tarjeta: modo === 'anterior' ? libre : undefined,
          fecha, hora, a_quien_se_dirige: dirige,
          area_solicitante: area, solicitante: solicita, asunto };

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo guardar.');

    cerrarNuevo();
    await cargarTabla();
    await cargarLibres();
    await sbisAlert({
      titulo: editando ? `No. Tarjeta Informativa ${data.no_tarjeta} actualizado` : `No. Tarjeta Informativa ${data.no_tarjeta} registrado`,
      mensaje: editando ? 'Los cambios se guardaron correctamente.' : 'El registro se guardó correctamente.',
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
    titulo: `¿Eliminar el No. Tarjeta Informativa ${numero}?`,
    mensaje: 'El registro se eliminará y el número quedará libre para reasignarse después desde "Asignar Anteriores". No se reutilizará en automático.',
    btnOk: 'Eliminar',
    tipo: 'danger',
  });
  if (!ok) return;

  try {
    const res = await fetch(`${API}/tarjeta-informativa/${id}`, {
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