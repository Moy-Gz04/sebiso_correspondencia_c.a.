/* ═══════════════════════════════════════════════════
   SBIS — Rúbrica
   Historial de documentos para rúbrica:
     1) se toma la foto del documento y la IA lee los mismos datos que en el
        Registro Automático (F. Oficio, F. Sello, número, remitente,
        dependencia y descripción);
     2) la persona los revisa o corrige y lo guarda;
     3) queda en la tabla del historial, con la foto como su documento,
        que se abre igual que en la tabla de Salas.
   Exclusivo de Coordinación Administrativa (y admin).
   ═══════════════════════════════════════════════════ */
const API = window.location.origin + '/api';
let TOKEN = localStorage.getItem('sbis_token');
let USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');
const AREA_CON_GESTION_COMPLETA = 'Coordinación Administrativa';
const tieneGestionCompleta = (u) => u?.rol === 'admin' || (u?.rol === 'area' && u?.area === AREA_CON_GESTION_COMPLETA);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CAMPOS = ['f_oficio', 'f_sello', 'numero', 'remitente', 'dependencia', 'descripcion'];
let HISTORIAL = [];

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
      c.toBlob(b => ok(b ? new File([b], (archivo.name || 'rubrica').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : archivo), 'image/jpeg', calidad);
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

/* ── Captura ── */
const lista = () => document.getElementById('turnos-lista');
function actualizarVacio() { document.getElementById('turnos-vacio').hidden = !!lista().querySelector('.turno-tarjeta'); }
const campo = (t, n) => t.querySelector(`[name="${n}"]`);

/* No se permiten dos rúbricas con el mismo No. de Oficio: se revisa al leer
   la foto y mientras se escribe; si ya existe, avisa en la tarjeta y con
   MiniSEBISO, y no deja guardar (el servidor también lo bloquea). */
const sinNumero = (n) => { const c = String(n || '').replace(/\s+/g, '').toUpperCase(); return !c || c === 'SN' || c === 'S/N'; };
function avisarDuplicado(existente) {
  const M = window.MiniSEBISO;
  if (M?.decir && !M.apagado) M.decir(`¡Ojo! El oficio ${existente.numero} ya está registrado en Rúbrica. No se puede guardar dos veces.`, { duracion: 9000 });
}
async function revisarDuplicado(t, { avisar = true } = {}) {
  const numero = campo(t, 'numero').value.trim();
  const aviso = t.querySelector('.turno-duplicado');
  t._duplicado = null;
  if (!sinNumero(numero)) {
    try {
      const { existente } = await api('/rubricas/existe?numero=' + encodeURIComponent(numero));
      // Para no cruzar respuestas: solo cuenta si el número no cambió mientras tanto
      if (existente && campo(t, 'numero').value.trim() === numero) t._duplicado = existente;
    } catch (e) { /* si falla la revisión, el servidor igual lo bloquea al guardar */ }
  }
  aviso.hidden = !t._duplicado;
  if (t._duplicado) {
    const d = t._duplicado;
    aviso.innerHTML = `<i class="ti ti-alert-triangle"></i> Ya existe una rúbrica con el No. de Oficio <b>${esc(d.numero)}</b> (${esc(d.remitente || 'sin remitente')}, registrada el ${new Date(d.created_at).toLocaleDateString('es-MX')}). Revisa el número.`;
    if (avisar && t._avisado !== numero) { t._avisado = numero; avisarDuplicado(d); }
  }
  validar(t);
}

function validar(t) {
  const listo = campo(t, 'f_oficio').value && campo(t, 'remitente').value.trim() && !t.classList.contains('leyendo') && !t._duplicado;
  campo(t, 'numero').classList.toggle('falta', !!t._duplicado);
  t.querySelector('.turno-registrar').disabled = !listo;
  ['f_oficio', 'remitente'].forEach(n => campo(t, n).classList.toggle('falta', !campo(t, n).value.trim()));
}

async function leer(t) {
  t.classList.add('leyendo');
  t.querySelector('.turno-leyendo').hidden = false;
  validar(t);
  try {
    const fd = new FormData(); fd.append('imagen', t._archivo);
    const { datos, mensaje } = await api('/rubricas/leer', { method: 'POST', body: fd });
    CAMPOS.forEach(n => { if (datos[n]) campo(t, n).value = datos[n]; });
    t.querySelector('.turno-nota').innerHTML = mensaje
      ? `<i class="ti ti-eye-off"></i> ${esc(mensaje)}`
      : '<i class="ti ti-sparkles"></i> Datos leídos de la foto. Revísalos antes de guardar.';
  } catch (e) {
    t.querySelector('.turno-nota').innerHTML = `<i class="ti ti-alert-circle"></i> ${esc(e.message)}`;
  } finally {
    t.classList.remove('leyendo');
    t.querySelector('.turno-leyendo').hidden = true;
    revisarDuplicado(t);
  }
}

async function guardar(t) {
  const numero = campo(t, 'numero').value.trim();
  const M = window.MiniSEBISO;
  const pregunta = '¿Guardar este documento en el historial de Rúbrica?';
  const ok = M?.preguntar && !M.apagado
    ? await M.preguntar({ titulo: '¡Hola!', pregunta, detalle: numero ? `Oficio ${numero}` : '', btnOk: 'Guardar', iconoOk: 'ti-circle-check', estiloOk: 'dorado', saludoOk: '¡Va!', textoOk: 'Lo guardo ahora mismo…' })
    : window.confirm(pregunta);
  if (!ok) return;
  const btn = t.querySelector('.turno-registrar');
  btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 girando"></i> Guardando…';
  try {
    const fd = new FormData();
    CAMPOS.forEach(k => fd.append(k, campo(t, k).value.trim()));
    const nombre = `Rubrica_${(numero || 'SN').replace(/[^\w-]+/g, '-')}.jpg`;
    fd.append('documento', t._archivo, nombre);
    const nueva = await api('/rubricas', { method: 'POST', body: fd });
    t.classList.add('hecha');
    t.querySelectorAll('input, textarea').forEach(el => el.disabled = true);
    t.querySelector('.turno-acciones').innerHTML = `<span class="turno-listo"><i class="ti ti-circle-check"></i> Guardado en el historial</span>
      <button type="button" class="turno-quitar-btn">Quitar de la lista</button>`;
    t.querySelector('.turno-quitar-btn').onclick = () => { t.remove(); actualizarVacio(); };
    HISTORIAL.unshift(nueva); pintarHistorial();
    setTimeout(cargarHistorial, 8000); // para ver el documento ya subido a Drive
  } catch (e) {
    btn.innerHTML = '<i class="ti ti-circle-check"></i> Guardar en Rúbrica';
    if (e.datos?.existente) { t._avisado = null; await revisarDuplicado(t); return; }
    validar(t);
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
      <div class="turno-foto"><img src="${url}" alt="Foto del documento"><button type="button" class="turno-quitar" title="Quitar foto" aria-label="Quitar foto"><i class="ti ti-x"></i></button></div>
      <div class="turno-datos">
        <div class="turno-leyendo" hidden><i class="ti ti-loader-2 girando"></i> Leyendo los datos de la foto…</div>
        <div class="turno-nota"></div>
        <div class="turno-form">
          <label class="tf"><span>F. Oficio *</span><input name="f_oficio" type="date"></label>
          <label class="tf"><span>F. Sello</span><input name="f_sello" type="date"></label>
          <label class="tf"><span># Número de oficio</span><input name="numero" autocomplete="off" placeholder="Ej. DGA/112/2026"></label>
          <label class="tf tf-ancho"><span>Remitente *</span><input name="remitente" autocomplete="off" placeholder="Nombre y cargo de quien firma"></label>
          <label class="tf"><span>Dependencia</span><input name="dependencia" autocomplete="off" placeholder="Dependencia de origen"></label>
          <label class="tf tf-todo"><span>Descripción</span><textarea name="descripcion" rows="2" placeholder="Asunto del documento"></textarea></label>
        </div>
        <div class="turno-duplicado turno-aviso alerta" hidden></div>
        <div class="turno-acciones">
          <button type="button" class="turno-registrar" disabled><i class="ti ti-circle-check"></i> Guardar en Rúbrica</button>
        </div>
      </div>`;
    t._archivo = archivo;
    lista().prepend(t);
    t.querySelector('.turno-quitar').onclick = () => { URL.revokeObjectURL(url); t.remove(); actualizarVacio(); };
    t.querySelector('.turno-registrar').onclick = () => guardar(t);
    t.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', () => validar(t)));
    let espera;
    campo(t, 'numero').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => revisarDuplicado(t), 450); });
    actualizarVacio();
    leer(t);
  }
}

/* ── Historial ── */
const fechaCorta = (f) => {
  if (!f) return '—';
  const [a, m, d] = String(f).slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : esc(f);
};

function celdaDocumento(r) {
  if (r.doc === 'listo') return `<button type="button" class="hist-tarjeta" onclick="verDocumento(${r.id}, this)" title="Abrir el documento"><i class="ti ti-file-description"></i> Ver documento</button>`;
  if (r.doc === 'subiendo') return '<span class="hist-tarjeta apagada"><i class="ti ti-loader-2 girando"></i> Subiendo…</span>';
  if (r.doc === 'error') return '<span class="hist-tarjeta error"><i class="ti ti-alert-triangle"></i> Sin documento</span>';
  return '—';
}

function pintarHistorial() {
  const tbody = document.getElementById('rub-tbody');
  const q = document.getElementById('rub-buscar').value.trim().toLowerCase();
  const filas = q
    ? HISTORIAL.filter(r => [r.numero, r.remitente, r.dependencia, r.descripcion, r.creado_por].some(v => String(v || '').toLowerCase().includes(q)))
    : HISTORIAL;
  document.getElementById('rub-total').textContent = HISTORIAL.length
    ? ` · ${HISTORIAL.length} ${HISTORIAL.length === 1 ? 'documento' : 'documentos'}${q ? ` · ${filas.length} coinciden` : ''}`
    : '';
  tbody.innerHTML = filas.length
    ? filas.map(r => `
      <tr>
        <td>${fechaCorta(r.f_oficio)}</td>
        <td>${fechaCorta(r.f_sello)}</td>
        <td><span class="rub-num">${esc(r.numero || '—')}</span></td>
        <td>${esc(r.remitente || '—')}</td>
        <td>${esc(r.dependencia || '—')}</td>
        <td class="desc">${esc(r.descripcion || '—')}</td>
        <td>${celdaDocumento(r)}</td>
        <td>${esc(r.creado_por || '—')}</td>
        <td>${new Date(r.created_at).toLocaleString('es-MX')}</td>
        <td><button class="btn-historial-borrar" title="Eliminar registro" onclick="eliminarRubrica(${r.id})"><i class="ti ti-trash"></i></button></td>
      </tr>`).join('')
    : `<tr><td colspan="10" style="text-align:center; color:#b7aeb2;">${q ? 'Ningún documento coincide con la búsqueda.' : 'Sin documentos todavía.'}</td></tr>`;
}

async function cargarHistorial() {
  try {
    HISTORIAL = await api('/rubricas');
    pintarHistorial();
    // Si hay documentos subiendo a Drive, vuelve a revisar en un momento
    if (HISTORIAL.some(r => r.doc === 'subiendo')) { clearTimeout(cargarHistorial.t); cargarHistorial.t = setTimeout(cargarHistorial, 10000); }
  } catch (e) {
    document.getElementById('rub-tbody').innerHTML = `<tr><td colspan="10" style="text-align:center; color:#c62828;">${esc(e.message)}</td></tr>`;
  }
}

/* Abre el documento en otra pestaña (como en la tabla de Salas). La pestaña
   se abre al instante, dentro del clic, para que el navegador no la bloquee. */
async function verDocumento(id, btn) {
  const pestaña = window.open('', '_blank');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 girando"></i> Abriendo…'; }
  try {
    const { url } = await api(`/rubricas/${id}/doc-token`);
    if (pestaña) pestaña.location.href = url; else window.location.href = url;
  } catch (e) {
    if (pestaña) pestaña.close();
    window.alert(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-file-description"></i> Ver documento'; }
  }
}
window.verDocumento = verDocumento;

async function eliminarRubrica(id) {
  const r = HISTORIAL.find(x => x.id === id);
  const M = window.MiniSEBISO;
  const pregunta = '¿Eliminar este registro del historial de Rúbrica?';
  const ok = M?.preguntar && !M.apagado
    ? await M.preguntar({ titulo: 'Eliminar', pregunta, detalle: r?.numero ? `Oficio ${r.numero}` : '', btnOk: 'Eliminar', iconoOk: 'ti-trash' })
    : window.confirm(pregunta);
  if (!ok) return;
  try {
    await api(`/rubricas/${id}`, { method: 'DELETE' });
    HISTORIAL = HISTORIAL.filter(x => x.id !== id);
    pintarHistorial();
  } catch (e) { window.alert(e.message); }
}
window.eliminarRubrica = eliminarRubrica;

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
  document.getElementById('rub-buscar').addEventListener('input', pintarHistorial);
  actualizarVacio();
  cargarHistorial();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) verificarAcceso(); });
