/* ═══════════════════════════════════════════════════
   SBIS — Captura desde Celular (Registro Automático)
   Página ligera pensada para abrirse en el teléfono: toma/selecciona
   una foto del oficio y la sube. El servidor responde de inmediato
   (no espera a que Gemini termine) — el procesamiento y el llenado
   de campos pasa después, en la PC, dentro de "Registro Automático"
   (captura-auto.html/js).
   Mismo permiso que Nuevo Registro (Coordinación Administrativa).
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
  if (!TOKEN || !tieneGestionCompleta(USUARIO)) {
    window.location.href = '/login';
    return false;
  }
  return true;
}

function cerrarSesion() {
  localStorage.removeItem('sbis_token');
  localStorage.removeItem('sbis_usuario');
  window.location.href = '/login';
}

let ARCHIVO_SELECCIONADO = null;

function mostrarZonaCaptura() {
  document.getElementById('cm-captura-zona').style.display = 'flex';
  document.getElementById('cm-preview').classList.remove('visible');
  document.getElementById('cm-error-msg').classList.remove('visible');
  document.getElementById('input-foto').value = '';
  ARCHIVO_SELECCIONADO = null;
}

function mostrarPreview(archivo) {
  ARCHIVO_SELECCIONADO = archivo;
  document.getElementById('cm-captura-zona').style.display = 'none';
  document.getElementById('cm-preview').classList.add('visible');
  const img = document.getElementById('cm-preview-img');
  const url = URL.createObjectURL(archivo);
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
}

async function enviarFoto() {
  if (!ARCHIVO_SELECCIONADO) return;
  const btn = document.getElementById('btn-enviar-foto');
  const errMsg = document.getElementById('cm-error-msg');
  errMsg.classList.remove('visible');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Enviando…';

  try {
    const fd = new FormData();
    fd.append('imagen', ARCHIVO_SELECCIONADO, ARCHIVO_SELECCIONADO.name || 'foto.jpg');

    const res = await fetch(`${API}/oficios/pendientes`, {
      method: 'POST',
      body: fd,
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'No se pudo enviar la foto.');

    mostrarZonaCaptura();
    const exito = document.getElementById('cm-exito');
    exito.classList.add('visible');
    setTimeout(() => exito.classList.remove('visible'), 6000);
    cargarRecientes();
  } catch (err) {
    errMsg.textContent = err.message || 'No se pudo conectar con el servidor.';
    errMsg.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i> Enviar';
  }
}

function tiempoRelativo(fechaISO) {
  const seg = Math.round((Date.now() - new Date(fechaISO).getTime()) / 1000);
  if (seg < 60) return 'hace un momento';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return `hace ${h} h`;
}

const ETIQUETA_ESTADO = { procesando: 'Procesando…', listo: 'Listo para usar', error: 'Error — ver en PC' };

/* Un <img src> no puede mandar Authorization — se pide primero una URL
   de un solo propósito por foto (mismo patrón que captura-auto.js). */
const URLS_IMAGEN_CM = {};
async function obtenerUrlImagenPendiente(id) {
  if (URLS_IMAGEN_CM[id]) return URLS_IMAGEN_CM[id];
  try {
    const res = await fetch(`${API}/oficios/pendientes/${id}/imagen-token`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (!res.ok) return '';
    const data = await res.json();
    URLS_IMAGEN_CM[id] = data.url;
    return data.url;
  } catch {
    return '';
  }
}

async function cargarRecientes() {
  const cont = document.getElementById('cm-recientes-lista');
  try {
    const res = await fetch(`${API}/oficios/pendientes`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    if (!res.ok) return;
    const lista = await res.json();

    if (!lista.length) {
      cont.innerHTML = '<p class="cm-recientes-vacio">Todavía no has enviado ninguna foto.</p>';
      return;
    }

    const recientes = lista.slice(0, 8);
    const urls = await Promise.all(recientes.map(p => obtenerUrlImagenPendiente(p.id)));

    cont.innerHTML = recientes.map((p, i) => `
      <div class="cm-item-reciente">
        <img src="${urls[i]}" alt=""/>
        <div class="cm-item-info">
          <span class="cm-item-estado e-${p.estado}">${ETIQUETA_ESTADO[p.estado] || p.estado}</span>
          <span class="cm-item-hora">${tiempoRelativo(p.creado_en)}</span>
        </div>
      </div>`).join('');

    // Si hay alguna "procesando", refresca sola en unos segundos.
    if (lista.some(p => p.estado === 'procesando')) {
      setTimeout(cargarRecientes, 6000);
    }
  } catch { /* se reintenta al volver a abrir la página */ }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!verificarAcceso()) return;

  document.getElementById('cm-usuario').textContent = `Captura desde celular — ${USUARIO?.username || ''}`;

  document.getElementById('input-foto').addEventListener('change', (e) => {
    const archivo = e.target.files?.[0];
    if (archivo) mostrarPreview(archivo);
  });
  document.getElementById('btn-cambiar-foto').addEventListener('click', mostrarZonaCaptura);
  document.getElementById('btn-enviar-foto').addEventListener('click', enviarFoto);

  cargarRecientes();
});

window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) verificarAcceso();
});
