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
  return new Date(`${ap.fecha.slice(0, 10)}T${ap.hora_fin.slice(0, 5)}:00`);
}

let SALAS = [];
let APARTADOS = [];
let EDITANDO_ID = null;

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
    APARTADOS = data;
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
    const fecha = ap.fecha.slice(0, 10);
    return `
      <div class="ticket ${COLORES_TICKET[i % COLORES_TICKET.length]}" data-id="${ap.id}" data-vencido="${vencido}" onclick="verDetalleTicket(${ap.id})">
        <button class="ticket-close" title="Quitar tarjeta" onclick="event.stopPropagation(); descartarApartado(${ap.id})">✕</button>
        <button class="ticket-edit" title="Editar apartado" onclick="event.stopPropagation(); editarApartado(${ap.id})"><i class="ti ti-pencil"></i></button>
        <div class="ticket-title">${ap.sala_nombre}</div>
        <div class="ticket-info"><i class="ti ti-clock"></i> ${formatearFechaCorta(fecha)} — ${ap.hora_inicio.slice(0, 5)} a ${ap.hora_fin.slice(0, 5)}</div>
        <div class="ticket-info"><i class="ti ti-users"></i> ${ap.personas} persona${ap.personas === 1 ? '' : 's'}</div>
        <div class="ticket-info"><i class="ti ti-align-left"></i> ${ap.descripcion || 'Sin descripción'}</div>
        ${ap.no_oficio ? `<div class="ticket-info"><i class="ti ti-file-text"></i> ${ap.no_oficio}</div>` : ''}
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
      <div class="nota-card-sinpdf"><i class="ti ti-alert-circle"></i> El PDF no se pudo generar automáticamente — contacta a soporte.</div>`;
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
  document.getElementById('detalle-fechahora').textContent = `${formatearFechaCorta(ap.fecha.slice(0, 10))} — ${ap.hora_inicio.slice(0, 5)} a ${ap.hora_fin.slice(0, 5)}`;
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

  const sala_id = selectSala.value;
  const fecha   = inputFecha.value;
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
  if (!fecha)        { errorEl.textContent = 'Selecciona una fecha.'; return; }
  if (!hora_inicio)  { errorEl.textContent = 'Selecciona la hora de inicio.'; return; }
  if (!hora_fin)     { errorEl.textContent = 'Selecciona la hora de fin.'; return; }
  if (hora_fin <= hora_inicio) { errorEl.textContent = 'La hora de fin debe ser posterior a la de inicio.'; return; }
  if (!Number.isInteger(personas) || personas < 1) { errorEl.textContent = 'Indica cuántas personas ocuparán la sala.'; return; }
  if (!descripcion) { errorEl.textContent = 'Describe brevemente el evento.'; return; }

  const editando = EDITANDO_ID !== null;
  btn.disabled = true;
  mostrarCargando(
    editando ? 'Guardando cambios…' : 'Apartando sala…',
    editando ? 'Un momento, por favor.' : 'Generando la Nota (PDF). Esto puede tardar unos segundos.'
  );
  try {
    const res = await fetch(`${API}/salas/apartados${editando ? '/' + EDITANDO_ID : ''}`, {
      method: editando ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ sala_id, fecha, hora_inicio, hora_fin, personas, descripcion, no_oficio, prestamo, folio_nota }),
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409 && (data.mensaje || '').includes('ya no existe')) await cargarSalas();
      throw new Error(data.mensaje || 'No se pudo apartar la sala.');
    }

    if (editando) cancelarEdicionApartado(); else {
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
          : (data.folio_nota ? ` Nota ${data.folio_nota} asignada (el PDF no se pudo generar automáticamente; contacta a soporte).` : ''))
      : '';
    await sbisAlert({
      titulo: editando ? 'Apartado actualizado' : 'Sala apartada',
      mensaje: `${data.sala_nombre} — ${formatearFechaCorta(fecha)} de ${hora_inicio} a ${hora_fin}.${notaMsg}`,
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
  document.getElementById('select-sala').value = ap.sala_id;
  document.getElementById('input-fecha-apartado').value = ap.fecha.slice(0, 10);
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

  if (!vencido) {
    const ok = await sbisConfirm({
      titulo: '¿Cancelar este apartado?',
      mensaje: 'Todavía no pasa la fecha y hora de este apartado. La sala quedará libre en ese horario otra vez.',
      btnOk: 'Cancelar apartado',
      tipo: 'danger',
    });
    if (!ok) return;
  }

  const tarjeta = document.querySelector(`.ticket[data-id="${id}"]`);
  try {
    const res = await fetch(`${API}/salas/apartados/${id}`, {
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
