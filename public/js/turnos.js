/* ═══════════════════════════════════════════════════
   SBIS — Captura de Turnos
   Cada foto de un Turno es un oficio que se REGISTRA:
     1) la IA extrae todos sus datos (como el Registro Automático) y el
        número escrito junto al sello, «T-número», que es su N. de control;
     2) se muestran en un formulario para revisarlos o corregirlos;
     3) al confirmar, se registra directo en «Completado», con la foto
        como su documento de Turno.
   Exclusivo de Coordinación Administrativa (y admin).
   ═══════════════════════════════════════════════════ */
const API = window.location.origin + '/api';
let TOKEN = localStorage.getItem('sbis_token');
let USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');
const AREA_CON_GESTION_COMPLETA = 'Coordinación Administrativa';
const tieneGestionCompleta = (u) => u?.rol === 'admin' || (u?.rol === 'area' && u?.area === AREA_CON_GESTION_COMPLETA);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const AREAS = ['R. Humanos', 'R. Financieros', 'R. Materiales', 'Informática', 'Seguimiento de Auditorías', 'Archivo', 'Coordinación Administrativa'];

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
  if (!r.ok) { const e = new Error(d.mensaje || 'Error del servidor.'); e.datos = d; throw e; }
  return d;
}

const lista = () => document.getElementById('turnos-lista');
function actualizarVacio() { document.getElementById('turnos-vacio').hidden = !!lista().querySelector('.turno-tarjeta'); }
const campo = (t, n) => t.querySelector(`[name="${n}"]`);

/* Aviso bajo el número si ese N. de control ya está registrado */
async function revisarDuplicado(t) {
  const n = campo(t, 'n_control').value.replace(/\D/g, '');
  const aviso = t.querySelector('.turno-duplicado');
  if (!n) { aviso.hidden = true; return; }
  try {
    const { existente } = await api('/turnos/existe/' + n);
    aviso.hidden = !existente;
    if (existente) aviso.innerHTML = `<i class="ti ti-alert-triangle"></i> Ya existe un oficio con el N. de control ${esc(existente.n_control)} (${esc(existente.numero || 'sin número')}). Revisa el número de Turno.`;
  } catch (e) { aviso.hidden = true; }
  validar(t);
}
function validar(t) {
  const listo = campo(t, 'n_control').value.replace(/\D/g, '') && campo(t, 'f_oficio').value && campo(t, 'remitente').value.trim()
    && t.querySelector('.turno-duplicado').hidden && !t.classList.contains('leyendo');
  t.querySelector('.turno-registrar').disabled = !listo;
  ['n_control', 'f_oficio', 'remitente'].forEach(n => campo(t, n).classList.toggle('falta', !campo(t, n).value.trim()));
}

async function leer(t) {
  t.classList.add('leyendo');
  t.querySelector('.turno-leyendo').hidden = false;
  validar(t);
  try {
    const fd = new FormData(); fd.append('imagen', t._archivo);
    const { datos, mensaje } = await api('/turnos/leer', { method: 'POST', body: fd });
    if (datos.turno) campo(t, 'n_control').value = datos.turno;
    ['f_oficio', 'f_sello', 'numero', 'remitente', 'dependencia', 'descripcion'].forEach(n => { if (datos[n]) campo(t, n).value = datos[n]; });
    if (mensaje) t.querySelector('.turno-nota').innerHTML = `<i class="ti ti-eye-off"></i> ${esc(mensaje)}`;
    else if (!datos.turno) t.querySelector('.turno-nota').innerHTML = '<i class="ti ti-eye-off"></i> No se alcanzó a leer el número de Turno (T-…). Escríbelo.';
    else t.querySelector('.turno-nota').innerHTML = '<i class="ti ti-sparkles"></i> Datos leídos de la foto. Revísalos antes de registrar.';
  } catch (e) {
    t.querySelector('.turno-nota').innerHTML = `<i class="ti ti-alert-circle"></i> ${esc(e.message)}`;
  } finally {
    t.classList.remove('leyendo');
    t.querySelector('.turno-leyendo').hidden = true;
    revisarDuplicado(t);
  }
}

/* Une las hojas de un Turno (una debajo de otra) en una sola imagen JPG */
async function unirHojas(archivos) {
  if (archivos.length === 1) return archivos[0];
  const imgs = await Promise.all(archivos.map(a => new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(a); })));
  const ancho = Math.max(...imgs.map(i => i.width));
  const alto = imgs.reduce((s, i) => s + Math.round(i.height * ancho / i.width), 0);
  const c = document.createElement('canvas'); c.width = ancho; c.height = alto;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ancho, alto);
  let y = 0;
  imgs.forEach(i => { const h = Math.round(i.height * ancho / i.width); ctx.drawImage(i, 0, y, ancho, h); y += h; URL.revokeObjectURL(i.src); });
  return new Promise(ok => c.toBlob(b => ok(new File([b], 'turno.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.85));
}

function pintarHojas(t) {
  const n = t._archivos.length;
  t.querySelector('.turno-hojas').innerHTML = t._archivos.map((a, i) => `<span class="turno-hoja">Hoja ${i + 1}${i ? ` <button type="button" data-i="${i}" title="Quitar hoja ${i + 1}" aria-label="Quitar hoja ${i + 1}"><i class="ti ti-x"></i></button>` : ''}</span>`).join('')
    + `<label class="turno-agregar-hoja"><i class="ti ti-file-plus"></i> Agregar hoja<input type="file" accept="image/*" multiple hidden></label>`;
  t.querySelector('.turno-foto img').title = n > 1 ? `${n} hojas` : '';
  t.querySelectorAll('.turno-hoja button').forEach(b => b.onclick = () => { t._archivos.splice(+b.dataset.i, 1); pintarHojas(t); });
  const inp = t.querySelector('.turno-agregar-hoja input');
  inp.onchange = async () => {
    for (const f of [...inp.files]) if (f.type.startsWith('image/')) t._archivos.push(await reducirImagen(f));
    pintarHojas(t);
  };
}

async function registrar(t) {
  const n = campo(t, 'n_control').value.replace(/\D/g, '');
  const M = window.MiniSEBISO;
  const pregunta = `¿Registrar el Turno T-${n} como oficio Completado?`;
  const ok = M?.preguntar && !M.apagado
    ? await M.preguntar({ titulo: '¡Hola!', pregunta, detalle: campo(t, 'numero').value ? `Oficio ${campo(t, 'numero').value}` : '', btnOk: 'Registrar', iconoOk: 'ti-circle-check', estiloOk: 'dorado', saludoOk: '¡Va!', textoOk: 'Lo registro ahora mismo…' })
    : window.confirm(pregunta);
  if (!ok) return;
  const btn = t.querySelector('.turno-registrar');
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 girando"></i> Registrando…';
  try {
    const fd = new FormData();
    ['n_control', 'f_oficio', 'f_sello', 'numero', 'remitente', 'dependencia', 'descripcion', 'turnado_a'].forEach(k => fd.append(k, campo(t, k).value.trim()));
    fd.append('doc3', await unirHojas(t._archivos), `Turno_T-${n}.jpg`);
    await api('/turnos/registrar', { method: 'POST', body: fd });
    t.classList.add('hecha');
    t.querySelectorAll('input, select, textarea').forEach(el => el.disabled = true);
    t.querySelector('.turno-acciones').innerHTML = `<span class="turno-listo"><i class="ti ti-circle-check"></i> Registrado: N. de control ${esc(n)} · Completado</span>
      <button type="button" class="turno-quitar-btn">Quitar de la lista</button>`;
    t.querySelector('.turno-quitar-btn').onclick = () => { t.remove(); actualizarVacio(); };
  } catch (e) {
    btn.innerHTML = '<i class="ti ti-circle-check"></i> Registrar como completado';
    if (e.datos?.existente) revisarDuplicado(t); else validar(t);
    window.alert(e.message);
  }
}

async function agregarFotos(archivos) {
  for (const original of archivos) {
    if (!original.type.startsWith('image/')) continue;
    const archivo = await reducirImagen(original);
    const url = URL.createObjectURL(archivo);
    const t = document.createElement('article');
    t.className = 'turno-tarjeta';
    t.innerHTML = `
      <div class="turno-foto"><img src="${url}" alt="Foto del Turno"><button type="button" class="turno-quitar" title="Quitar foto" aria-label="Quitar foto"><i class="ti ti-x"></i></button></div>
      <div class="turno-datos">
        <div class="turno-leyendo" hidden><i class="ti ti-loader-2 girando"></i> Leyendo los datos de la foto…</div>
        <div class="turno-nota"></div>
        <div class="turno-hojas"></div>
        <div class="turno-form">
          <label class="tf tf-control"><span>Número de Turno (N. de control)</span>
            <span class="turno-num-fila"><span class="turno-t">T-</span><input name="n_control" inputmode="numeric" autocomplete="off" placeholder="Ej. 6026"></span></label>
          <label class="tf"><span>F. Oficio *</span><input name="f_oficio" type="date"></label>
          <label class="tf"><span>F. Sello</span><input name="f_sello" type="date"></label>
          <label class="tf"><span># Número de oficio</span><input name="numero" autocomplete="off" placeholder="Ej. DGA/112/2026"></label>
          <label class="tf tf-ancho"><span>Remitente *</span><input name="remitente" autocomplete="off" placeholder="Nombre y cargo de quien firma"></label>
          <label class="tf tf-ancho"><span>Dependencia</span><input name="dependencia" autocomplete="off" placeholder="Dependencia de origen"></label>
          <label class="tf"><span>Turnado a</span><select name="turnado_a"><option value="">— Sin área —</option>${AREAS.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
          <label class="tf tf-todo"><span>Descripción</span><textarea name="descripcion" rows="2" placeholder="Asunto del oficio"></textarea></label>
        </div>
        <div class="turno-duplicado turno-aviso alerta" hidden></div>
        <div class="turno-acciones">
          <button type="button" class="turno-registrar" disabled><i class="ti ti-circle-check"></i> Registrar como completado</button>
        </div>
      </div>`;
    t._archivo = archivo;          // la 1.ª hoja es la que se lee (ahí viene el T-número)
    t._archivos = [archivo];
    pintarHojas(t);
    lista().prepend(t);
    t.querySelector('.turno-quitar').onclick = () => { URL.revokeObjectURL(url); t.remove(); actualizarVacio(); };
    t.querySelector('.turno-registrar').onclick = () => registrar(t);
    t.querySelectorAll('input, select, textarea').forEach(el => el.addEventListener('input', () => validar(t)));
    let espera;
    campo(t, 'n_control').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => revisarDuplicado(t), 400); });
    actualizarVacio();
    leer(t);
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
  const zona = document.getElementById('turnos-zona');
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastrando'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('arrastrando'));
  zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('arrastrando'); agregarFotos([...e.dataTransfer.files]); });
  actualizarVacio();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) verificarAcceso(); });
