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

/* Redimensiona/recomprime una foto con <canvas> — se usa tanto para
   achicar la foto completa (las fotos de cámara pueden pesar varios MB
   y eso es lento de subir con datos móviles, y más lento aún de leer
   por Gemini) como para generar la miniatura de la lista. Se hace en
   el navegador a propósito, sin librerías nuevas del lado del
   servidor. */
function redimensionarImagen(archivo, dimensionMaxima, calidad) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > dimensionMaxima || height > dimensionMaxima) {
        const escala = dimensionMaxima / Math.max(width, height);
        width = Math.round(width * escala);
        height = Math.round(height * escala);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen.')),
        'image/jpeg', calidad
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
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

    // Foto completa: se achica a 1800px de lado más largo (de sobra
    // para que Gemini lea el texto) en vez de subir los 4000+px tal
    // cual salen de la cámara. Si algo falla al procesarla (navegador
    // viejo, formato raro), se sube el archivo original tal cual —
    // nunca se bloquea el envío por esto.
    let archivoParaSubir = ARCHIVO_SELECCIONADO;
    try {
      const foto = await redimensionarImagen(ARCHIVO_SELECCIONADO, 1800, 0.85);
      archivoParaSubir = new File([foto], 'foto.jpg', { type: 'image/jpeg' });
    } catch { /* se sube el original */ }
    fd.append('imagen', archivoParaSubir, archivoParaSubir.name || 'foto.jpg');

    // Miniatura (~240px) para la lista de pendientes — opcional, si
    // falla simplemente no se manda y el servidor cae de vuelta a
    // mostrar la imagen completa donde se necesite.
    try {
      const mini = await redimensionarImagen(ARCHIVO_SELECCIONADO, 240, 0.7);
      fd.append('imagen_thumb', mini, 'miniatura.jpg');
    } catch { /* sin miniatura, no es crítico */ }

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
    // tipo=mini: miniatura ligera (~5-10 KB) en vez de la foto completa
    // tal cual sale de la cámara — en datos móviles la diferencia se
    // nota mucho para solo pintar un cuadrito chico.
    const res = await fetch(`${API}/oficios/pendientes/${id}/imagen-token?tipo=mini`, {
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
