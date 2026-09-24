/* ═══════════════════════════════════════════════════
   SBIS — Salas (Coordinación)
   Catálogo de salas + tendedero de tarjetas (apartados)
   ordenadas de la más próxima a la más lejana, con
   historial de tarjetas eliminadas. Exclusivo de
   Coordinación Administrativa (o el admin legado) —
   mismo patrón que No. de Oficio / Circular / Tarjeta
   Informativa / Minutario.
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

function fechaISO(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* Momentos reales (Date) que representa un apartado, combinando su
   fecha con hora_inicio/hora_fin en horario local. El inicio ordena
   el tendedero (lo más próximo primero); el fin decide el estatus —
   un evento no se considera terminado hasta que pasa su hora_fin. */
function momentoInicioApartado(ap) {
  return new Date(`${ap.fecha.slice(0, 10)}T${ap.hora_inicio.slice(0, 5)}:00`);
}
function momentoFinApartado(ap) {
  // Un apartado de varios días termina al acabar su ÚLTIMO día
  return new Date(`${(ap.fecha_fin || ap.fecha).slice(0, 10)}T${ap.hora_fin.slice(0, 5)}:00`);
}

let SALAS = [];
let APARTADOS = [];            // tarjetas (un apartado de varios días = UNA tarjeta con varias filas)
let EDITANDO_ID = null;
let EDITANDO_IDS = [];         // filas de la tarjeta que se está editando
let DIAS_SELECCIONADOS = [];   // días elegidos en el formulario para un apartado nuevo

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/* ["2026-09-29","2026-09-30","2026-10-01"] -> "29 y 30 sep, 1 oct 2026".
   Un solo día conserva el formato de siempre (dd/mm/aaaa). */
function textoDias(fechas) {
  if (fechas.length === 1) return formatearFechaCorta(fechas[0]);
  const grupos = [];
  for (const f of fechas) {
    const [a, m, d] = f.split('-').map(Number);
    const g = grupos[grupos.length - 1];
    if (g && g.a === a && g.m === m) g.d.push(d); else grupos.push({ a, m, d: [d] });
  }
  const mismoAnio = grupos.every(g => g.a === grupos[0].a);
  const unir = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : String(xs[0]));
  const partes = grupos.map(g => `${unir(g.d)} ${MES_CORTO[g.m - 1]}${mismoAnio ? '' : ' ' + g.a}`);
  return partes.join(', ') + (mismoAnio ? ' ' + grupos[0].a : '');
}

/* Filas del servidor -> tarjetas. Un apartado de varios días se guarda
   como una fila por día, todas creadas juntas: comparten folio, PDF,
   autor, horario, textos y momento de creación, y eso las identifica como
   UNA sola tarjeta. Cualquier fila suelta (o sin folio) es su propia tarjeta. */
function agruparApartados(filas) {
  const grupos = new Map();
  for (const f of [...filas].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const clave = f.folio_nota
      ? [f.folio_nota, f.sala_id, f.hora_inicio, f.hora_fin, f.personas, f.descripcion, f.no_oficio, f.prestamo, f.creado_por, f.nota_pdf_url, f.creado_en].join('\u0001')
      : `solo:${f.id}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(f);
  }
  return [...grupos.values()].map(g => ({
    ...g[0],
    ids: g.map(x => x.id),
    fechas: g.map(x => x.fecha.slice(0, 10)),
    fecha_fin: g[g.length - 1].fecha.slice(0, 10),
  }));
}

/* ── Días elegidos para un apartado nuevo ── */
function expandirRango(desde, hasta) {
  const [a, m, d] = desde.split('-').map(Number);
  const inicio = new Date(a, m - 1, d);
  let fin = inicio;
  if (hasta) { const [a2, m2, d2] = hasta.split('-').map(Number); fin = new Date(a2, m2 - 1, d2); }
  if (fin < inicio) return null;
  const dias = [];
  for (const x = new Date(inicio); x <= fin; x.setDate(x.getDate() + 1)) {
    dias.push(fechaISO(x));
    if (dias.length > 31) return null;
  }
  return dias;
}

function pintarDiasLista() {
  const cont = document.getElementById('dias-lista');
  if (!cont) return;
  cont.innerHTML = DIAS_SELECCIONADOS.map(f => `
    <span class="chip-dia">${formatearFechaCorta(f)}
      <button type="button" title="Quitar este día" onclick="quitarDiaApartado('${f}')">✕</button>
    </span>`).join('');
}

function quitarDiaApartado(f) {
  DIAS_SELECCIONADOS = DIAS_SELECCIONADOS.filter(x => x !== f);
  pintarDiasLista();
}

/* Suma a la lista lo que haya en "Fecha" (y "Hasta", si se puso).
   Devuelve true si no hubo problema. */
function agregarDiasApartado() {
  const errorEl = document.getElementById('error-apartar-sala');
  const desde = document.getElementById('input-fecha-apartado').value;
  const hasta = document.getElementById('input-fecha-fin-apartado').value;
  errorEl.textContent = '';
  if (!desde) { errorEl.textContent = 'Selecciona una fecha.'; return false; }
  const dias = expandirRango(desde, hasta);
  if (!dias) {
    errorEl.textContent = hasta && hasta < desde
      ? 'El día final no puede ser anterior al inicial.'
      : 'Un apartado puede abarcar máximo 31 días.';
    return false;
  }
  const todos = [...new Set([...DIAS_SELECCIONADOS, ...dias])].sort();
  if (todos.length > 31) { errorEl.textContent = 'Un apartado puede abarcar máximo 31 días.'; return false; }
  DIAS_SELECCIONADOS = todos;
  document.getElementById('input-fecha-apartado').value = '';
  document.getElementById('input-fecha-fin-apartado').value = '';
  pintarDiasLista();
  return true;
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
      ? SALAS.map(s => `
        <span class="chip-sala">
          <i class="ti ti-door"></i> ${s.nombre}
          <button class="chip-sala-borrar" title="Eliminar sala" onclick="eliminarSala(${s.id}, '${s.nombre.replace(/'/g, "\\'")}')">✕</button>
        </span>`).join('')
      : '<span style="color:#b7aeb2; font-size:12.5px;">Todavía no hay salas registradas.</span>';
  }

  const select = document.getElementById('select-sala');
  if (select) {
    select.innerHTML = SALAS.length
      ? SALAS.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('')
      : '<option value="">No hay salas registradas</option>';
  }
}

async function eliminarSala(id, nombre) {
  const tieneApartados = APARTADOS.some(a => a.sala_id === id);
  const ok = await sbisConfirm({
    titulo: '¿Eliminar esta sala?',
    mensaje: tieneApartados
      ? `"${nombre}" tiene apartados vigentes — también se quitarán del tendedero. Esta acción no se puede deshacer.`
      : `"${nombre}" se eliminará del catálogo. Esta acción no se puede deshacer.`,
    btnOk: 'Eliminar sala',
    tipo: 'danger',
  });
  if (!ok) return;

  try {
    const res = await fetch(`${API}/salas/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo eliminar la sala.');

    await cargarSalas();
    await cargarApartados();
    await cargarHistorial();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
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
   Apartados / Tendedero de tarjetas
   ════════════════════════════════════════════════════ */
async function cargarApartados() {
  try {
    const res = await fetch(`${API}/salas/apartados`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al cargar los apartados.');
    APARTADOS = agruparApartados(data);
    pintarTendedero();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
  }
}

const COLORES_TICKET = ['color-1', 'color-2', 'color-3', 'color-4'];

function pintarTendedero() {
  const cont = document.getElementById('tendedero');
  if (!cont) return;

  if (!APARTADOS.length) {
    cont.innerHTML = '<p class="cal-vacio-msg">Todavía no hay salas apartadas.</p>';
    return;
  }

  const ordenados = [...APARTADOS].sort((a, b) => momentoInicioApartado(a) - momentoInicioApartado(b));

  cont.innerHTML = ordenados.map((ap, i) => {
    const vencido = momentoFinApartado(ap) < new Date();
    const estatus = vencido ? 'Listo para eliminar' : 'Próximo';
    const dias = ap.fechas.length;
    return `
      <div class="ticket ${COLORES_TICKET[i % COLORES_TICKET.length]}" data-id="${ap.id}" data-vencido="${vencido}" onclick="verDetalleTicket(${ap.id})">
        <button class="ticket-close" title="Quitar tarjeta" onclick="event.stopPropagation(); descartarApartado(${ap.id})">✕</button>
        <button class="ticket-edit" title="Editar apartado" onclick="event.stopPropagation(); editarApartado(${ap.id})"><i class="ti ti-pencil"></i></button>
        <div class="ticket-title">${ap.sala_nombre}</div>
        <div class="ticket-info"><i class="ti ti-clock"></i> ${textoDias(ap.fechas)} — ${ap.hora_inicio.slice(0, 5)} a ${ap.hora_fin.slice(0, 5)}</div>
        <div class="ticket-info"><i class="ti ti-users"></i> ${ap.personas} persona${ap.personas === 1 ? '' : 's'}</div>
        <div class="ticket-info"><i class="ti ti-align-left"></i> ${ap.descripcion || 'Sin descripción'}</div>
        ${ap.no_oficio ? `<div class="ticket-info"><i class="ti ti-file-text"></i> ${ap.no_oficio}</div>` : ''}
        ${dias > 1 ? `<span class="ticket-dias-badge"><i class="ti ti-calendar-event"></i> ${dias} días</span>` : ''}
        ${ap.folio_nota ? `<span class="ticket-nota-badge"><i class="ti ti-file-description"></i> Nota ${ap.folio_nota}</span>` : ''}
        <span class="ticket-tag">${estatus}</span>
      </div>`;
  }).join('');
}

/* Extrae el fileId de una URL de Drive tipo
   "https://drive.google.com/file/d/<ID>/view?usp=drivesdk". */
function idDriveDesdeUrl(url) {
  const m = url?.match(/\/file\/d\/([^/]+)/);
  return m ? m[1] : null;
}

/* Arma la tarjeta de Nota del modal de detalle: folio + botón "Abrir en
   Drive" siempre visibles, más una vista previa del PDF embebida con
   iframe (Drive la sirve en /preview). Si el PDF no se pudo generar (o
   el navegador no logra cargar el iframe — por ejemplo, cuenta sin
   permiso sobre el archivo), el folio y el enlace de todos modos quedan
   ahí, nunca se ve un hueco vacío. */
function pintarTarjetaNota(ap) {
  if (!ap.folio_nota) return '';
  if (!ap.nota_pdf_url) {
    return `
      <div class="nota-card-head"><span class="folio"><i class="ti ti-file-description"></i> Nota ${ap.folio_nota}</span></div>
      <div class="nota-card-sinpdf"><i class="ti ti-alert-circle"></i> El PDF de esta Nota no se generó (Drive no respondió). Puedes volver a intentarlo: se conserva el mismo número de Nota.</div>
      <button type="button" class="btn-reintentar-pdf" id="btn-reintentar-pdf" onclick="regenerarNotaPDF(${ap.id})"><i class="ti ti-refresh"></i> Reintentar generar PDF</button>
      <p class="reintentar-pdf-msg" id="reintentar-pdf-msg" aria-live="polite"></p>`;
  }
  const fileId = idDriveDesdeUrl(ap.nota_pdf_url);
  return `
    <div class="nota-card-head">
      <span class="folio"><i class="ti ti-file-description"></i> Nota ${ap.folio_nota}</span>
      <a class="nota-card-abrir" href="${ap.nota_pdf_url}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> Abrir en Drive</a>
    </div>
    ${fileId ? `<iframe class="nota-card-preview" src="https://drive.google.com/file/d/${fileId}/preview" allow="autoplay" loading="lazy"></iframe>` : ''}`;
}

/* Muestra el detalle ampliado de una tarjeta al hacer clic en ella
   (sin contar el clic sobre la ✕ o el lápiz, que tienen su propia
   acción). */
function verDetalleTicket(id) {
  const ap = APARTADOS.find(a => a.id === id);
  if (!ap) return;

  const vencido = momentoFinApartado(ap) < new Date();
  const colorIdx = [...APARTADOS].sort((a, b) => momentoInicioApartado(a) - momentoInicioApartado(b)).findIndex(a => a.id === id);

  document.getElementById('detalle-modal').className = `detalle-modal ${COLORES_TICKET[colorIdx % COLORES_TICKET.length]}`;
  document.getElementById('detalle-sala').textContent = ap.sala_nombre;
  document.getElementById('detalle-fechahora').textContent = `${textoDias(ap.fechas)} — ${ap.hora_inicio.slice(0, 5)} a ${ap.hora_fin.slice(0, 5)}`;
  document.getElementById('detalle-personas').textContent = `${ap.personas} persona${ap.personas === 1 ? '' : 's'}`;
  document.getElementById('detalle-descripcion').textContent = ap.descripcion || 'Sin descripción';
  document.getElementById('detalle-oficio-fila').style.display = ap.no_oficio ? '' : 'none';
  document.getElementById('detalle-oficio').textContent = ap.no_oficio || '';
  document.getElementById('detalle-prestamo-fila').style.display = ap.prestamo ? '' : 'none';
  document.getElementById('detalle-prestamo').textContent = ap.prestamo || '';
  document.getElementById('detalle-nota-fila').style.display = ap.folio_nota ? '' : 'none';
  document.getElementById('detalle-nota-card').innerHTML = pintarTarjetaNota(ap);
  document.getElementById('detalle-estatus').textContent = vencido ? 'Listo para eliminar' : 'Próximo';

  document.getElementById('detalle-overlay').classList.add('visible');
}

/* Vuelve a pedir el PDF de una Nota que quedó sin él. Mismo folio; el PDF
   queda en todos los días de la tarjeta. */
async function regenerarNotaPDF(id) {
  const ap = APARTADOS.find(a => a.id === id);
  const btn = document.getElementById('btn-reintentar-pdf');
  const msg = document.getElementById('reintentar-pdf-msg');
  if (!ap || !btn) return;
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Generando…';
  msg.textContent = 'Esto puede tardar unos segundos.';
  try {
    const res = await fetch(`${API}/salas/apartados/regenerar-nota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ ids: ap.ids }),
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo generar el PDF.');
    await cargarApartados();
    verDetalleTicket(id); // se vuelve a pintar el detalle, ya con el PDF
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-refresh"></i> Reintentar generar PDF';
    msg.textContent = err.message;
  }
}

function cerrarDetalleTicket() {
  document.getElementById('detalle-overlay').classList.remove('visible');
}

/* Recalcula el estatus (Próximo / Listo para eliminar) de las tarjetas
   ya pintadas, sin volver a pedir los datos al servidor. */
function refrescarEstatusTendedero() {
  if (!APARTADOS.length) return;
  pintarTendedero();
}
setInterval(refrescarEstatusTendedero, 60000);

/* Ventana "Apartando sala…" — evita que la pantalla se quede estática
   mientras el servidor asigna el folio y genera el PDF de la Nota
   (llamada a Apps Script, puede tardar unos segundos). */
function mostrarCargando(titulo, sub) {
  document.getElementById('cargando-titulo').textContent = titulo;
  document.getElementById('cargando-sub').textContent = sub;
  document.getElementById('cargando-overlay').classList.add('visible');
}
function ocultarCargando() {
  document.getElementById('cargando-overlay').classList.remove('visible');
}

async function apartarSala() {
  const selectSala = document.getElementById('select-sala');
  const inputFecha = document.getElementById('input-fecha-apartado');
  const inputHoraInicio = document.getElementById('input-hora-inicio-apartado');
  const inputHoraFin = document.getElementById('input-hora-fin-apartado');
  const inputPersonas = document.getElementById('input-personas-apartado');
  const inputDescripcion = document.getElementById('input-descripcion-apartado');
  const inputOficio = document.getElementById('input-oficio-apartado');
  const inputPrestamo = document.getElementById('input-prestamo-apartado');
  const inputFolioNota = document.getElementById('input-folio-nota');
  const errorEl = document.getElementById('error-apartar-sala');
  const btn = document.getElementById('btn-apartar-sala');

  errorEl.textContent = '';

  const editandoGrupo = EDITANDO_IDS.length > 1;
  // Apartado nuevo: lo que esté escrito en "Fecha"/"Hasta" y aún no se haya
  // agregado a la lista se suma solo (no hace falta pulsar el botón para
  // el caso normal de "del día X al día Y").
  if (EDITANDO_ID === null && inputFecha.value && !agregarDiasApartado()) return;
  const fechas = EDITANDO_ID === null ? [...DIAS_SELECCIONADOS] : null;

  const sala_id = selectSala.value;
  const fecha   = EDITANDO_ID === null ? fechas[0] : inputFecha.value;
  const hora_inicio = inputHoraInicio.value;
  const hora_fin    = inputHoraFin.value;
  const personas = parseInt(inputPersonas.value, 10);
  const descripcion = inputDescripcion.value.trim();
  const no_oficio = inputOficio.value.trim();
  const prestamo = inputPrestamo.value.trim();
  // Solo al crear: al editar, la tarjetita de folio queda oculta y el
  // número de la Nota ya asignada no se toca (ver editarApartado).
  const folio_nota = (EDITANDO_ID === null && inputFolioNota) ? inputFolioNota.value.trim() : undefined;

  if (!sala_id)      { errorEl.textContent = 'Registra o selecciona una sala primero.'; return; }
  if (!fecha && !editandoGrupo) { errorEl.textContent = 'Selecciona una fecha.'; return; }
  if (!hora_inicio)  { errorEl.textContent = 'Selecciona la hora de inicio.'; return; }
  if (!hora_fin)     { errorEl.textContent = 'Selecciona la hora de fin.'; return; }
  if (hora_fin <= hora_inicio) { errorEl.textContent = 'La hora de fin debe ser posterior a la de inicio.'; return; }
  if (!Number.isInteger(personas) || personas < 1) { errorEl.textContent = 'Indica cuántas personas ocuparán la sala.'; return; }
  if (!descripcion) { errorEl.textContent = 'Describe brevemente el evento.'; return; }

  const editando = EDITANDO_ID !== null;
  // El aviso final se arma con las fechas de ESTA tarjeta (al terminar la edición ya se limpia el estado).
  const fechasParaMensaje = editando ? (APARTADOS.find(a => a.id === EDITANDO_ID)?.fechas ?? [fecha]) : fechas;
  btn.disabled = true;
  mostrarCargando(
    editando ? 'Guardando cambios…' : 'Apartando sala…',
    editando ? 'Un momento, por favor.' : 'Generando la Nota (PDF). Esto puede tardar unos segundos.'
  );
  try {
    const cuerpo = { sala_id, fecha, hora_inicio, hora_fin, personas, descripcion, no_oficio, prestamo, folio_nota };
    if (!editando) cuerpo.fechas = fechas;
    if (editandoGrupo) cuerpo.ids = EDITANDO_IDS;
    const res = await fetch(`${API}/salas/apartados${editando ? '/' + EDITANDO_ID : ''}`, {
      method: editando ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify(cuerpo),
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409 && (data.mensaje || '').includes('ya no existe')) await cargarSalas();
      throw new Error(data.mensaje || 'No se pudo apartar la sala.');
    }

    if (editando) cancelarEdicionApartado(); else {
      DIAS_SELECCIONADOS = [];
      pintarDiasLista();
      inputPersonas.value = '';
      inputDescripcion.value = '';
      inputOficio.value = '';
      inputPrestamo.value = '';
      await cargarProximoFolioNota(); // el próximo sugerido sale del que se acaba de usar
    }

    await cargarApartados();
    ocultarCargando(); // antes de mostrar el aviso de éxito, para que no se amontonen las dos ventanas

    // El servidor ya esperó a que el PDF estuviera listo antes de
    // responder (ver POST /api/salas/apartados), así que aquí data ya
    // trae nota_pdf_url si todo salió bien.
    const notaMsg = !editando
      ? (data.nota_pdf_url
          ? ` Nota ${data.folio_nota} generada.`
          : (data.folio_nota ? ` Nota ${data.folio_nota} asignada, pero el PDF no se generó${data.nota_error ? ' — ' + data.nota_error : ''} Abre la tarjeta y pulsa «Reintentar generar PDF».` : ''))
      : '';
    await sbisAlert({
      titulo: editando ? 'Apartado actualizado' : 'Sala apartada',
      mensaje: `${data.sala_nombre} — ${textoDias(fechasParaMensaje)} de ${hora_inicio} a ${hora_fin}.${notaMsg}`,
      tipo: 'success',
    });
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    ocultarCargando();
  }
}

/* Carga un apartado existente en el panel "Apartar Sala" para editarlo.
   El panel cambia de título/botón mientras dura la edición. */
function editarApartado(id) {
  const ap = APARTADOS.find(a => a.id === id);
  if (!ap) return;

  EDITANDO_ID = id;
  EDITANDO_IDS = ap.ids;
  const varios = ap.ids.length > 1;
  // Una tarjeta de varios días se edita como un todo (sala, horario, personas,
  // descripción…); cada día conserva su fecha. Para cambiar los días hay que
  // cancelarla y crearla de nuevo.
  const bloque = document.getElementById('bloque-fechas');
  bloque.classList.toggle('modo-una-fecha', !varios);
  bloque.style.display = varios ? 'none' : '';
  const aviso = document.getElementById('aviso-edicion-grupo');
  aviso.style.display = varios ? '' : 'none';
  aviso.textContent = varios
    ? `Este apartado abarca ${ap.ids.length} días (${textoDias(ap.fechas)}). Los cambios de sala, horario y datos se aplican a todos los días. Para cambiar los días, cancélalo y créalo de nuevo.`
    : '';
  document.getElementById('select-sala').value = ap.sala_id;
  document.getElementById('input-fecha-apartado').value = ap.fechas[0];
  document.getElementById('input-hora-inicio-apartado').value = ap.hora_inicio.slice(0, 5);
  document.getElementById('input-hora-fin-apartado').value = ap.hora_fin.slice(0, 5);
  document.getElementById('input-personas-apartado').value = ap.personas;
  document.getElementById('input-descripcion-apartado').value = ap.descripcion || '';
  document.getElementById('input-oficio-apartado').value = ap.no_oficio || '';
  document.getElementById('input-prestamo-apartado').value = ap.prestamo || '';
  document.getElementById('error-apartar-sala').textContent = '';

  document.getElementById('titulo-panel-apartar').innerHTML = '<i class="ti ti-pencil"></i> Editar Apartado';
  document.getElementById('btn-apartar-sala').innerHTML = '<i class="ti ti-check"></i> Guardar cambios';
  document.getElementById('btn-cancelar-edicion').style.display = 'inline-flex';
  // El folio de una Nota ya generada no se toca al editar — se oculta
  // la tarjetita para no dar a entender que se puede cambiar aquí.
  const tarjetaFolio = document.querySelector('.tarjeta-folio-nota');
  if (tarjetaFolio) tarjetaFolio.style.display = 'none';

  document.getElementById('titulo-panel-apartar').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelarEdicionApartado() {
  EDITANDO_ID = null;
  EDITANDO_IDS = [];
  const bloque = document.getElementById('bloque-fechas');
  bloque.classList.remove('modo-una-fecha');
  bloque.style.display = '';
  document.getElementById('aviso-edicion-grupo').style.display = 'none';
  document.getElementById('input-fecha-apartado').value = '';
  document.getElementById('input-fecha-fin-apartado').value = '';
  document.getElementById('titulo-panel-apartar').innerHTML = '<i class="ti ti-calendar-plus"></i> Apartar Sala';
  document.getElementById('btn-apartar-sala').innerHTML = '<i class="ti ti-check"></i> Apartar sala';
  document.getElementById('btn-cancelar-edicion').style.display = 'none';
  document.getElementById('error-apartar-sala').textContent = '';
  document.getElementById('input-personas-apartado').value = '';
  document.getElementById('input-descripcion-apartado').value = '';
  document.getElementById('input-oficio-apartado').value = '';
  document.getElementById('input-prestamo-apartado').value = '';
  const tarjetaFolio = document.querySelector('.tarjeta-folio-nota');
  if (tarjetaFolio) tarjetaFolio.style.display = '';
}

/* Quita una tarjeta del tendedero. Si ya venció (ya pasó su hora de
   fin), se quita directo, sin alerta. Si todavía está por venir, se
   pide confirmación antes de cancelarla. En ambos casos el servidor
   deja registro en el historial. */
async function descartarApartado(id) {
  const ap = APARTADOS.find(a => a.id === id);
  const vencido = ap ? momentoFinApartado(ap) < new Date() : false;

  const varios = (ap?.ids?.length ?? 1) > 1;

  if (!vencido) {
    const ok = await sbisConfirm({
      titulo: '¿Cancelar este apartado?',
      mensaje: varios
        ? `Este apartado abarca ${ap.ids.length} días (${textoDias(ap.fechas)}) y aún no termina. Se cancelarán todos y la sala quedará libre en ese horario otra vez.`
        : 'Todavía no pasa la fecha y hora de este apartado. La sala quedará libre en ese horario otra vez.',
      btnOk: 'Cancelar apartado',
      tipo: 'danger',
    });
    if (!ok) return;
  }

  const tarjeta = document.querySelector(`.ticket[data-id="${id}"]`);
  try {
    // Una tarjeta de varios días se quita completa, en una sola operación
    const res = varios
      ? await fetch(`${API}/salas/apartados/eliminar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
          body: JSON.stringify({ ids: ap.ids }),
        })
      : await fetch(`${API}/salas/apartados/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${TOKEN}` },
        });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo quitar la tarjeta.');

    if (tarjeta) {
      tarjeta.classList.add('fade-out');
      setTimeout(() => tarjeta.remove(), 300);
    }
    APARTADOS = APARTADOS.filter(a => a.id !== id);
    if (EDITANDO_ID === id) cancelarEdicionApartado();
    cargarHistorial();
  } catch (err) {
    await sbisAlert({ titulo: 'Error', mensaje: err.message, tipo: 'error' });
  }
}

function formatearFechaCorta(fechaISOStr) {
  const [a, m, d] = fechaISOStr.split('-');
  return `${d}/${m}/${a}`;
}

/* ════════════════════════════════════════════════════
   Historial de tarjetas eliminadas
   ════════════════════════════════════════════════════ */
async function cargarHistorial() {
  const tbody = document.getElementById('historial-tbody');
  if (!tbody) return;
  try {
    const res = await fetch(`${API}/salas/historial`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al cargar el historial.');

    tbody.innerHTML = data.length
      ? data.map(h => `
        <tr>
          <td>${h.sala_nombre}</td>
          <td>${formatearFechaCorta(h.fecha.slice(0, 10))}</td>
          <td>${h.hora_inicio.slice(0, 5)} - ${h.hora_fin.slice(0, 5)}</td>
          <td>${h.personas ?? '—'}</td>
          <td>${h.descripcion || '—'}</td>
          <td>${h.no_oficio || '—'}</td>
          <td>${h.folio_nota ? (h.nota_pdf_url ? `<a href="${h.nota_pdf_url}" target="_blank" rel="noopener">Nota ${h.folio_nota}</a>` : `Nota ${h.folio_nota}`) : '—'}</td>
          <td>${h.creado_por || '—'}</td>
          <td><span class="badge-motivo ${h.motivo_eliminacion}">${{ vencido: 'Vencido', cancelado: 'Cancelado', sala_eliminada: 'Sala eliminada' }[h.motivo_eliminacion] || h.motivo_eliminacion}</span></td>
          <td>${h.eliminado_por || '—'}</td>
          <td>${new Date(h.eliminado_en).toLocaleString('es-MX')}</td>
          <td><button class="btn-historial-borrar" title="Eliminar registro" onclick="eliminarHistorial(${h.id})"><i class="ti ti-trash"></i></button></td>
        </tr>`).join('')
      : '<tr><td colspan="12" style="text-align:center; color:#b7aeb2;">Sin movimientos todavía.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color:#c62828;">${err.message}</td></tr>`;
  }
}

async function eliminarHistorial(id) {
  const ok = await sbisConfirm({
    titulo: '¿Eliminar este registro del historial?',
    mensaje: 'Esta acción no se puede deshacer.',
    btnOk: 'Eliminar registro',
    tipo: 'danger',
  });
  if (!ok) return;

  try {
    const res = await fetch(`${API}/salas/historial/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo eliminar el registro.');
    await cargarHistorial();
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

  const inputFecha = document.getElementById('input-fecha-apartado');
  if (inputFecha) inputFecha.value = fechaISO(new Date());

  cargarSalas();
  cargarApartados();
  cargarHistorial();
  cargarProximoFolioNota();
});

/* ════════════════════════════════════════════════════
   Tarjetita "Próximo número de tarjeta" (folio de la Nota)
   ════════════════════════════════════════════════════ */
let FOLIOS_NOTA_USADOS = [];

/* Trae la sugerencia (último folio existente + 1) y la lista de folios
   ya usados, y la deja lista en el input. Se llama al cargar la página
   y otra vez después de apartar una sala (para que la sugerencia
   avance al número que realmente se usó, sea el automático o uno que
   la persona haya escrito a mano). */
async function cargarProximoFolioNota() {
  const input = document.getElementById('input-folio-nota');
  if (!input) return;
  try {
    const res = await fetch(`${API}/salas/proximo-folio-nota`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    input.value = data.siguiente;
    FOLIOS_NOTA_USADOS = data.usados || [];
    revisarFolioNotaDuplicado();
  } catch { /* si falla, el input se queda con lo último que tenía */ }
}

/* Normaliza igual que el backend (rellena a 4 dígitos si es solo
   número) para comparar como corresponde contra FOLIOS_NOTA_USADOS. */
function normalizarFolioNotaCliente(valor) {
  const t = (valor || '').trim();
  if (!t) return '';
  return /^\d+$/.test(t) ? t.padStart(4, '0') : t;
}

function revisarFolioNotaDuplicado() {
  const input = document.getElementById('input-folio-nota');
  const aviso = document.getElementById('aviso-folio-nota-duplicado');
  if (!input || !aviso) return;
  const valor = normalizarFolioNotaCliente(input.value);
  const repetido = valor && FOLIOS_NOTA_USADOS.includes(valor);
  aviso.style.display = repetido ? 'flex' : 'none';
}

window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) verificarAcceso();
});
