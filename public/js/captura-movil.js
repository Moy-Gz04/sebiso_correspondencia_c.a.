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

/* La misma página sirve para dos pantallas de la PC: Registro Automático de
   oficios (por defecto) y Apartado de Salas (/captura-movil?tipo=sala). El tipo
   decide qué lee la IA de la foto y en qué lista aparece. */
const TIPO = new URLSearchParams(window.location.search).get('tipo') === 'sala' ? 'sala' : 'oficio';

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

/* Regresar: a la página anterior si vino de esta misma app; si se abrió
   directo (QR, pestaña nueva), a la pantalla de su módulo. */
function regresar() {
  const vieneDeAqui = document.referrer && new URL(document.referrer).origin === location.origin;
  if (vieneDeAqui && history.length > 1) { history.back(); return; }
  location.href = TIPO === 'sala' ? '/salas' : '/captura-auto';
}

function cerrarSesion() {
  localStorage.removeItem('sbis_token');
  localStorage.removeItem('sbis_usuario');
  window.location.href = '/login';
}

/* Un registro puede llevar hasta 2 fotos: las hojas del MISMO oficio (p. ej.
   cuando la firma queda en la segunda hoja). Viajan juntas y la IA las lee
   como un solo documento. Salas siempre usa una sola foto. */
const MAX_HOJAS = TIPO === 'oficio' ? 2 : 1;
let ARCHIVOS = [];

function mostrarZonaCaptura() {
  document.getElementById('cm-captura-zona').style.display = 'flex';
  document.getElementById('cm-preview').classList.remove('visible');
  document.getElementById('cm-error-msg').classList.remove('visible');
  document.getElementById('input-foto').value = '';
  const btnEscanear = document.getElementById('btn-escanear');
  if (btnEscanear && btnEscanear.dataset.disponible) btnEscanear.style.display = 'flex';
  ARCHIVOS = [];
  pintarHojas();
}

/* La 2ª hoja se toma con la cámara normal del celular (no con el escáner) */
function tomarFoto() {
  document.getElementById('input-foto').click();
}

function mostrarPreview(archivo) {
  if (ARCHIVOS.length >= MAX_HOJAS) return;
  ARCHIVOS.push(archivo);
  document.getElementById('cm-captura-zona').style.display = 'none';
  const btnEscanear = document.getElementById('btn-escanear');
  if (btnEscanear) btnEscanear.style.display = 'none';
  document.getElementById('cm-preview').classList.add('visible');
  document.getElementById('input-foto').value = '';
  pintarHojas();
}

function quitarHoja(i) {
  ARCHIVOS.splice(i, 1);
  if (!ARCHIVOS.length) { mostrarZonaCaptura(); return; }
  pintarHojas();
}

function pintarHojas() {
  const cont = document.getElementById('cm-hojas');
  if (!cont) return;
  cont.querySelectorAll('img').forEach(im => im.src && URL.revokeObjectURL(im.src));
  cont.innerHTML = '';
  cont.classList.toggle('dos', ARCHIVOS.length > 1 || (ARCHIVOS.length === 1 && MAX_HOJAS > 1));
  ARCHIVOS.forEach((archivo, i) => {
    const fig = document.createElement('figure');
    fig.className = 'cm-hoja';
    const img = document.createElement('img');
    img.alt = `Hoja ${i + 1}`;
    img.src = URL.createObjectURL(archivo);
    const pie = document.createElement('figcaption');
    pie.textContent = MAX_HOJAS > 1 ? `Hoja ${i + 1}` : '';
    const quitar = document.createElement('button');
    quitar.type = 'button'; quitar.className = 'cm-hoja-quitar';
    quitar.setAttribute('aria-label', `Quitar hoja ${i + 1}`);
    quitar.innerHTML = '<i class="ti ti-x"></i>';
    quitar.addEventListener('click', () => quitarHoja(i));
    fig.append(img, pie, quitar);
    cont.appendChild(fig);
  });
  if (ARCHIVOS.length && ARCHIVOS.length < MAX_HOJAS) {
    const agregar = document.createElement('button');
    agregar.type = 'button'; agregar.className = 'cm-hoja-agregar';
    agregar.innerHTML = '<i class="ti ti-camera-plus"></i><strong>Agregar 2ª hoja</strong><span>Opcional · mismo oficio</span>';
    agregar.addEventListener('click', tomarFoto);
    cont.appendChild(agregar);
  }
  const btn = document.getElementById('btn-enviar-foto');
  if (btn && !btn.disabled) btn.innerHTML = `<i class="ti ti-send"></i> ${ARCHIVOS.length > 1 ? 'Enviar 2 hojas' : 'Enviar'}`;
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

/* Achica la foto a 1800px (de sobra para que Gemini lea el texto). Si algo
   falla (navegador viejo, formato raro) se sube el original tal cual. */
async function prepararHoja(archivo, nombre) {
  try {
    const foto = await redimensionarImagen(archivo, 1800, 0.85);
    return new File([foto], nombre, { type: 'image/jpeg' });
  } catch { return archivo; }
}

async function enviarFoto() {
  if (!ARCHIVOS.length) return;
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
    const hoja1 = await prepararHoja(ARCHIVOS[0], 'foto.jpg');
    fd.append('imagen', hoja1, hoja1.name || 'foto.jpg');
    if (ARCHIVOS[1]) {
      const hoja2 = await prepararHoja(ARCHIVOS[1], 'foto-hoja2.jpg');
      fd.append('imagen2', hoja2, hoja2.name || 'foto-hoja2.jpg');
    }
    fd.append('tipo', TIPO);

    // Miniatura (~240px) para la lista de pendientes — opcional, si
    // falla simplemente no se manda y el servidor cae de vuelta a
    // mostrar la imagen completa donde se necesite.
    try {
      const mini = await redimensionarImagen(ARCHIVOS[0], 240, 0.7);
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
    btn.innerHTML = `<i class="ti ti-send"></i> ${ARCHIVOS.length > 1 ? 'Enviar 2 hojas' : 'Enviar'}`;
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

async function cargarRecientes() {
  const cont = document.getElementById('cm-recientes-lista');
  try {
    const res = await fetch(`${API}/oficios/pendientes?tipo=${TIPO}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    if (!res.ok) return;
    const lista = await res.json();

    if (!lista.length) {
      cont.innerHTML = '<p class="cm-recientes-vacio">Todavía no has enviado ninguna foto.</p>';
      return;
    }

    // La miniatura ya viene incluida en la respuesta (data URI) --
    // igual que en Registro Automático, ya no hace falta pedir un token
    // aparte por cada foto solo para pintar la lista.
    const recientes = lista.slice(0, 8);

    cont.innerHTML = recientes.map((p) => `
      <div class="cm-item-reciente">
        <img src="${p.miniatura || ''}" alt=""/>
        <div class="cm-item-info">
          <span class="cm-item-estado e-${p.estado}">${ETIQUETA_ESTADO[p.estado] || p.estado}${p.hojas > 1 ? ' · 2 hojas' : ''}</span>
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
  if (TIPO === 'sala') {
    document.title = 'Correspondencia C.A. SEBISO';
    const eyebrow = document.querySelector('.cm-header-eyebrow');
    if (eyebrow) eyebrow.textContent = 'Apartado de Salas';
    const zona = document.querySelector('#cm-captura-zona strong');
    if (zona) zona.textContent = 'Tomar foto de la solicitud';
    const exito = document.querySelector('#cm-exito span');
    if (exito) exito.textContent = 'Foto enviada. Se está procesando — ya puedes tomar otra, o ir a la PC y seleccionarla en "Salas".';
  }

  document.getElementById('input-foto').addEventListener('change', (e) => {
    const archivo = e.target.files?.[0];
    if (archivo) mostrarPreview(archivo);
  });
  // Escáner en vivo: recorta y endereza la hoja antes de subirla. La foto resultante entra por el mismo flujo de siempre.
  const btnEscanear = document.getElementById('btn-escanear');
  if (btnEscanear && window.EscanerDoc && EscanerDoc.soportado()) {
    btnEscanear.style.display = 'flex';
    btnEscanear.dataset.disponible = '1';
    btnEscanear.addEventListener('click', () => EscanerDoc.abrir({ onListo: (archivo) => mostrarPreview(archivo) }));
  }
  document.getElementById('btn-cambiar-foto').addEventListener('click', mostrarZonaCaptura);
  if (MAX_HOJAS > 1) {
    const zona = document.querySelector('#cm-captura-zona span');
    if (zona) zona.textContent = 'Toca aquí para abrir la cámara · si el oficio tiene 2 hojas, después podrás agregar la segunda';
  }
  document.getElementById('btn-enviar-foto').addEventListener('click', enviarFoto);

  cargarRecientes();
});

window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) verificarAcceso();
});
