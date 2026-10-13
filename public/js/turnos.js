/* ═══════════════════════════════════════════════════
   SBIS — Captura de Turnos
   Se fotografía el Turno de un oficio (junto al sello viene escrito
   «T-número», que es su N. de control). Por cada foto:
     1) la IA lee el número y se busca el oficio;
     2) se muestra el oficio encontrado (el número se puede corregir);
     3) al confirmar, la foto se guarda como documento de Turno y el
        oficio pasa directo a «Completado».
   Exclusivo de Coordinación Administrativa (y admin).
   ═══════════════════════════════════════════════════ */
const API = window.location.origin + '/api';
let TOKEN = localStorage.getItem('sbis_token');
let USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');
const AREA_CON_GESTION_COMPLETA = 'Coordinación Administrativa';
const tieneGestionCompleta = (u) => u?.rol === 'admin' || (u?.rol === 'area' && u?.area === AREA_CON_GESTION_COMPLETA);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function verificarAcceso() {
  TOKEN = localStorage.getItem('sbis_token');
  USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');
  if (!TOKEN || (USUARIO?.rol !== 'admin' && USUARIO?.rol !== 'area')) { window.location.href = '/login'; return false; }
  if (!tieneGestionCompleta(USUARIO)) { window.location.href = '/area'; return false; }
  return true;
}
function cerrarSesion() {
  localStorage.removeItem('sbis_token');
  localStorage.removeItem('sbis_usuario');
  window.location.href = '/login';
}
window.cerrarSesion = cerrarSesion;

const ESTATUS = {
  por_turnar: 'Por turnar', turnado: 'Turnado', sub_turnado: 'Subturnado',
  atendido: 'Atendido', rechazado: 'Por corregir', completado: 'Completado',
};

/* Reduce la foto en el navegador antes de subirla (más rápida y ligera) */
function reducirImagen(archivo, max = 1800, calidad = 0.85) {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => ok(b ? new File([b], (archivo.name || 'turno').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : archivo), 'image/jpeg', calidad);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => ok(archivo);
    img.src = URL.createObjectURL(archivo);
  });
}

async function api(ruta, opciones = {}) {
  const r = await fetch(API + ruta, { ...opciones, headers: { Authorization: 'Bearer ' + TOKEN, ...(opciones.headers || {}) } });
  let d = {}; try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
  if (r.status === 401) { cerrarSesion(); throw new Error('Tu sesión venció.'); }
  if (!r.ok) throw new Error(d.mensaje || 'Error del servidor.');
  return d;
}

/* ── Cada foto es una tarjeta con su propio estado ── */
const lista = () => document.getElementById('turnos-lista');
function actualizarVacio() {
  document.getElementById('turnos-vacio').hidden = !!lista().querySelector('.turno-tarjeta');
}

function pintarOficio(tarjeta, oficio, lectura) {
  const caja = tarjeta.querySelector('.turno-oficio');
  const btn = tarjeta.querySelector('.turno-asignar');
  tarjeta._oficio = oficio;
  if (!oficio) {
    caja.innerHTML = `<div class="turno-sin"><i class="ti ti-search-off"></i> No se encontró ningún oficio con ese número de control. Revisa el número y presiona <b>Buscar</b>.</div>`;
    btn.disabled = true;
    return;
  }
  const ya = oficio.estatus === 'completado';
  caja.innerHTML = `
    <div class="turno-oficio-cab">
      <span class="turno-control">N. control <b>${esc(oficio.n_control)}</b></span>
      <span class="turno-estatus e-${esc(oficio.estatus)}">${esc(ESTATUS[oficio.estatus] || oficio.estatus)}</span>
    </div>
    <dl>
      <dt>Número de oficio</dt><dd>${esc(oficio.numero || '—')}</dd>
      <dt>Remitente</dt><dd>${esc(oficio.remitente || '—')}</dd>
      <dt>Turnado a</dt><dd>${esc(oficio.turnado_a || 'Sin turnar')}</dd>
      ${oficio.descripcion ? `<dt>Asunto</dt><dd class="turno-asunto">${esc(oficio.descripcion)}</dd>` : ''}
    </dl>
    ${oficio.tiene_turno ? '<p class="turno-aviso"><i class="ti ti-info-circle"></i> Este oficio ya tiene un documento de Turno; se reemplazará por esta foto.</p>' : ''}
    ${ya ? '<p class="turno-aviso"><i class="ti ti-circle-check"></i> Este oficio ya está completado.</p>' : ''}
    ${lectura?.numero_oficio && oficio.numero && !mismoNumero(lectura.numero_oficio, oficio.numero)
      ? `<p class="turno-aviso alerta"><i class="ti ti-alert-triangle"></i> En la foto se lee el oficio «${esc(lectura.numero_oficio)}», que no coincide con el de este registro. Verifica el número de Turno.</p>` : ''}`;
  btn.disabled = false;
}
const mismoNumero = (a, b) => String(a).replace(/\W/g, '').toUpperCase() === String(b).replace(/\W/g, '').toUpperCase();

async function identificar(tarjeta) {
  const estado = tarjeta.querySelector('.turno-leyendo');
  estado.hidden = false;
  tarjeta.querySelector('.turno-oficio').innerHTML = '';
  try {
    const fd = new FormData(); fd.append('imagen', tarjeta._archivo);
    const d = await api('/turnos/identificar', { method: 'POST', body: fd });
    tarjeta.querySelector('.turno-numero').value = d.lectura?.turno || '';
    if (!d.lectura?.turno) {
      tarjeta.querySelector('.turno-oficio').innerHTML = `<div class="turno-sin"><i class="ti ti-eye-off"></i> ${esc(d.mensaje || 'No se alcanzó a leer el número de Turno (T-…). Escríbelo y presiona Buscar.')}</div>`;
      tarjeta.querySelector('.turno-numero').focus();
    } else pintarOficio(tarjeta, d.oficio, d.lectura);
    tarjeta._lectura = d.lectura;
  } catch (e) {
    tarjeta.querySelector('.turno-oficio').innerHTML = `<div class="turno-sin"><i class="ti ti-alert-circle"></i> ${esc(e.message)}</div>`;
  } finally { estado.hidden = true; }
}

async function buscar(tarjeta) {
  const n = tarjeta.querySelector('.turno-numero').value.replace(/\D/g, '');
  if (!n) { tarjeta.querySelector('.turno-numero').focus(); return; }
  try { const d = await api('/turnos/buscar/' + n); pintarOficio(tarjeta, d.oficio, tarjeta._lectura); }
  catch (e) { tarjeta.querySelector('.turno-oficio').innerHTML = `<div class="turno-sin">${esc(e.message)}</div>`; }
}

async function asignar(tarjeta) {
  const o = tarjeta._oficio; if (!o) return;
  const M = window.MiniSEBISO;
  const pregunta = `¿Asignar este Turno al oficio con N. de control ${o.n_control} y marcarlo como Completado?`;
  const ok = M?.preguntar && !M.apagado
    ? await M.preguntar({ titulo: '¡Hola!', pregunta, detalle: o.numero ? `Oficio ${o.numero}` : '', btnOk: 'Asignar y completar', iconoOk: 'ti-circle-check', estiloOk: 'dorado', saludoOk: '¡Va!', textoOk: 'Lo asigno ahora mismo…' })
    : window.confirm(pregunta);
  if (!ok) return;
  const btn = tarjeta.querySelector('.turno-asignar');
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 girando"></i> Guardando…';
  try {
    const fd = new FormData(); fd.append('doc3', tarjeta._archivo, `Turno_${o.n_control}.jpg`);
    await api(`/turnos/${o.id}/asignar`, { method: 'POST', body: fd });
    tarjeta.classList.add('hecha');
    tarjeta.querySelector('.turno-acciones').innerHTML = `<span class="turno-listo"><i class="ti ti-circle-check"></i> Turno asignado · oficio ${esc(o.n_control)} completado</span>
      <button type="button" class="turno-quitar-btn">Quitar de la lista</button>`;
    tarjeta.querySelector('.turno-quitar-btn').onclick = () => { tarjeta.remove(); actualizarVacio(); };
    tarjeta.querySelector('.turno-numero').disabled = true;
  } catch (e) {
    btn.disabled = false; btn.innerHTML = '<i class="ti ti-circle-check"></i> Asignar y completar';
    window.alert(e.message);
  }
}

async function agregarFotos(archivos) {
  for (const original of archivos) {
    if (!original.type.startsWith('image/')) continue;
    const archivo = await reducirImagen(original);
    const t = document.createElement('article');
    t.className = 'turno-tarjeta';
    const url = URL.createObjectURL(archivo);
    t.innerHTML = `
      <div class="turno-foto"><img src="${url}" alt="Foto del Turno"><button type="button" class="turno-quitar" title="Quitar foto" aria-label="Quitar foto"><i class="ti ti-x"></i></button></div>
      <div class="turno-datos">
        <label class="turno-campo">
          <span>Número de Turno (T-…)</span>
          <span class="turno-num-fila">
            <span class="turno-t">T-</span>
            <input type="text" inputmode="numeric" class="turno-numero" autocomplete="off" placeholder="Ej. 6026">
            <button type="button" class="turno-buscar"><i class="ti ti-search"></i> Buscar</button>
          </span>
        </label>
        <div class="turno-leyendo" hidden><i class="ti ti-loader-2 girando"></i> Leyendo el número de Turno…</div>
        <div class="turno-oficio"></div>
        <div class="turno-acciones">
          <button type="button" class="turno-asignar" disabled><i class="ti ti-circle-check"></i> Asignar y completar</button>
        </div>
      </div>`;
    t._archivo = archivo;
    lista().prepend(t);
    t.querySelector('.turno-quitar').onclick = () => { URL.revokeObjectURL(url); t.remove(); actualizarVacio(); };
    t.querySelector('.turno-buscar').onclick = () => buscar(t);
    t.querySelector('.turno-numero').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(t); } });
    t.querySelector('.turno-asignar').onclick = () => asignar(t);
    actualizarVacio();
    identificar(t);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!verificarAcceso()) return;
  const fecha = document.getElementById('header-fecha');
  if (fecha) { const h = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); fecha.textContent = h.charAt(0).toUpperCase() + h.slice(1); }
  const yo = document.getElementById('header-usuario');
  if (yo) yo.innerHTML = `<i class="ti ti-user-circle"></i> ${esc(USUARIO?.nombre || USUARIO?.username || '')}`;

  const camara = document.getElementById('turnos-camara');
  const galeria = document.getElementById('turnos-galeria');
  document.getElementById('btn-turnos-camara').onclick = () => camara.click();
  document.getElementById('btn-turnos-galeria').onclick = () => galeria.click();
  [camara, galeria].forEach(inp => inp.addEventListener('change', () => { agregarFotos([...inp.files]); inp.value = ''; }));

  // También se pueden arrastrar fotos a la zona
  const zona = document.getElementById('turnos-zona');
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastrando'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('arrastrando'));
  zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('arrastrando'); agregarFotos([...e.dataTransfer.files]); });
  actualizarVacio();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) verificarAcceso(); });
