/* ═══════════════════════════════════════════════════
   SBIS — Salas (Coordinación)
   Catálogo de salas + calendario semanal de apartados.
   Exclusivo de Coordinación Administrativa (o el admin
   legado) — mismo patrón que No. de Oficio / Circular /
   Tarjeta Informativa / Minutario.
   ═══════════════════════════════════════════════════ */

const API = window.location.origin + '/api';

let TOKEN   = localStorage.getItem('sbis_token');
let USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');

const AREA_CON_GESTION_COMPLETA = 'Coordinación Administrativa';
function tieneGestionCompleta(usuario) {
  return usuario?.rol === 'admin' ||
    (usuario?.rol === 'area' && usuario?.area === AREA_CON_GESTION_COMPLETA);
}

function mostrarBloqueoAcceso() {
  document.getElementById('bloqueo-acceso')?.classList.add('visible');
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
   sobre el markup ya presente en salas.html.
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
   Fechas / horas
   ════════════════════════════════════════════════════ */

/* Bloques de reserva: de 08:00 a 19:00 (última reserva termina a las
   20:00), en horas completas — cada apartado ocupa un bloque fijo de
   1 hora, según se pidió. */
const HORAS = Array.from({ length: 12 }, (_, i) => String(8 + i).padStart(2, '0') + ':00');

const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function fechaISO(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* Lunes de la semana que contiene la fecha dada (semana Lun-Dom). */
function lunesDeSemana(fecha) {
  const d = new Date(fecha);
  const diaSemana = d.getDay(); // 0=domingo .. 6=sábado
  const offset = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

let SEMANA_LUNES = lunesDeSemana(new Date());
let SALAS = [];
let APARTADOS = [];

function cambiarSemana(delta) {
  const nuevo = new Date(SEMANA_LUNES);
  nuevo.setDate(nuevo.getDate() + delta * 7);
  SEMANA_LUNES = nuevo;
  cargarApartados();
}

function irASemanaActual() {
  SEMANA_LUNES = lunesDeSemana(new Date());
  cargarApartados();
}

/* ════════════════════════════════════════════════════
   Salas (catálogo)
   ════════════════════════════════════════════════════ */
async function cargarSalas() {
  try {
    const res = await fetch(`${API}/salas`, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al cargar las salas.');
    SALAS = data;
    pintarSalas();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
  }
}

function pintarSalas() {
  const chips = document.getElementById('lista-salas-chip');
  if (chips) {
    chips.innerHTML = SALAS.length
      ? SALAS.map(s => `<span class="chip-sala"><i class="ti ti-door"></i> ${s.nombre}</span>`).join('')
      : '<span style="color:#b7aeb2; font-size:12.5px;">Todavía no hay salas registradas.</span>';
  }

  const select = document.getElementById('select-sala');
  if (select) {
    select.innerHTML = SALAS.length
      ? SALAS.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('')
      : '<option value="">No hay salas registradas</option>';
  }
}

async function registrarSala() {
  const input   = document.getElementById('input-nombre-sala');
  const errorEl = document.getElementById('error-nueva-sala');
  const btn     = document.getElementById('btn-registrar-sala');
  const nombre  = input.value.trim();

  errorEl.textContent = '';
  if (!nombre) { errorEl.textContent = 'Escribe el nombre de la sala.'; return; }

  btn.disabled = true;
  try {
    const res = await fetch(`${API}/salas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ nombre }),
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo registrar la sala.');

    input.value = '';
    await cargarSalas();
    await sbisAlert({ titulo: 'Sala registrada', mensaje: `"${data.nombre}" ya está disponible para apartarse.`, tipo: 'success' });
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════
   Apartados / Calendario
   ════════════════════════════════════════════════════ */
async function cargarApartados() {
  const desde = fechaISO(SEMANA_LUNES);
  const domingo = new Date(SEMANA_LUNES);
  domingo.setDate(domingo.getDate() + 6);
  const hasta = fechaISO(domingo);

  try {
    const res = await fetch(`${API}/salas/apartados?desde=${desde}&hasta=${hasta}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al cargar los apartados.');
    APARTADOS = data;
    pintarCalendario();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
  }
}

function pintarCalendario() {
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(SEMANA_LUNES);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Encabezado con el rango de la semana visible
  const rangoTxt = document.getElementById('cal-rango-txt');
  if (rangoTxt) {
    const pad = n => String(n).padStart(2, '0');
    const f1 = dias[0], f2 = dias[6];
    rangoTxt.textContent = `Semana del ${pad(f1.getDate())}/${pad(f1.getMonth() + 1)} al ${pad(f2.getDate())}/${pad(f2.getMonth() + 1)} de ${f2.getFullYear()}`;
  }

  // Encabezado de columnas (días)
  const thead = document.getElementById('cal-thead-row');
  thead.innerHTML = '<th>Hora</th>' + dias.map((d, i) => {
    const pad = n => String(n).padStart(2, '0');
    return `<th><span class="cal-th-dia">${DIAS_SEMANA[i]}</span><span class="cal-th-fecha">${pad(d.getDate())}/${pad(d.getMonth() + 1)}</span></th>`;
  }).join('');

  // Cuerpo: una fila por hora
  const tbody = document.getElementById('cal-tbody');
  tbody.innerHTML = HORAS.map(hora => {
    const celdas = dias.map(d => {
      const iso = fechaISO(d);
      const eventos = APARTADOS.filter(a => a.fecha?.slice(0, 10) === iso && a.hora?.slice(0, 5) === hora);
      const contenido = eventos.map(ev => `
        <div class="cal-evento" title="Clic para cancelar" onclick="cancelarApartado(${ev.id})">
          ${ev.sala_nombre}
          ${ev.motivo ? `<small>${ev.motivo}</small>` : ''}
        </div>`).join('');
      return `<td>${contenido}</td>`;
    }).join('');
    return `<tr><td class="cal-hora">${hora}</td>${celdas}</tr>`;
  }).join('');
}

async function apartarSala() {
  const selectSala = document.getElementById('select-sala');
  const inputFecha = document.getElementById('input-fecha-apartado');
  const selectHora = document.getElementById('select-hora-apartado');
  const inputMotivo = document.getElementById('input-motivo-apartado');
  const errorEl = document.getElementById('error-apartar-sala');
  const btn = document.getElementById('btn-apartar-sala');

  errorEl.textContent = '';

  const sala_id = selectSala.value;
  const fecha   = inputFecha.value;
  const hora    = selectHora.value;
  const motivo  = inputMotivo.value.trim();

  if (!sala_id)  { errorEl.textContent = 'Registra o selecciona una sala primero.'; return; }
  if (!fecha)    { errorEl.textContent = 'Selecciona una fecha.'; return; }
  if (!hora)     { errorEl.textContent = 'Selecciona una hora.'; return; }

  btn.disabled = true;
  try {
    const res = await fetch(`${API}/salas/apartados`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ sala_id, fecha, hora, motivo }),
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo apartar la sala.');

    inputMotivo.value = '';

    // Si el apartado quedó en la semana visible, brinca el calendario
    // a esa semana para que se vea de inmediato; si no, solo recarga
    // la semana en la que ya estabas.
    SEMANA_LUNES = lunesDeSemana(fecha);
    await cargarApartados();

    await sbisAlert({
      titulo: 'Sala apartada',
      mensaje: `${data.sala_nombre} — ${formatearFechaCorta(fecha)} a las ${hora}.`,
      tipo: 'success',
    });
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function cancelarApartado(id) {
  const ok = await sbisConfirm({
    titulo: '¿Cancelar este apartado?',
    mensaje: 'La sala quedará libre en ese horario otra vez.',
    btnOk: 'Cancelar apartado',
    tipo: 'danger',
  });
  if (!ok) return;

  try {
    const res = await fetch(`${API}/salas/apartados/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo cancelar el apartado.');
    await cargarApartados();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
  }
}

function formatearFechaCorta(fechaISOStr) {
  const [a, m, d] = fechaISOStr.split('-');
  return `${d}/${m}/${a}`;
}

function pintarSelectHoras() {
  const select = document.getElementById('select-hora-apartado');
  if (!select) return;
  select.innerHTML = HORAS.map(h => `<option value="${h}">${h}</option>`).join('');
}

/* ════════════════════════════════════════════════════
   Inicio
   ════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  if (!verificarAcceso()) return;

  pintarUsuarioHeader(USUARIO?.username || '');
  mostrarFecha();
  iniciarHeartbeat();
  pintarSelectHoras();

  const inputFecha = document.getElementById('input-fecha-apartado');
  if (inputFecha) inputFecha.value = fechaISO(new Date());

  cargarSalas();
  cargarApartados();
});

window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) verificarAcceso();
});
