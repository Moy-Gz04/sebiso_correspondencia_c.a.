/* ═══════════════════════════════════════════════════
   SBIS — Backend API REST
   Node.js + Express + NeonDB (PostgreSQL)
   ═══════════════════════════════════════════════════ */

import express           from 'express';
import cors              from 'cors';
import helmet            from 'helmet';
import rateLimit         from 'express-rate-limit';
import multer             from 'multer';
import path              from 'path';
import { fileURLToPath } from 'url';
import { neon }          from '@neondatabase/serverless';
import dotenv            from 'dotenv';
import bcrypt             from 'bcryptjs';
import jwt                from 'jsonwebtoken';
import { randomUUID }     from 'crypto';

dotenv.config();

/* Normaliza APPS_SCRIPT_URL: algunos paneles (p. ej. Render) dejan pegar
   el valor con el nombre de la variable delante ("APPS_SCRIPT_URL = https://…")
   o con un salto de línea / espacios al final, lo que hacía reventar a
   `new URL()` dentro de fetch (ERR_INVALID_URL). Se deja solo la URL. */
if (process.env.APPS_SCRIPT_URL) {
  const m = process.env.APPS_SCRIPT_URL.match(/https?:\/\/\S+/);
  process.env.APPS_SCRIPT_URL = m ? m[0].replace(/['"]+$/, '').trim() : '';
}
/* Mismo saneo para el Apps Script dedicado a generar el PDF de la Nota
   al apartar una Sala (proyecto separado de APPS_SCRIPT_URL). */
if (process.env.APPS_SCRIPT_NOTA_URL) {
  const m = process.env.APPS_SCRIPT_NOTA_URL.match(/https?:\/\/\S+/);
  process.env.APPS_SCRIPT_NOTA_URL = m ? m[0].replace(/['"]+$/, '').trim() : '';
}

if (!process.env.DATABASE_URL) { console.error('❌  Falta DATABASE_URL'); process.exit(1); }
if (!process.env.JWT_SECRET)   { console.error('❌  Falta JWT_SECRET');   process.exit(1); }

const PROD = process.env.NODE_ENV === 'production';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const sql = neon(process.env.DATABASE_URL);

/* La app corre detrás del proxy de Render (u otro similar): sin esto,
   express-rate-limit y cualquier lógica basada en IP ven siempre la IP
   interna del proxy, no la del cliente real. */
app.set('trust proxy', 1);

/* ── Cabeceras de seguridad ──
   CSP se deja desactivado porque el frontend actual usa atributos
   onclick="" inline en el HTML generado (no scripts inline sueltos),
   y una CSP estricta rompería esos manejadores sin una migración a
   addEventListener. El resto de cabeceras de helmet (X-Content-Type-
   Options, X-Frame-Options/frame-ancestors, Referrer-Policy, HSTS,
   etc.) se mantienen activas. */
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

/* ── CORS restringido ──
   Antes: origin: '*' permitía que cualquier sitio hiciera peticiones
   autenticadas contra la API si robaba un token. Ahora solo se acepta
   el/los orígenes indicados en ALLOWED_ORIGINS (coma-separado). Si no
   se configura, se asume que el frontend se sirve desde el mismo
   origen que la API (caso típico de este despliegue) y se rechaza
   cualquier origen cross-site. */
const ORIGENES_PERMITIDOS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Sin header Origin (llamadas same-origin, curl, health checks) → permitir.
    if (!origin) return callback(null, true);
    if (ORIGENES_PERMITIDOS.length === 0 || ORIGENES_PERMITIDOS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origen no permitido por CORS.'));
  },
}));

app.use(express.json({ limit: '2mb' }));
// NOTA: los archivos subidos por usuarios ya NO se guardan en disco local
// (Render borra el disco en cada reinicio/redeploy). Ahora se suben a
// Google Drive vía Apps Script — ver subirArchivoADrive() más abajo.

/* ── Límite de intentos de login (fuerza bruta) ──
   10 intentos cada 15 minutos por IP. Las respuestas de login ya son
   genéricas ("Usuario o contraseña incorrectos"), esto añade una
   segunda capa contra ataques automatizados de adivinanza. */
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { mensaje: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
});

/* Límite general, más holgado, para el resto de la API. */
const limitadorApi = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { mensaje: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
});
app.use('/api', limitadorApi);

/* ══ URLs LIMPIAS (sin .html) ══
   El frontend son páginas estáticas servidas por el propio Express.
   Antes se accedía como /historial.html, /area.html, etc. — ahora cada
   una también responde en su ruta "limpia" (/historial, /area...), y
   la versión .html redirige de forma permanente (301) a esa ruta, para
   no romper enlaces o marcadores ya guardados.

   Estas rutas se registran ANTES de express.static para que intercepten
   la petición: si static fuera primero, serviría el archivo .html
   directo y el redirect nunca se ejecutaría.

   También se envían cabeceras que impiden que el navegador guarde
   estas páginas en caché — ni en el caché HTTP normal ni en el
   "back/forward cache" (bfcache) que algunos navegadores usan para el
   botón Atrás/Adelante. Esto se combina con la revalidación de sesión
   en el evento "pageshow" de cada página (ver historial.js, area.js,
   usuario.js, captura.js, no-oficio.js, minutario.js): así, después de
   Cerrar Sesión, la tecla Atrás no puede dejar visible una versión
   cacheada de una pantalla que ya no debería ser accesible. */
const PAGINAS = ['login', 'historial', 'area', 'captura', 'captura-auto', 'captura-movil', 'usuario', 'no-oficio', 'circular', 'tarjeta-informativa', 'minutario', 'salas'];

function sinCache(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

PAGINAS.forEach(pagina => {
  app.get(`/${pagina}`, (req, res) => {
    sinCache(res);
    res.sendFile(path.join(__dirname, 'public', `${pagina}.html`));
  });
  // Compatibilidad con enlaces/marcadores antiguos que usaban .html
  app.get(`/${pagina}.html`, (req, res) => res.redirect(301, `/${pagina}`));
});

app.get('/', (req, res) => res.redirect('/login'));

app.use(express.static(path.join(__dirname, 'public')));

/* ── Tipos de documento permitidos ──
   Antes solo se aceptaban PDF y Word (.pdf, .doc, .docx). Ahora también
   se aceptan imágenes de cualquier tipo común (fotos de oficios tomadas
   con celular, capturas de pantalla, escaneos exportados como imagen,
   etc.), validando tanto la extensión del archivo como su MIME type
   real reportado por el navegador, para mayor robustez. */
const EXTENSIONES_PERMITIDAS = [
  '.pdf', '.doc', '.docx',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.tif', '.tiff', '.heic', '.heif', '.svg',
];

const TAMANO_MAXIMO_MB = 50;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const esImagen = file.mimetype?.startsWith('image/');
    if (esImagen || EXTENSIONES_PERMITIDAS.includes(ext)) return cb(null, true);
    // Antes: cb(null, false) descartaba el archivo en silencio y la
    // petición seguía como si no se hubiera adjuntado nada, dejando al
    // usuario sin ninguna explicación de por qué "no se subió" su
    // archivo. Ahora se rechaza con un error explícito, capturado por
    // el manejador de errores de multer definido más abajo.
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
});

/* Sube un archivo (buffer en memoria) a la carpeta de Drive dedicada
   a documentos, a través del mismo Apps Script que ya usamos para los
   PDFs de Sheets. Devuelve la URL pública del archivo, o null si no
   había archivo que subir. */
async function subirArchivoADrive(file) {
  if (!file) return null;
  if (!process.env.APPS_SCRIPT_URL) {
    throw new Error('APPS_SCRIPT_URL no está configurada en el servidor.');
  }
  const resp = await fetch(process.env.APPS_SCRIPT_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      action:          'subirDocumento',
      nombre:          file.originalname,
      mimeType:        file.mimetype,
      contenidoBase64: file.buffer.toString('base64'),
    }),
    redirect: 'follow',
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || 'No se pudo subir el archivo a Drive.');
  return data.url;
}

/* ══ NOTA DE APARTADO DE SALA ══
   Al apartar una sala se genera un PDF (plantilla de Google Docs llenada
   vía Apps Script, ver APPS_SCRIPT_NOTA_URL) con folio <<NOTJ>> propio,
   consecutivo y automático — nota_seq nunca retrocede, igual que
   no_oficio_seq/circular_seq. La última Nota en papel (fuera del
   sistema) fue la 0076, por eso la secuencia arranca en 77. */
const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio',
  'agosto','septiembre','octubre','noviembre','diciembre'];

/* Igual mecánica que no_oficio/circular: antes de gastar un folio nuevo
   de nota_seq, revisa si hay alguno liberado (nota_liberados — se llena
   al eliminar PERMANENTEMENTE un registro del historial que traía Nota,
   ver DELETE /api/salas/historial/:id) y reutiliza el más chico. Así
   "0077" liberado se vuelve a asignar en la siguiente sala apartada, en
   vez de dejarlo perdido para siempre. */
async function siguienteNotaAutomatica() {
  const [liberado] = await sql`
    DELETE FROM nota_liberados
    WHERE folio_nota = (SELECT folio_nota FROM nota_liberados ORDER BY folio_nota ASC LIMIT 1)
    RETURNING folio_nota`;
  if (liberado) return liberado.folio_nota;

  const [{ siguiente }] = await sql`SELECT nextval('nota_seq') AS siguiente`;
  return String(siguiente).padStart(4, '0');
}

/* Normaliza el número de tarjeta que la persona escribió a mano en el
   formulario: si es puramente numérico se rellena a 4 dígitos (igual
   formato que el automático, "76" -> "0076"); si trae letras u otro
   formato se deja tal cual. Vacío/undefined -> null (cae al automático
   en el caller). */
function normalizarFolioNota(valor) {
  const t = valor == null ? '' : String(valor).trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? t.padStart(4, '0') : t;
}

/* "15:00" -> "en un horario de 15:00 a 17:00 horas" */
function formatearHoraNota(horaInicio, horaFin) {
  const corta = (h) => String(h).slice(0, 5); // "15:00:00" -> "15:00"
  return `en un horario de ${corta(horaInicio)} a ${corta(horaFin)} horas`;
}

/* Date/"YYYY-MM-DD" -> "el próximo 18 de septiembre de 2026" */
function formatearFechaNota(fechaISO) {
  const fecha = typeof fechaISO === 'string' ? fechaISO.slice(0, 10) : fechaISO.toISOString().slice(0, 10);
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return `el próximo ${dia} de ${MESES_ES[mes - 1]} de ${anio}`;
}

/* La "Descripción del evento" la escribe cualquier persona, en cualquier
   forma: desde una frase corta ("Reunión de área") hasta un oficio
   completo ya redactado a mano, con SU PROPIA fecha/hora/número de
   personas — que puede no coincidir con lo que esa misma persona
   capturó en los campos estructurados de arriba (fecha, hora, personas).
   Antes de pegarla tal cual después de "Lo anterior, con la finalidad
   de...", se manda a limpiar con Gemini: que la reduzca a una sola frase
   coherente, sin repetir ni contradecir los datos estructurados (esos
   datos, no lo que diga el texto libre, son la fuente de verdad). Si no
   hay GEMINI_API_KEY, o la IA falla o tarda más de 12s, se usa la
   descripción tal cual (mismo comportamiento que antes) — nunca bloquea
   el apartado de la sala. */
async function limpiarDescripcionConIA(descripcionCruda, { fecha, horaInicio, horaFin, personas }) {
  if (!process.env.GEMINI_API_KEY) return descripcionCruda;

  const prompt = `Eres un asistente que ayuda a redactar oficios de gobierno en México.

Se va a generar un oficio con dos párrafos. El PRIMER párrafo (ya redactado, no lo tocas) dice algo como:
"...con capacidad para ${personas} personas, en un horario de ${formatearHoraNota(horaInicio, horaFin)}, ${formatearFechaNota(fecha)}."

El SEGUNDO párrafo empieza con "Lo anterior, con la finalidad de " y tú debes completarlo. Te doy la descripción del evento tal como la escribió la persona que apartó la sala (puede venir corta y limpia, o puede venir como un oficio completo ya redactado, con su propia fecha/hora/número de personas que puede NO coincidir con los datos de arriba):

"""${descripcionCruda.trim()}"""

Tu tarea: escribe UNA SOLA frase corta en español formal que complete naturalmente "Lo anterior, con la finalidad de ___." Reglas estrictas:
- Los datos verdaderos son los del primer párrafo (fecha ${formatearFechaNota(fecha)}, horario ${formatearHoraNota(horaInicio, horaFin)}, ${personas} personas). Si el texto de la persona menciona otra fecha, hora o número de personas, IGNÓRALOS — no los repitas ni los seas fiel a ellos.
- No inventes datos (nombres, cargos, motivos) que no estén en el texto.
- No repitas la fecha, la hora ni el número de personas — ya están en el primer párrafo.
- Devuelve SOLO la frase (sin comillas, sin "Lo anterior...", sin punto final si ya no hace falta, sin explicaciones ni notas).`;

  /* gemini-3.1-flash-lite: se probaron primero gemini-3.6-flash (modelo
     "razonador" — gastaba cientos de tokens "pensando" antes de escribir
     la respuesta, con latencias de 4 a 30+ segundos y errores 503 de
     "alta demanda" por ser un modelo preview) y gemini-2.5-flash/-lite
     (ya no disponibles para cuentas nuevas). flash-lite no "piensa", responde
     consistente en ~1s y con buena calidad para una frase corta como
     esta — se queda con timeout generoso (15s) solo como red de
     seguridad, no porque se espere tardar tanto. */
  async function intentar() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1024 },
          }),
          signal: controller.signal,
        }
      );
      const data = await resp.json();
      const texto = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')?.trim();
      if (!texto) {
        console.warn('⚠️  Gemini no devolvió texto útil (finishReason=' + data?.candidates?.[0]?.finishReason + '):', JSON.stringify(data).slice(0, 300));
        return null;
      }
      return texto.replace(/^["']|["']$/g, ''); // por si la envuelve en comillas
    } finally {
      clearTimeout(timeout);
    }
  }

  // Un reintento antes de rendirse: la variabilidad del modelo hace que un
  // segundo intento tenga buenas probabilidades de salir rápido y limpio
  // aunque el primero se haya ido a MAX_TOKENS o al timeout.
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const texto = await intentar();
      if (texto) return texto;
    } catch (err) {
      console.error(`⚠️  Intento ${intento}/2 al limpiar la descripción con Gemini falló:`, err.message);
    }
  }
  console.warn('⚠️  No se pudo limpiar la descripción con Gemini tras 2 intentos, se usa tal cual.');
  return descripcionCruda;
}

/* Descripción del evento (ya limpia, ver limpiarDescripcionConIA) ->
   "Lo anterior, con la finalidad de <descripción>" */
function construirAsuntoNota(descripcion) {
  return `Lo anterior, con la finalidad de ${descripcion.trim()}`;
}

/* Préstamo (opcional) -> "Asimismo, solicitamos el préstamo de <préstamo>." */
function construirSolicitudNota(prestamo) {
  const texto = prestamo?.trim();
  if (!texto) return '';
  return `Asimismo, solicitamos el préstamo de ${texto}.`;
}

/* Llama al Apps Script dedicado (Tarjeta_sala) para llenar la plantilla y
   generar el PDF. Si APPS_SCRIPT_NOTA_URL no está configurada, o Drive
   falla, no se revienta el apartado completo: se registra el aviso y el
   apartado queda sin nota_pdf_url (se puede reintentar más adelante). */
async function generarNotaSalaPDF({ notj, sala, np, horaInicio, horaFin, fecha, descripcion, prestamo }) {
  if (!process.env.APPS_SCRIPT_NOTA_URL) {
    console.warn('⚠️  APPS_SCRIPT_NOTA_URL no configurada: no se genera el PDF de la Nota.');
    return null;
  }

  const descripcionLimpia = await limpiarDescripcionConIA(descripcion, { fecha, horaInicio, horaFin, personas: np });
  const payload = {
    action:    'generarNota',
    notj,
    sala,
    np:        String(np),
    hora:      formatearHoraNota(horaInicio, horaFin),
    fecha:     formatearFechaNota(fecha),
    asunto:    construirAsuntoNota(descripcionLimpia),
    solicitud: construirSolicitudNota(prestamo),
  };

  // Igual que con Gemini: Apps Script a veces responde con una página de
  // error HTML de Google en vez de mi JSON (visto en producción — fallo
  // de infraestructura pasajero, no del código). Un segundo intento casi
  // siempre lo resuelve.
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const resp = await fetch(process.env.APPS_SCRIPT_NOTA_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        redirect: 'follow',
      });
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        const texto = await resp.text();
        console.error(`⚠️  Intento ${intento}/2: Apps Script respondió algo que no es JSON (status ${resp.status}):`, texto.slice(0, 300));
        continue;
      }
      const data = await resp.json();
      if (!data.ok) {
        console.error(`⚠️  Intento ${intento}/2: Apps Script no pudo generar la Nota:`, data.error);
        continue;
      }
      return data.url;
    } catch (err) {
      console.error(`⚠️  Intento ${intento}/2 al llamar a APPS_SCRIPT_NOTA_URL falló:`, err.message);
    }
  }
  console.error('⚠️  No se pudo generar el PDF de la Nota tras 2 intentos.');
  return null;
}


/* ══ REGISTRO AUTOMÁTICO — extracción de datos de oficio desde foto ══
   Recibe la imagen de un oficio (tomada con el celular) y le pide a
   Gemini que lea el documento y devuelva los mismos campos que el
   formulario de "Nuevo Registro" — para que la persona solo tenga que
   revisar/completar en vez de transcribir todo a mano. Usa
   responseMimeType 'application/json' (en vez de pedir JSON en texto
   libre) para no depender de que el modelo respete el formato por su
   cuenta. Mismo modelo y patrón de reintento que limpiarDescripcionConIA. */
// "instruccion" y "n_referencia" se quitaron a propósito: Instrucción
// es un campo que llena la persona a mano (nunca la IA), y N.
// Referencia siempre debe quedar igual a Número de Oficio -- eso ya
// no lo decide la IA, se copia directo en el frontend (ver
// seleccionarPendiente en captura-auto.js).
const CAMPOS_EXTRAIBLES = [
  'f_oficio', 'f_sello', 'numero',
  'remitente', 'dependencia', 'descripcion',
];

async function extraerDatosOficioDeImagen(base64, mimeType) {
  const prompt = `Eres un asistente que ayuda a digitalizar correspondencia oficial de gobierno en México.

Te voy a dar la foto de un oficio (documento físico, puede estar inclinado, con sombras, escrito a mano o a máquina). Léelo con cuidado y extrae SOLO estos datos, en este formato JSON exacto:

{
  "f_oficio": "fecha del oficio en formato YYYY-MM-DD, o cadena vacía si no aparece",
  "f_sello": "fecha del sello de recibido, si hay uno visible, en formato YYYY-MM-DD, o cadena vacía",
  "numero": "el número/folio del oficio (normalmente aparece justo DEBAJO de la fecha, ej. 'DGA/112/2026'). Si el documento no trae ningún número/folio visible, escribe exactamente 'SN' (sin número) — nunca lo dejes en blanco ni inventes uno",
  "remitente": "nombre completo y cargo de quien firma el oficio, tal como aparece en la firma (ej. 'Lic. Marlen Elva Arista Amador, Directora de Gestión Institucional'), o cadena vacía",
  "dependencia": "la institución/secretaría de la que proviene, seguida del área o dirección específica de quien firma, separadas por coma. El área sale del cargo del firmante convertido a nombre de área (ej. si firma 'Directora de Gestión Institucional' el área es 'Dirección de Gestión Institucional'). Ejemplo completo: 'SEBISO, Dirección de Gestión Institucional'. Si no hay cargo/área identificable, deja solo la institución. IMPORTANTE: máximo 110 caracteres en total — usa siglas o el nombre corto de la institución (ej. 'SEBISO' en vez de 'Secretaría de Bienestar e Inclusión Social') si con el nombre completo no cabe junto con el área",
  "descripcion": "un resumen breve (2-3 líneas) del asunto/contenido del oficio, en tus propias palabras, o cadena vacía si no se alcanza a leer nada"
}

Reglas estrictas:
- Si un dato no aparece o no se alcanza a leer, deja el campo como cadena vacía "" (excepto "numero", que en ese caso lleva "SN") — NUNCA inventes ni adivines.
- Las fechas SIEMPRE en formato YYYY-MM-DD. Si el año no es visible pero el resto sí, no adivines el año.
- NUNCA extraigas ni inventes un campo de "instrucción" o nota manuscrita añadida al margen — eso no se pide aquí y no debe aparecer en ningún campo.
- Devuelve ÚNICAMENTE el objeto JSON, sin explicaciones ni texto adicional.`;

  // Varios modelos en rotación, no solo dos: cada uno tiene su propia
  // cuota/disponibilidad en Google, así que cuando uno está caído (503
  // "alta demanda") o agotó su cuota (429) casi siempre otro sí
  // responde. Verificado en vivo el 2026-09-23: -flash-lite y
  // -flash-preview cayeron a la vez (503 y 429 respectivamente) pero
  // flash-lite-latest y 3.6-flash sí contestaron. Orden: los rápidos
  // primero, los "razonadores" (más lentos, ~10s) al final como último
  // recurso.
  const MODELOS_VISION = [
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.6-flash',
    'gemini-3-flash-preview',
  ];

  // Además de rotar modelo, rotamos CUENTA: cada API key tiene su propia
  // cuota diaria en Google, así que si la cuenta principal se queda sin
  // cuota, se sigue intentando con la(s) cuenta(s) extra antes de darse
  // por vencido. GEMINI_API_KEY_3 (y cualquier GEMINI_API_KEY_N futura)
  // son opcionales -- si no están configuradas simplemente no se usan.
  const CUENTAS = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_5]
    .filter(Boolean);

  // Combinación completa modelo x cuenta: primero se agota cada modelo
  // en la cuenta principal, y si con ninguno de los 4 hubo suerte recién
  // ahí se pasa a repetir la ronda con la siguiente cuenta.
  const COMBOS = [];
  for (const key of CUENTAS) {
    for (const modelo of MODELOS_VISION) COMBOS.push({ modelo, key });
  }

  async function intentar(modelo, apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // imagen (y el modelo de respaldo) tardan mas que texto
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64 } },
              ],
            }],
            generationConfig: {
              maxOutputTokens: 2048,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        }
      );
      const data = await resp.json();
      const texto = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')?.trim();
      if (!texto) {
        console.warn(`⚠️  Gemini Vision (${modelo}) no devolvió texto útil (finishReason=` + data?.candidates?.[0]?.finishReason + '):', JSON.stringify(data).slice(0, 300));
        return null;
      }
      const parseado = JSON.parse(texto);
      // Solo nos quedamos con los campos que conocemos, y como string.
      const limpio = {};
      for (const campo of CAMPOS_EXTRAIBLES) {
        limpio[campo] = typeof parseado[campo] === 'string' ? parseado[campo] : '';
      }
      return limpio;
    } finally {
      clearTimeout(timeout);
    }
  }

  // La extracción de imagen (a diferencia de limpiarDescripcionConIA) se
  // deja con más intentos y una pequeña espera entre cada uno: es un
  // flujo en segundo plano (no hay usuario esperando en vivo), así que
  // vale la pena recorrer TODAS las combinaciones de modelo x cuenta
  // antes de rendirse (una vuelta extra por si el primer combo vuelve a
  // estar disponible).
  const INTENTOS = COMBOS.length + 1;
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const { modelo, key } = COMBOS[(intento - 1) % COMBOS.length];
    try {
      const datos = await intentar(modelo, key);
      if (datos) return datos;
    } catch (err) {
      console.error(`⚠️  Intento ${intento}/${INTENTOS} (${modelo}) de extraer datos con Gemini Vision falló:`, err.message);
    }
    if (intento < INTENTOS) await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`No se pudo leer la imagen con IA tras probar los ${COMBOS.length} combos de modelo/cuenta disponibles.`);
}

/* Procesa un registro pendiente: llama a Gemini Vision y actualiza su
   estado. */
async function procesarRegistroPendienteIA(id, base64, mimeType) {
  try {
    const datos = await extraerDatosOficioDeImagen(base64, mimeType);
    await sql`
      UPDATE oficios_pendientes_ia
      SET estado = 'listo', datos_json = ${JSON.stringify(datos)}::jsonb
      WHERE id = ${id}`;
    console.log(`✅  Registro pendiente IA #${id} listo.`);
  } catch (err) {
    await sql`
      UPDATE oficios_pendientes_ia
      SET estado = 'error', error_mensaje = ${err.message}
      WHERE id = ${id}`;
    console.error(`⚠️  Registro pendiente IA #${id} falló:`, err.message);
  }
}

/* Cola en memoria para procesar los registros pendientes de UNO EN UNO.
   Antes cada foto disparaba su propia llamada a Gemini sin esperar a
   las demás, así que si llegaban varias fotos casi juntas se mandaban
   peticiones en paralelo y eso saturaba la API (más 429/503 de los
   normales). Encolar no la hace más lenta en el caso normal (una foto
   a la vez de todos modos), y evita ese pico cuando llegan varias
   juntas. */
const COLA_PENDIENTES_IA = [];
let procesandoColaIA = false;

function encolarRegistroPendienteIA(id, base64, mimeType) {
  COLA_PENDIENTES_IA.push({ id, base64, mimeType });
  if (!procesandoColaIA) procesarColaIA();
}

async function procesarColaIA() {
  procesandoColaIA = true;
  let item;
  while ((item = COLA_PENDIENTES_IA.shift())) {
    await procesarRegistroPendienteIA(item.id, item.base64, item.mimeType);
  }
  procesandoColaIA = false;
}

/* ── JWT ── */
function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.startsWith('Bearer ')
    ? req.headers['authorization'].slice(7) : null;
  if (!token) return res.status(401).json({ mensaje: 'Token requerido.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    registrarActividad(req.user);
    next();
  }
  catch { return res.status(401).json({ mensaje: 'Token inválido o expirado.' }); }
}

/* ══ USUARIOS ACTIVOS (en memoria) ══
   "Activo" = tuvo alguna petición autenticada (o un heartbeat, ver
   /api/heartbeat) en los últimos VENTANA_ACTIVO_MS. No se necesita
   tabla en la base de datos: como registrarActividad() se llama en
   CADA petición que pasa por verifyToken, cualquier uso normal del
   sistema ya alimenta el contador; el heartbeat solo cubre el caso de
   alguien con la pestaña abierta pero sin interactuar.
   Vive en memoria del proceso: si el servidor se reinicia el registro
   se vacía (no importa, solo interesa la actividad reciente) y, si
   algún día se despliegan varias instancias a la vez, cada una vería
   solo a sus propios usuarios — para el tamaño actual de este sistema
   (una sola instancia en Render) es la solución correcta y más simple.

   El mapa se indexa por "sid" (identificador de SESIÓN, uno por cada
   login — ver /api/login) y no por username, para poder distinguir dos
   sesiones simultáneas de la MISMA cuenta (p. ej. la misma cuenta
   abierta en dos dispositivos a la vez): cada sesión queda su propia
   entrada, y obtenerUsuariosActivos() las agrupa por username al
   final para reportar cuántas sesiones tiene abiertas cada cuenta. Un
   token emitido antes de este cambio no trae "sid": se le asigna uno
   basado en su username como resguardo, para no romper sesiones ya
   abiertas (esas cuentas viejas simplemente cuentan como una sola
   sesión hasta que vuelvan a iniciar sesión). */
const VENTANA_ACTIVO_MS = 3 * 60 * 1000; // 3 min sin actividad → ya no cuenta como activo
const usuariosActivos = new Map(); // sid -> { username, area, rol, sid, ultimaVez }

function registrarActividad(user) {
  if (!user?.username) return;
  const sid = user.sid || `legacy-${user.username}`;
  usuariosActivos.set(sid, {
    username:  user.username,
    area:      user.area || null,
    rol:       user.rol,
    sid,
    ultimaVez: Date.now(),
  });
}

function obtenerUsuariosActivos() {
  const ahora = Date.now();
  const sesiones = [];
  for (const [sid, datos] of usuariosActivos) {
    if (ahora - datos.ultimaVez <= VENTANA_ACTIVO_MS) sesiones.push(datos);
    else usuariosActivos.delete(sid); // limpieza perezosa de sesiones ya inactivas
  }

  // Agrupar por username: la misma cuenta activa en varios dispositivos
  // aparece como UNA sola fila con "sesiones" > 1, en vez de duplicarse
  // en la lista — así el frontend puede marcarla con un "×2", "×3", etc.
  const porUsuario = new Map(); // username -> { username, area, rol, sesiones }
  for (const s of sesiones) {
    const existente = porUsuario.get(s.username);
    if (existente) {
      existente.sesiones += 1;
      // Se conserva el área/rol más reciente entre sus sesiones.
      if (s.ultimaVez >= existente._ultimaVez) {
        existente.area = s.area;
        existente.rol  = s.rol;
        existente._ultimaVez = s.ultimaVez;
      }
    } else {
      porUsuario.set(s.username, {
        username: s.username,
        area:     s.area,
        rol:      s.rol,
        sesiones: 1,
        _ultimaVez: s.ultimaVez,
      });
    }
  }

  return [...porUsuario.values()]
    .map(({ _ultimaVez, ...resto }) => resto)
    .sort((a, b) => a.username.localeCompare(b.username));
}

function onlyAdmin(req, res, next) {
  if (req.user?.rol !== 'admin')
    return res.status(403).json({ mensaje: 'Solo administradores.' });
  next();
}

/* Área que concentra la administración de correspondencia. Solo esta
   área (y el admin legado) puede crear Nuevos Registros y consultar
   el Historial; el resto de las áreas trabaja exclusivamente desde su
   Bandeja de Oficios. */
const AREA_CON_GESTION_COMPLETA = 'Coordinación Administrativa';
function tieneGestionCompleta(user) {
  return user?.rol === 'admin' ||
    (user?.rol === 'area' && user?.area === AREA_CON_GESTION_COMPLETA);
}

/* ── Roles que pueden RECIBIR un oficio dentro de un área ──
   Son 'usuario_area' (usuarios operativos) y 'area' (encargados de
   turnar): así un encargado puede sub-turnarle a OTRO encargado de su
   MISMA área, no solo a los usuarios operativos. Se escribe literal en
   cada consulta (rol IN ('area','usuario_area')) para que Postgres no
   tenga que inferir el tipo de un parámetro de arreglo.
   El turnado hacia OTRA área sigue siendo exclusivo de Coordinación
   Administrativa (ver onlyCoordOrAdmin y la rama "origen" del PUT). */

/* Solo Coordinación Administrativa (o el admin legado) puede crear
   registros nuevos. Las demás áreas ya no tienen esta capacidad: solo
   gestionan lo que se les turna, desde su Bandeja de Oficios. */
function onlyCoordOrAdmin(req, res, next) {
  if (!tieneGestionCompleta(req.user))
    return res.status(403).json({ mensaje: 'Solo Coordinación Administrativa puede crear Nuevos Registros.' });
  next();
}

/* Mismo criterio que onlyCoordOrAdmin, con mensaje genérico: protege
   TODAS las rutas de No. de Oficio / Minutario (ver más abajo), que
   son exclusivas de Coordinación Administrativa (o el admin legado),
   igual que Nuevo Registro e Historial. */
function onlyGestionCompleta(req, res, next) {
  if (!tieneGestionCompleta(req.user))
    return res.status(403).json({ mensaje: 'Sin acceso a No. de Oficio / Minutario.' });
  next();
}

/* Calcula el siguiente N. Control PROPIO de un área: un número
   secuencial simple (0001, 0002...), independiente por cada área
   (dos áreas distintas pueden tener ambas un "0001" sin problema —
   lo único que debe ser único es la combinación área + número). */
async function siguienteNControl(area) {
  const [{ max }] = await sql`
    SELECT COALESCE(MAX(
      CAST(NULLIF(regexp_replace(n_control, '[^0-9]', '', 'g'), '') AS INTEGER)
    ), 0) AS max
    FROM oficios
    WHERE area_origen = ${area}`;

  return String(max + 1).padStart(4, '0');
}

/* ══ SEGURIDAD DE DOCUMENTOS ══
   Las columnas ruta_doc1..4 pueden contener enlaces directos de
   Google Drive (o, en registros heredados, un nombre de archivo local).
   Antes esos enlaces viajaban tal cual en cualquier respuesta de
   /api/oficios, quedando visibles en el DevTools de cualquiera con
   sesión y reenviables sin control alguno. Ahora:
     1) Nunca se exponen las rutas crudas en las respuestas de la API;
        se sustituyen por un objeto { tipo, nombre } sin URL.
     2) Para abrir un documento, el frontend primero pide un token de
        un solo uso y corta duración (ver /doc-token/:slot), y luego
        navega a /api/docs/:token, que valida el token y recién ahí
        redirige al documento real.

   Adicionalmente, ruta_doc3 (Turno) y ruta_doc4 (Seguimiento) tienen
   cada uno una columna hermana *_subido_por con el username de quien
   adjuntó ese archivo (quien lo sub-turnó, o quien lo atendió), para
   que en la tarjeta quede claro quién subió cada documento. */
function sanitizarDoc(ruta, subidoPor) {
  if (!ruta) return null;
  const base = /^https?:\/\//i.test(ruta)
    ? { tipo: 'externo', nombre: 'Ver documento' }
    : { tipo: 'local', nombre: String(ruta).replace(/^\d+_/, '') };
  return subidoPor ? { ...base, subido_por: subidoPor } : base;
}

function sanitizarOficio(o) {
  if (!o) return o;
  const { ruta_doc1, ruta_doc2, ruta_doc3, ruta_doc4, doc3_subido_por, doc4_subido_por, ...resto } = o;
  return {
    ...resto,
    doc1: sanitizarDoc(ruta_doc1),
    doc2: sanitizarDoc(ruta_doc2),
    doc3: sanitizarDoc(ruta_doc3, doc3_subido_por),
    doc4: sanitizarDoc(ruta_doc4, doc4_subido_por),
  };
}

/* Misma regla de acceso que ya usa GET /api/oficios/:id, extraída
   para reutilizarla también al emitir un doc-token. */
function puedeVerOficio(user, oficio) {
  const { rol, area, id } = user;
  if (rol === 'admin') return true;
  if (rol === 'area')  return oficio.turnado_a === area || oficio.area_origen === area;
  if (rol === 'usuario_area') return oficio.usuario_asignado_id === id;
  return false;
}

/* ══ POST /api/oficios/:id/doc-token/:slot ══
   Requiere el mismo Bearer token de sesión que el resto de la API.
   Si el usuario tiene acceso al oficio y el documento existe, emite
   un JWT de un solo propósito (oficio + slot), válido 3 minutos, para
   canjear en /api/docs/:token. Así la URL real de Drive nunca se
   envía en las respuestas normales de la API. ══ */
app.get('/api/oficios/:id/doc-token/:slot', verifyToken, async (req, res) => {
  try {
    const { id, slot } = req.params;
    if (!['doc1', 'doc2', 'doc3', 'doc4'].includes(slot))
      return res.status(400).json({ mensaje: 'Documento no válido.' });

    const [oficio] = await sql`SELECT * FROM oficios WHERE id = ${id}`;
    if (!oficio) return res.status(404).json({ mensaje: 'No encontrado.' });
    if (!puedeVerOficio(req.user, oficio))
      return res.status(403).json({ mensaje: 'Sin acceso.' });

    const ruta = oficio[`ruta_${slot}`];
    if (!ruta) return res.status(404).json({ mensaje: 'Este oficio no tiene ese documento.' });

    const token = jwt.sign(
      { propósito: 'doc', oficioId: oficio.id, slot },
      process.env.JWT_SECRET,
      { expiresIn: '3m' }
    );

    res.json({ url: `/api/docs/${token}` });
  } catch (err) {
    manejarError(res, err, 'No se pudo generar el enlace del documento.');
  }
});

/* ══ GET /api/docs/:token ══
   Endpoint público (sin Authorization header) pero solo aceptable con
   un token de un solo propósito y corta vida emitido arriba. Verifica
   la firma, revalida que el documento siga existiendo y redirige al
   destino real (Drive, o el servidor legado de /uploads). ══ */
app.get('/api/docs/:token', async (req, res) => {
  try {
    let payload;
    try {
      payload = jwt.verify(req.params.token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).send('Enlace inválido o expirado.');
    }
    if (payload?.propósito !== 'doc') return res.status(401).send('Enlace inválido.');

    const [oficio] = await sql`SELECT * FROM oficios WHERE id = ${payload.oficioId}`;
    if (!oficio) return res.status(404).send('No encontrado.');

    const ruta = oficio[`ruta_${payload.slot}`];
    if (!ruta) return res.status(404).send('Documento no disponible.');

    if (/^https?:\/\//i.test(ruta)) return res.redirect(302, ruta);
    return res.redirect(302, `/uploads/${ruta}`);
  } catch (err) {
    manejarError(res, err, 'No se pudo abrir el documento.');
  }
});

/* Log completo en servidor siempre; al cliente, en producción, solo un
   mensaje genérico (evita filtrar detalles internos de la base de
   datos u otras integraciones en el mensaje de error). */
function manejarError(res, err, mensajeGenerico, status = 500) {
  console.error(err);
  res.status(status).json({ mensaje: PROD ? mensajeGenerico : `${mensajeGenerico} ${err.message}` });
}

/* Recorta un texto al límite de una columna varchar antes de guardarlo
   -- así un valor más largo de lo esperado (typeo manual, o la IA de
   Registro Automático leyendo un dato más largo de lo usual) nunca
   tumba el guardado con un error de Postgres (22001, "value too long
   for type character varying"), solo se guarda recortado. */
function truncar(valor, maximo) {
  if (valor == null) return valor;
  const texto = String(valor);
  return texto.length > maximo ? texto.slice(0, maximo) : texto;
}

/* ══ HEALTH CHECK ══ */
app.get('/api/ping', (req, res) => res.json({ ok: true, ts: new Date() }));

/* ══ LOGIN ══ */
app.post('/api/login', limitadorLogin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ mensaje: 'Usuario y contraseña requeridos.' });

    const [usuario] = await sql`
      SELECT * FROM usuarios
      WHERE LOWER(username) = LOWER(${username.trim()}) AND activo = TRUE
      ORDER BY id ASC
      LIMIT 1`;

    if (!usuario) return res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' });

    const coincide = await bcrypt.compare(password, usuario.password);
    if (!coincide) return res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' });

    const token = jwt.sign(
      { id: usuario.id, username: usuario.username, area: usuario.area, rol: usuario.rol, sid: randomUUID() },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    console.log(`🔐  Login: ${usuario.username} (${usuario.rol})`);
    res.json({ token, usuario: { id: usuario.id, username: usuario.username, area: usuario.area, rol: usuario.rol } });
  } catch (err) {
    manejarError(res, err, 'Error en el servidor.');
  }
});

/* ══ ME ══ */
app.get('/api/me', verifyToken, (req, res) => res.json({ usuario: req.user }));

/* ══ POST /api/heartbeat ══ */
app.post('/api/heartbeat', verifyToken, (req, res) => res.sendStatus(204));

/* ══ GET /api/usuarios-activos ══ */
app.get('/api/usuarios-activos', verifyToken, (req, res) => {
  const usuarios = obtenerUsuariosActivos();
  res.json({ total: usuarios.length, usuarios });
});

/* ══ GET /api/usuarios/area/:area ══ */
app.get('/api/usuarios/area/:area', verifyToken, async (req, res) => {
  try {
    const { area } = req.params;
    if (req.user.rol !== 'admin' && req.user.area !== area)
      return res.status(403).json({ mensaje: 'Sin acceso.' });

    const rows = await sql`
      SELECT DISTINCT ON (LOWER(username)) id, username, area, rol
      FROM usuarios
      WHERE area = ${area}
        AND rol IN ('area', 'usuario_area')
        AND activo = TRUE
      ORDER BY LOWER(username), id ASC`;

    rows.sort((a, b) => {
      if (a.rol !== b.rol) return a.rol === 'area' ? -1 : 1;
      return a.username.localeCompare(b.username);
    });

    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudieron obtener los usuarios.');
  }
});

/* ══ GET /api/oficios ══ */
app.get('/api/oficios', verifyToken, async (req, res) => {
  try {
    const { estatus, origen } = req.query;
    const { rol, area, id } = req.user;
    let rows;

    if (rol === 'admin') {
      rows = estatus && estatus !== 'todos'
        ? await sql`
            SELECT *,
              CASE WHEN estatus IN ('turnado','por_turnar','sub_turnado')
                THEN GREATEST(0, EXTRACT(DAY FROM NOW() - created_at)::int)
                ELSE NULL END AS dias_transcurridos
            FROM oficios WHERE estatus = ${estatus} ORDER BY created_at DESC`
        : await sql`
            SELECT *,
              CASE WHEN estatus IN ('turnado','por_turnar','sub_turnado')
                THEN GREATEST(0, EXTRACT(DAY FROM NOW() - created_at)::int)
                ELSE NULL END AS dias_transcurridos
            FROM oficios ORDER BY created_at DESC`;

    } else if (rol === 'area' && origen === 'mio') {
      if (area !== AREA_CON_GESTION_COMPLETA)
        return res.status(403).json({ mensaje: 'Sin acceso al Historial.' });

      rows = estatus && estatus !== 'todos'
        ? await sql`
            SELECT *,
              CASE WHEN estatus IN ('turnado','por_turnar','sub_turnado')
                THEN GREATEST(0, EXTRACT(DAY FROM NOW() - created_at)::int)
                ELSE NULL END AS dias_transcurridos
            FROM oficios WHERE area_origen = ${area} AND estatus = ${estatus} ORDER BY created_at DESC`
        : await sql`
            SELECT *,
              CASE WHEN estatus IN ('turnado','por_turnar','sub_turnado')
                THEN GREATEST(0, EXTRACT(DAY FROM NOW() - created_at)::int)
                ELSE NULL END AS dias_transcurridos
            FROM oficios WHERE area_origen = ${area} ORDER BY created_at DESC`;

    } else if (rol === 'area') {
      rows = estatus && estatus !== 'todos'
        ? await sql`
            SELECT *,
              CASE WHEN estatus IN ('turnado','por_turnar','sub_turnado')
                THEN GREATEST(0, EXTRACT(DAY FROM NOW() - created_at)::int)
                ELSE NULL END AS dias_transcurridos
            FROM oficios WHERE turnado_a = ${area} AND estatus = ${estatus} ORDER BY created_at DESC`
        : await sql`
            SELECT *,
              CASE WHEN estatus IN ('turnado','por_turnar','sub_turnado')
                THEN GREATEST(0, EXTRACT(DAY FROM NOW() - created_at)::int)
                ELSE NULL END AS dias_transcurridos
            FROM oficios WHERE turnado_a = ${area} ORDER BY created_at DESC`;

    } else if (rol === 'usuario_area') {
      rows = estatus && estatus !== 'todos'
        ? await sql`
            SELECT *,
              CASE WHEN estatus IN ('turnado','por_turnar','sub_turnado')
                THEN GREATEST(0, EXTRACT(DAY FROM NOW() - created_at)::int)
                ELSE NULL END AS dias_transcurridos
            FROM oficios WHERE usuario_asignado_id = ${id} AND estatus = ${estatus} ORDER BY created_at DESC`
        : await sql`
            SELECT *,
              CASE WHEN estatus IN ('turnado','por_turnar','sub_turnado')
                THEN GREATEST(0, EXTRACT(DAY FROM NOW() - created_at)::int)
                ELSE NULL END AS dias_transcurridos
            FROM oficios WHERE usuario_asignado_id = ${id} ORDER BY created_at DESC`;

    } else {
      return res.status(403).json({ mensaje: 'Rol no reconocido.' });
    }

    res.json(rows.map(sanitizarOficio));
  } catch (err) {
    manejarError(res, err, 'Error al obtener registros.');
  }
});

/* ══════════════════════════════════════════════════════
   REGISTRO AUTOMÁTICO (IA) — captura de oficio por foto
   Flujo: el celular sube la foto (este endpoint responde de
   inmediato, sin esperar a Gemini) -> se procesa en segundo plano
   -> la PC (Nuevo Registro Automático) lista los pendientes y, al
   elegir uno ya "listo", rellena el formulario con datos_json.
   Mismo permiso que Nuevo Registro (Coordinación Administrativa).
   ══════════════════════════════════════════════════════ */

/* ══ POST /api/oficios/pendientes — subir una foto para procesar ══
   Recibe DOS archivos: "imagen" (la foto, ya comprimida por el propio
   navegador del celular antes de subirla — ver captura-movil.js) y
   "imagen_thumb" (una miniatura de ~240px generada también en el
   navegador con <canvas>, para pintar la lista de "Fotos por
   procesar" sin tener que descargar la foto completa). Se genera del
   lado del cliente y no en el servidor a propósito: así no se necesita
   ninguna librería de procesamiento de imágenes con binarios nativos
   (riesgo real de incompatibilidad entre el Windows donde se
   desarrolla y el Linux donde corre Render). "imagen_thumb" es
   opcional por si un navegador viejo no soporta canvas.toBlob: en ese
   caso simplemente no hay miniatura y se sirve la imagen completa. */
app.post('/api/oficios/pendientes', verifyToken, onlyCoordOrAdmin,
  upload.fields([{ name: 'imagen', maxCount: 1 }, { name: 'imagen_thumb', maxCount: 1 }]),
  async (req, res) => {
  try {
    const archivoImagen = req.files?.imagen?.[0];
    if (!archivoImagen) return res.status(400).json({ mensaje: 'No se recibió ninguna imagen.' });
    const archivoThumb = req.files?.imagen_thumb?.[0];

    const [nuevo] = await sql`
      INSERT INTO oficios_pendientes_ia (imagen, imagen_mime, imagen_thumb, creado_por)
      VALUES (${archivoImagen.buffer}, ${archivoImagen.mimetype}, ${archivoThumb?.buffer ?? null}, ${req.user.username})
      RETURNING id, estado, creado_en`;

    // Se encola (no se procesa directo) para que, si llegan varias fotos
    // casi juntas, no se disparen todas a la vez contra Gemini — quien
    // tomó la foto no espera de todos modos, la cola corre en segundo
    // plano.
    encolarRegistroPendienteIA(nuevo.id, archivoImagen.buffer.toString('base64'), archivoImagen.mimetype);

    res.status(201).json({ id: nuevo.id, estado: nuevo.estado, creado_en: nuevo.creado_en });
  } catch (err) {
    manejarError(res, err, 'No se pudo subir la imagen.');
  }
});

/* ══ GET /api/oficios/pendientes — lista para elegir en "Registro Automático"
   La miniatura (imagen_thumb, ya de por sí ~5-10 KB) va incluida aquí
   mismo como data URI -- antes el frontend tenía que pedir, por cada
   foto, un token aparte (GET /imagen-token) y luego la imagen
   (GET /pendientes-imagen/:token): dos viajes de red extra por
   miniatura, solo para pintar la lista. Con 10 fotos eso eran hasta 20
   peticiones antes de ver algo. Ahora todo llega en esta única
   respuesta; la foto COMPLETA sigue pidiéndose aparte (con token) y
   solo al pasar el cursor encima, para la vista previa grande.
   Solo los últimos 3 días y los que no se hayan usado ya. ══ */
app.get('/api/oficios/pendientes', verifyToken, onlyCoordOrAdmin, async (req, res) => {
  try {
    const rows = await sql`
      SELECT id, estado, datos_json, error_mensaje, creado_por, creado_en, imagen_thumb
      FROM oficios_pendientes_ia
      WHERE usado = FALSE AND creado_en > NOW() - INTERVAL '3 days'
      ORDER BY creado_en DESC`;
    const conMiniatura = rows.map(({ imagen_thumb, ...resto }) => ({
      ...resto,
      miniatura: imagen_thumb ? `data:image/jpeg;base64,${imagen_thumb.toString('base64')}` : null,
    }));
    res.json(conMiniatura);
  } catch (err) {
    manejarError(res, err, 'No se pudieron obtener los registros pendientes.');
  }
});

/* ══ GET /api/oficios/pendientes/:id/imagen — sirve la foto original ══ */
/* Un <img src="..."> nunca puede mandar el header Authorization, así que
   servir la foto directo detrás de verifyToken no funciona (se probó y
   dio 401 en cada miniatura). Mismo patrón que ya usa el sistema para
   documentos (ver /doc-token/:slot + /api/docs/:token más abajo en el
   archivo): este endpoint SÍ pide Bearer token y solo entrega una URL
   de un solo propósito, corta vida, que el <img> puede usar directo. */
app.get('/api/oficios/pendientes/:id/imagen-token', verifyToken, onlyCoordOrAdmin, async (req, res) => {
  try {
    const [row] = await sql`SELECT id FROM oficios_pendientes_ia WHERE id = ${req.params.id}`;
    if (!row) return res.status(404).json({ mensaje: 'No encontrado.' });

    // ?tipo=mini (miniatura ligera, para la lista) o "full" (foto
    // completa, para la vista previa al pasar el cursor). Por defecto
    // "full" para no romper a nadie que no mande el parámetro.
    const tipo = req.query.tipo === 'mini' ? 'mini' : 'full';
    const token = jwt.sign(
      { propósito: 'imagen_pendiente', pendienteId: row.id, tipo },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    );
    res.json({ url: `/api/pendientes-imagen/${token}` });
  } catch (err) {
    manejarError(res, err, 'No se pudo generar el enlace de la imagen.');
  }
});

/* ══ GET /api/pendientes-imagen/:token — sirve la foto para un <img src>.
   Público (sin Authorization header) pero solo aceptable con el token
   de un solo propósito emitido arriba. ══ */
app.get('/api/pendientes-imagen/:token', async (req, res) => {
  try {
    let payload;
    try {
      payload = jwt.verify(req.params.token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).end();
    }
    if (payload?.propósito !== 'imagen_pendiente') return res.status(401).end();

    const [row] = await sql`SELECT imagen, imagen_mime, imagen_thumb FROM oficios_pendientes_ia WHERE id = ${payload.pendienteId}`;
    if (!row) return res.status(404).end();

    // Si se pidió miniatura y sí existe, se sirve esa (mucho más
    // ligera); si no hay miniatura (fotos viejas antes de este
    // cambio) cae de vuelta a la imagen completa.
    if (payload.tipo === 'mini' && row.imagen_thumb) {
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=1800');
      return res.send(row.imagen_thumb);
    }
    res.set('Content-Type', row.imagen_mime);
    res.set('Cache-Control', 'private, max-age=1800');
    res.send(row.imagen);
  } catch (err) {
    manejarError(res, err, 'No se pudo obtener la imagen.');
  }
});

/* ══ POST /api/oficios/pendientes/:id/reintentar — reprocesar con IA sin
   volver a tomar la foto (usa la imagen ya guardada). Para cuando Gemini
   falló por una caída pasajera. ══ */
app.post('/api/oficios/pendientes/:id/reintentar', verifyToken, onlyCoordOrAdmin, async (req, res) => {
  try {
    const [row] = await sql`SELECT imagen, imagen_mime FROM oficios_pendientes_ia WHERE id = ${req.params.id}`;
    if (!row) return res.status(404).json({ mensaje: 'No encontrado.' });

    await sql`UPDATE oficios_pendientes_ia SET estado = 'procesando', error_mensaje = NULL WHERE id = ${req.params.id}`;

    encolarRegistroPendienteIA(req.params.id, row.imagen.toString('base64'), row.imagen_mime);

    res.json({ ok: true, estado: 'procesando' });
  } catch (err) {
    manejarError(res, err, 'No se pudo reintentar el procesamiento.');
  }
});

/* ══ DELETE /api/oficios/pendientes/:id — descartar uno de la lista.
   Se llama tanto si la persona lo descarta a mano como, automáticamente,
   justo después de usarlo para guardar un registro (ver captura-auto.js). ══ */
app.delete('/api/oficios/pendientes/:id', verifyToken, onlyCoordOrAdmin, async (req, res) => {
  try {
    const rows = await sql`DELETE FROM oficios_pendientes_ia WHERE id = ${req.params.id} RETURNING id`;
    if (!rows[0]) return res.status(404).json({ mensaje: 'No encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    manejarError(res, err, 'No se pudo eliminar el registro pendiente.');
  }
});

/* ══ GET /api/oficios/:id ══ */
app.get('/api/oficios/:id', verifyToken, async (req, res) => {
  try {
    const [row] = await sql`SELECT * FROM oficios WHERE id = ${req.params.id}`;
    if (!row) return res.status(404).json({ mensaje: 'No encontrado.' });

    if (!puedeVerOficio(req.user, row))
      return res.status(403).json({ mensaje: 'Sin acceso.' });

    res.json(sanitizarOficio(row));
  } catch (err) {
    manejarError(res, err, 'No se pudo obtener el registro.');
  }
});

/* ══ POST /api/oficios — Exclusivo de Coordinación Administrativa (o el
   admin legado) ══ */

app.post('/api/oficios', verifyToken, onlyCoordOrAdmin, upload.fields([
  { name: 'doc1', maxCount: 1 },
  { name: 'doc2', maxCount: 1 },
  { name: 'doc3', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      f_sello, f_oficio, dias_entrega, numero, n_referencia,
      remitente, dependencia, instruccion, f_registro,
      folio_despacho, hora_recibido, descripcion, turnado_a
    } = req.body;

    if (!f_oficio || !remitente?.trim())
      return res.status(400).json({ mensaje: 'F. Oficio y Remitente son obligatorios.' });

    const areaOrigen = req.user.area || 'Coordinación Administrativa';
    const n_control   = await siguienteNControl(areaOrigen);

    const estatusInicial = turnado_a ? 'turnado' : 'por_turnar';

    const files     = req.files || {};
    const ruta_doc1 = files.doc1?.[0] ? await subirArchivoADrive(files.doc1[0]) : null;
    const ruta_doc2 = files.doc2?.[0] ? await subirArchivoADrive(files.doc2[0]) : null;
    // "doc3" (documento de Turno) solo llega aquí desde Registro
    // Automático: la propia foto del oficio, ya procesada a aspecto de
    // escaneo en el navegador (ver captura-auto.js), para que el área a
    // la que se turne ya no tenga que volver a digitalizarlo. En un
    // registro manual (Nuevo Registro) nunca se manda este campo, así
    // que ruta_doc3 queda null igual que antes.
    const ruta_doc3 = files.doc3?.[0] ? await subirArchivoADrive(files.doc3[0]) : null;

    const turnadoPor      = turnado_a ? req.user.username : null;
    const doc3SubidoPor   = ruta_doc3 ? req.user.username : null;

    const [nuevo] = await sql`
      INSERT INTO oficios (
        n_control, f_sello, f_oficio, dias_entrega, numero,
        n_referencia, remitente, dependencia, instruccion, f_registro,
        folio_despacho, turnado_a, turnado_por, hora_recibido, estatus, descripcion,
        ruta_doc1, ruta_doc2, ruta_doc3, doc3_subido_por, area_origen
      ) VALUES (
        ${n_control},
        ${f_sello        || null},
        ${f_oficio},
        ${Number(dias_entrega) || 0},
        ${truncar(numero, 60)         || null},
        ${truncar(n_referencia, 80)   || null},
        ${truncar(remitente.trim(), 300)},
        ${truncar(dependencia, 120)   || null},
        ${instruccion    || null},
        ${f_registro     || new Date().toISOString().split('T')[0]},
        ${truncar(folio_despacho, 40) || null},
        ${truncar(turnado_a, 120)     || null},
        ${turnadoPor},
        ${hora_recibido  || null},
        ${estatusInicial},
        ${descripcion    || null},
        ${ruta_doc1},
        ${ruta_doc2},
        ${ruta_doc3},
        ${doc3SubidoPor},
        ${areaOrigen}
      )
      RETURNING *`;

    console.log(`✅  Oficio creado por ${areaOrigen}: N. Control ${n_control} → ${estatusInicial}${turnado_a ? ' → ' + turnado_a : ''}`);
    res.status(201).json(sanitizarOficio(nuevo));
  } catch (err) {
    manejarError(res, err, 'Error al guardar.');
  }
});

/* ══ PUT /api/oficios/:id ══ */
app.put('/api/oficios/:id', verifyToken, upload.fields([
  { name: 'doc1', maxCount: 1 },
  { name: 'doc2', maxCount: 1 },
  { name: 'doc3', maxCount: 1 },
  { name: 'doc4', maxCount: 1 }
]), async (req, res) => {
  try {
    const [oficio] = await sql`SELECT * FROM oficios WHERE id = ${req.params.id}`;
    if (!oficio) return res.status(404).json({ mensaje: 'No encontrado.' });

    const { rol, area, id } = req.user;
    const files = req.files || {};

    const esSubTurnadoReceptor =
      rol === 'area' &&
      oficio.turnado_a === area &&
      req.body.usuario_asignado_id !== undefined &&
      req.body.estatus === undefined &&
      req.body.turnado_a === undefined;

    const esOrigen = !esSubTurnadoReceptor &&
      (rol === 'admin' || (rol === 'area' && oficio.area_origen === area));

    if (esOrigen) {
      const {
        estatus, turnado_a, instruccion, descripcion,
        obs_area, obs_admin, nota_rechazo,
        f_sello, f_oficio, dias_entrega, numero, n_referencia,
        remitente, dependencia, f_registro, folio_despacho, hora_recibido
      } = req.body;

      const estatusValidos = ['por_turnar', 'turnado', 'sub_turnado', 'atendido', 'rechazado', 'completado'];
      const nuevoEstatus = estatus && estatusValidos.includes(estatus) ? estatus : null;

      const ruta_doc1 = files.doc1?.[0] ? await subirArchivoADrive(files.doc1[0]) : null;
      const ruta_doc2 = files.doc2?.[0] ? await subirArchivoADrive(files.doc2[0]) : null;

      const limpiarAsignacion = nuevoEstatus === 'turnado' ? true : false;

      const turnadoPor = turnado_a ? req.user.username : null;

      const [updated] = await sql`
        UPDATE oficios SET
          estatus                 = COALESCE(${nuevoEstatus},   estatus),
          turnado_a               = COALESCE(${truncar(turnado_a, 120) ?? null}, turnado_a),
          turnado_por             = COALESCE(${turnadoPor}, turnado_por),
          instruccion             = COALESCE(${instruccion    ?? null}, instruccion),
          descripcion             = COALESCE(${descripcion    ?? null}, descripcion),
          obs_area                = COALESCE(${obs_area       ?? null}, obs_area),
          obs_admin               = COALESCE(${obs_admin      ?? null}, obs_admin),
          nota_rechazo            = COALESCE(${nota_rechazo   ?? null}, nota_rechazo),
          f_sello                 = COALESCE(${f_sello        ?? null}, f_sello),
          f_oficio                = COALESCE(${f_oficio       ?? null}, f_oficio),
          dias_entrega            = COALESCE(${dias_entrega !== undefined && dias_entrega !== null && dias_entrega !== '' ? Number(dias_entrega) : null}, dias_entrega),
          numero                  = COALESCE(${truncar(numero, 60)       ?? null}, numero),
          n_referencia            = COALESCE(${truncar(n_referencia, 80) ?? null}, n_referencia),
          remitente               = COALESCE(${truncar(remitente, 300)  ?? null}, remitente),
          dependencia             = COALESCE(${truncar(dependencia, 120) ?? null}, dependencia),
          f_registro              = COALESCE(${f_registro     ?? null}, f_registro),
          folio_despacho          = COALESCE(${truncar(folio_despacho, 40) ?? null}, folio_despacho),
          hora_recibido           = COALESCE(${hora_recibido  ?? null}, hora_recibido),
          ruta_doc1               = COALESCE(${ruta_doc1}, ruta_doc1),
          ruta_doc2               = COALESCE(${ruta_doc2}, ruta_doc2),
          usuario_asignado_id     = CASE WHEN ${limpiarAsignacion} THEN NULL ELSE usuario_asignado_id END,
          usuario_asignado_nombre = CASE WHEN ${limpiarAsignacion} THEN NULL ELSE usuario_asignado_nombre END,
          instrucciones_turno     = CASE WHEN ${limpiarAsignacion} THEN NULL ELSE instrucciones_turno END,
          updated_at              = NOW()
        WHERE id = ${req.params.id}
        RETURNING *`;
      return res.json(sanitizarOficio(updated));

    } else if (rol === 'area' && oficio.turnado_a === area) {
      const { usuario_asignado_id, estatus: estatusBody, obs_area, instrucciones_turno } = req.body;

      /* Caso 1: el oficio está asignado a este encargado (se lo autoasignó,
         o se lo asignó otro encargado de su área) y ahora lo marca como
         atendido (con sus observaciones y docs). */
      if (estatusBody === 'atendido') {
        if (oficio.usuario_asignado_id !== id)
          return res.status(403).json({ mensaje: 'Solo puedes marcar como atendido un oficio que tengas asignado.' });

        if (!oficio.ruta_doc3 && !files.doc3?.[0])
          return res.status(400).json({ mensaje: 'Falta el documento de Turno.' });

        const ruta_doc3 = files.doc3?.[0] ? await subirArchivoADrive(files.doc3[0]) : null;
        const ruta_doc4 = files.doc4?.[0] ? await subirArchivoADrive(files.doc4[0]) : null;

        const [updated] = await sql`
          UPDATE oficios SET
            obs_area        = COALESCE(${obs_area ?? null}, obs_area),
            estatus         = 'atendido',
            ruta_doc3       = COALESCE(${ruta_doc3}, ruta_doc3),
            ruta_doc4       = COALESCE(${ruta_doc4}, ruta_doc4),
            doc3_subido_por = COALESCE(${ruta_doc3 ? req.user.username : null}, doc3_subido_por),
            doc4_subido_por = COALESCE(${ruta_doc4 ? req.user.username : null}, doc4_subido_por),
            updated_at      = NOW()
          WHERE id = ${req.params.id}
          RETURNING *`;
        return res.json(sanitizarOficio(updated));
      }

      /* Caso 2: sub-turnar el oficio a alguien de su área —un usuario
         operativo (rol 'usuario_area') u otro encargado de turnar
         (rol 'area')—, o turnárselo a sí mismo (usuario_asignado_id ===
         su propio id), con una instrucción opcional para quien lo atienda
         y, opcionalmente, el documento de Turno (doc3) ya digitalizado:
         si el encargado lo adjunta aquí, se registra que él mismo lo
         subió (doc3_subido_por), y quien reciba el sub-turnado ya no
         tiene que volver a subirlo, solo visualizarlo; si no lo adjunta,
         queda pendiente de que lo suba quien atienda. */
      if (!usuario_asignado_id)
        return res.status(400).json({ mensaje: 'Debes seleccionar un usuario.' });

      let usuarioObj = null;
      if (Number(usuario_asignado_id) === id) {
        usuarioObj = { id, username: req.user.username };
      } else {
        [usuarioObj] = await sql`
          SELECT id, username FROM usuarios
          WHERE id = ${usuario_asignado_id}
            AND area = ${area}
            AND rol IN ('area', 'usuario_area')
            AND activo = TRUE`;
      }

      if (!usuarioObj)
        return res.status(400).json({ mensaje: 'El usuario no pertenece a esta área o no puede recibir oficios.' });

      const ruta_doc3 = files.doc3?.[0] ? await subirArchivoADrive(files.doc3[0]) : null;

      const [updated] = await sql`
        UPDATE oficios SET
          estatus                 = 'sub_turnado',
          usuario_asignado_id     = ${usuarioObj.id},
          usuario_asignado_nombre = ${usuarioObj.username},
          instrucciones_turno     = ${instrucciones_turno !== undefined ? (instrucciones_turno || null) : oficio.instrucciones_turno},
          ruta_doc3                = COALESCE(${ruta_doc3}, ruta_doc3),
          doc3_subido_por          = COALESCE(${ruta_doc3 ? req.user.username : null}, doc3_subido_por),
          updated_at              = NOW()
        WHERE id = ${req.params.id}
        RETURNING *`;
      return res.json(sanitizarOficio(updated));

    } else if (rol === 'usuario_area') {
      if (oficio.usuario_asignado_id !== id)
        return res.status(403).json({ mensaje: 'Sin acceso.' });

      const { obs_area, estatus: estatusBody } = req.body;
      const nuevoEstatus = estatusBody === 'atendido' ? 'atendido' : null;

      if (nuevoEstatus === 'atendido' && !oficio.ruta_doc3 && !files.doc3?.[0])
        return res.status(400).json({ mensaje: 'Falta el documento de Turno.' });

      const ruta_doc3 = files.doc3?.[0] ? await subirArchivoADrive(files.doc3[0]) : null;
      const ruta_doc4 = files.doc4?.[0] ? await subirArchivoADrive(files.doc4[0]) : null;

      const [updated] = await sql`
        UPDATE oficios SET
          obs_area        = COALESCE(${obs_area    ?? null}, obs_area),
          estatus         = COALESCE(${nuevoEstatus}, estatus),
          ruta_doc3       = COALESCE(${ruta_doc3},   ruta_doc3),
          ruta_doc4       = COALESCE(${ruta_doc4},   ruta_doc4),
          doc3_subido_por = COALESCE(${ruta_doc3 ? req.user.username : null}, doc3_subido_por),
          doc4_subido_por = COALESCE(${ruta_doc4 ? req.user.username : null}, doc4_subido_por),
          updated_at      = NOW()
        WHERE id = ${req.params.id}
        RETURNING *`;
      return res.json(sanitizarOficio(updated));

    } else {
      return res.status(403).json({ mensaje: 'Sin acceso a este registro.' });
    }

  } catch (err) {
    manejarError(res, err, 'No se pudo actualizar el registro.');
  }
});

/* ══ DELETE /api/oficios/:id ══ */
app.delete('/api/oficios/:id', verifyToken, async (req, res) => {
  try {
    const [row] = await sql`SELECT area_origen FROM oficios WHERE id = ${req.params.id}`;
    if (!row) return res.status(404).json({ mensaje: 'No encontrado.' });

    const { rol, area } = req.user;
    const puedeBorrar = rol === 'admin' || (rol === 'area' && row.area_origen === area);
    if (!puedeBorrar) return res.status(403).json({ mensaje: 'Sin acceso.' });

    await sql`DELETE FROM oficios WHERE id = ${req.params.id}`;
    console.log(`🗑️   Oficio ${req.params.id} eliminado`);
    res.json({ mensaje: 'Eliminado correctamente.' });
  } catch (err) {
    manejarError(res, err, 'No se pudo eliminar el registro.');
  }
});

/* ══════════════════════════════════════════════════════════════
   NO. DE OFICIO / MINUTARIO
   Folio consecutivo de oficios EMITIDOS por la Secretaría —
   independiente del historial de correspondencia RECIBIDA (tabla
   "oficios" de arriba). Minutario reutiliza exactamente los mismos
   registros: solo agrega Fecha de Sello / Fecha de Firma / Nota,
   capturables ahí después de creado el No. de Oficio.

   Exclusivo de Coordinación Administrativa (o el admin legado), igual
   que Nuevo Registro e Historial — ver onlyGestionCompleta arriba.

   Reglas del consecutivo:
     • "Automático" siempre toma el siguiente valor de no_oficio_seq,
       que NUNCA retrocede, ni siquiera si se elimina el último
       registro creado — así un número liberado no se vuelve a
       repartir por accidente.
     • Al eliminar un registro, su número pasa a "no_oficio_liberados"
       (los "Oficios libres") junto con la fecha en que quedó libre
       (liberado_en), y deja de existir en la tabla principal.
     • "Oficio Libre del Día" reserva el siguiente consecutivo y lo
       manda directo al pool de liberados, fechado hoy, sin crear
       ningún registro en no_oficio — para cuando un número se
       inutiliza y hay que dejarlo disponible de inmediato.
     • "Asignar Anteriores" toma un número de ese pool a propósito y
       lo saca de ahí al usarlo.
   ══════════════════════════════════════════════════════════════ */

async function siguienteNoOficioAutomatico() {
  const [{ siguiente }] = await sql`SELECT nextval('no_oficio_seq') AS siguiente`;
  return String(siguiente).padStart(4, '0');
}

/* ══ GET /api/no-oficio — lista completa (usada tanto por la vista
   "No. de Oficio" como por "Minutario") ══
   Orden: por el valor NUMÉRICO de no_oficio, de mayor a menor — no un
   ORDER BY no_oficio alfabético directo, porque eso compara los
   números como texto y ordena mal en cuanto varía la cantidad de
   dígitos o hay un sufijo (p. ej. "0003-1"). Se extrae solo la parte
   numérica inicial (regexp_replace corta desde el primer carácter que
   no es dígito) y se compara como entero; "id DESC" solo se usa como
   criterio de empate para casos idénticos (p. ej. reasignaciones). */
app.get('/api/no-oficio', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`
      SELECT * FROM no_oficio
      ORDER BY CAST(NULLIF(regexp_replace(no_oficio, '[^0-9].*$', ''), '') AS INTEGER) DESC, id DESC`;
    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudieron obtener los registros.');
  }
});

/* ══ GET /api/no-oficio/liberados — pool de números liberados, para el
   selector de "Asignar Anteriores" y el panel "Oficios Libres" (que
   muestra junto a cada número la fecha en que quedó disponible) ══ */
app.get('/api/no-oficio/liberados', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM no_oficio_liberados ORDER BY no_oficio ASC`;
    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudo obtener el listado de oficios libres.');
  }
});

/* ══ POST /api/no-oficio ══
   Body: { modo: 'automatico' | 'anterior', no_oficio (solo si modo es
   'anterior'), fecha, a_quien_se_dirige, asunto, area_solicitante,
   solicitante, hora }. */
app.post('/api/no-oficio', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const {
      modo, no_oficio: numeroElegido,
      fecha, a_quien_se_dirige, asunto, area_solicitante, solicitante, hora
    } = req.body;

    if (!fecha || !a_quien_se_dirige?.trim())
      return res.status(400).json({ mensaje: 'Fecha y A quién se dirige son obligatorios.' });

    let numero;
    if (modo === 'anterior') {
      if (!numeroElegido)
        return res.status(400).json({ mensaje: 'Selecciona un número de la lista de Oficios Libres.' });

      const [libre] = await sql`SELECT no_oficio FROM no_oficio_liberados WHERE no_oficio = ${numeroElegido}`;
      if (!libre)
        return res.status(400).json({ mensaje: 'Ese número ya no está disponible. Actualiza la lista de Oficios Libres.' });

      await sql`DELETE FROM no_oficio_liberados WHERE no_oficio = ${numeroElegido}`;
      numero = numeroElegido;
    } else {
      numero = await siguienteNoOficioAutomatico();
    }

    const [nuevo] = await sql`
      INSERT INTO no_oficio (
        no_oficio, fecha, a_quien_se_dirige, asunto,
        area_solicitante, solicitante, hora, creado_por
      ) VALUES (
        ${numero},
        ${fecha},
        ${a_quien_se_dirige.trim()},
        ${asunto            || null},
        ${area_solicitante  || null},
        ${solicitante       || null},
        ${hora              || null},
        ${req.user.username}
      )
      RETURNING *`;

    console.log(`✅  No. de Oficio creado por ${req.user.username}: ${numero} (${modo === 'anterior' ? 'reasignado' : 'automático'})`);
    res.status(201).json(nuevo);
  } catch (err) {
    // Carrera improbable: dos capturas simultáneas eligiendo el mismo
    // número liberado. La restricción UNIQUE de no_oficio lo evita a
    // nivel de base de datos; aquí solo se traduce a un mensaje claro.
    if (err.code === '23505') {
      return res.status(409).json({ mensaje: 'Ese número acaba de ser tomado por otra captura. Intenta de nuevo.' });
    }
    manejarError(res, err, 'Error al guardar el No. de Oficio.');
  }
});

/* ══ POST /api/no-oficio/libre-del-dia ══
   Reserva el siguiente número consecutivo automático (mismo contador
   que "Automático" en el modal de captura, no_oficio_seq) y lo deja
   directamente en el pool de "Oficios Libres" con la fecha de hoy,
   SIN crear ningún registro en no_oficio. Pensado para cuando un
   número se inutiliza (p. ej. un oficio impreso y desechado) y hay
   que dejarlo disponible de inmediato para reasignarse después, sin
   perder ni repetir el consecutivo. ══ */
app.post('/api/no-oficio/libre-del-dia', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const numero = await siguienteNoOficioAutomatico();

    const [liberado] = await sql`
      INSERT INTO no_oficio_liberados (no_oficio, liberado_por, liberado_en)
      VALUES (${numero}, ${req.user.username}, NOW())
      ON CONFLICT (no_oficio) DO NOTHING
      RETURNING *`;

    console.log(`🆓  No. de Oficio ${numero} reservado como "Libre del Día" por ${req.user.username}`);
    res.status(201).json(liberado || { no_oficio: numero, liberado_por: req.user.username });
  } catch (err) {
    manejarError(res, err, 'No se pudo reservar el número como libre del día.');
  }
});

/* ══ PUT /api/no-oficio/:id ══
   Edición de cualquier campo, incluidos Fecha de Sello / Fecha de
   Firma / Nota (los únicos que edita la vista Minutario). Solo se
   actualizan los campos presentes en el body. */
app.put('/api/no-oficio/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const [existente] = await sql`SELECT * FROM no_oficio WHERE id = ${req.params.id}`;
    if (!existente) return res.status(404).json({ mensaje: 'No encontrado.' });

    const {
      fecha, a_quien_se_dirige, asunto, area_solicitante,
      solicitante, hora, fecha_sello, fecha_firma, nota
    } = req.body;

    const [actualizado] = await sql`
      UPDATE no_oficio SET
        fecha             = COALESCE(${fecha             ?? null}, fecha),
        a_quien_se_dirige = COALESCE(${a_quien_se_dirige  ?? null}, a_quien_se_dirige),
        asunto            = ${asunto            !== undefined ? (asunto            || null) : existente.asunto},
        area_solicitante  = ${area_solicitante  !== undefined ? (area_solicitante  || null) : existente.area_solicitante},
        solicitante       = ${solicitante       !== undefined ? (solicitante       || null) : existente.solicitante},
        hora              = ${hora              !== undefined ? (hora              || null) : existente.hora},
        fecha_sello       = ${fecha_sello       !== undefined ? (fecha_sello       || null) : (existente.fecha_sello ?? null)},
        fecha_firma       = ${fecha_firma       !== undefined ? (fecha_firma       || null) : (existente.fecha_firma ?? null)},
        nota              = ${nota              !== undefined ? (nota              || null) : (existente.nota ?? null)},
        updated_at        = NOW()
      WHERE id = ${req.params.id}
      RETURNING *`;

    res.json(actualizado);
  } catch (err) {
    manejarError(res, err, 'No se pudo actualizar el registro.');
  }
});

/* ══ DELETE /api/no-oficio/:id ══
   Elimina el registro y libera su número: NO se reasigna en automático
   después (no_oficio_seq nunca retrocede), solo queda disponible para
   "Asignar Anteriores". Se registra también la fecha/hora en que
   quedó libre (liberado_en), para mostrarla junto al número en el
   panel de "Oficios Libres" (p. ej. "236-08/12/25"). */
app.delete('/api/no-oficio/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const [row] = await sql`SELECT no_oficio FROM no_oficio WHERE id = ${req.params.id}`;
    if (!row) return res.status(404).json({ mensaje: 'No encontrado.' });

    await sql`DELETE FROM no_oficio WHERE id = ${req.params.id}`;
    await sql`
      INSERT INTO no_oficio_liberados (no_oficio, liberado_por, liberado_en)
      VALUES (${row.no_oficio}, ${req.user.username}, NOW())
      ON CONFLICT (no_oficio) DO NOTHING`;

    console.log(`🗑️   No. de Oficio ${row.no_oficio} eliminado por ${req.user.username} — número liberado`);
    res.json({ mensaje: `Eliminado. El número ${row.no_oficio} quedó libre para reutilizarse.` });
  } catch (err) {
    manejarError(res, err, 'No se pudo eliminar el registro.');
  }
});

/* ══════════════════════════════════════════════════════════════
   NO. CIRCULAR
   Exactamente la misma mecánica que NO. DE OFICIO de arriba —
   consecutivo propio (circular_seq) que nunca retrocede, pool de
   liberados (circular_liberados), "Circular Libre del Día" — pero
   con su propia tabla y numeración, totalmente independiente. El
   Minutario muestra estos registros en su propia pestaña.
   ══════════════════════════════════════════════════════════════ */

async function siguienteCircularAutomatico() {
  const [{ siguiente }] = await sql`SELECT nextval('circular_seq') AS siguiente`;
  return String(siguiente).padStart(4, '0');
}

app.get('/api/circular', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`
      SELECT * FROM circular
      ORDER BY CAST(NULLIF(regexp_replace(no_circular, '[^0-9].*$', ''), '') AS INTEGER) DESC, id DESC`;
    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudieron obtener los registros.');
  }
});

app.get('/api/circular/liberados', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM circular_liberados ORDER BY no_circular ASC`;
    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudo obtener el listado de circulares libres.');
  }
});

app.post('/api/circular', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const {
      modo, no_circular: numeroElegido,
      fecha, a_quien_se_dirige, asunto, area_solicitante, solicitante, hora
    } = req.body;

    if (!fecha || !a_quien_se_dirige?.trim())
      return res.status(400).json({ mensaje: 'Fecha y A quién se dirige son obligatorios.' });

    let numero;
    if (modo === 'anterior') {
      if (!numeroElegido)
        return res.status(400).json({ mensaje: 'Selecciona un número de la lista de Circulares Libres.' });

      const [libre] = await sql`SELECT no_circular FROM circular_liberados WHERE no_circular = ${numeroElegido}`;
      if (!libre)
        return res.status(400).json({ mensaje: 'Ese número ya no está disponible. Actualiza la lista de Circulares Libres.' });

      await sql`DELETE FROM circular_liberados WHERE no_circular = ${numeroElegido}`;
      numero = numeroElegido;
    } else {
      numero = await siguienteCircularAutomatico();
    }

    const [nuevo] = await sql`
      INSERT INTO circular (
        no_circular, fecha, a_quien_se_dirige, asunto,
        area_solicitante, solicitante, hora, creado_por
      ) VALUES (
        ${numero},
        ${fecha},
        ${a_quien_se_dirige.trim()},
        ${asunto            || null},
        ${area_solicitante  || null},
        ${solicitante       || null},
        ${hora              || null},
        ${req.user.username}
      )
      RETURNING *`;

    console.log(`✅  No. Circular creado por ${req.user.username}: ${numero} (${modo === 'anterior' ? 'reasignado' : 'automático'})`);
    res.status(201).json(nuevo);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ mensaje: 'Ese número acaba de ser tomado por otra captura. Intenta de nuevo.' });
    }
    manejarError(res, err, 'Error al guardar el No. Circular.');
  }
});

app.post('/api/circular/libre-del-dia', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const numero = await siguienteCircularAutomatico();

    const [liberado] = await sql`
      INSERT INTO circular_liberados (no_circular, liberado_por, liberado_en)
      VALUES (${numero}, ${req.user.username}, NOW())
      ON CONFLICT (no_circular) DO NOTHING
      RETURNING *`;

    console.log(`🆓  No. Circular ${numero} reservado como "Libre del Día" por ${req.user.username}`);
    res.status(201).json(liberado || { no_circular: numero, liberado_por: req.user.username });
  } catch (err) {
    manejarError(res, err, 'No se pudo reservar el número como libre del día.');
  }
});

app.put('/api/circular/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const [existente] = await sql`SELECT * FROM circular WHERE id = ${req.params.id}`;
    if (!existente) return res.status(404).json({ mensaje: 'No encontrado.' });

    const {
      fecha, a_quien_se_dirige, asunto, area_solicitante,
      solicitante, hora, fecha_sello, fecha_firma, nota
    } = req.body;

    const [actualizado] = await sql`
      UPDATE circular SET
        fecha             = COALESCE(${fecha             ?? null}, fecha),
        a_quien_se_dirige = COALESCE(${a_quien_se_dirige  ?? null}, a_quien_se_dirige),
        asunto            = ${asunto            !== undefined ? (asunto            || null) : existente.asunto},
        area_solicitante  = ${area_solicitante  !== undefined ? (area_solicitante  || null) : existente.area_solicitante},
        solicitante       = ${solicitante       !== undefined ? (solicitante       || null) : existente.solicitante},
        hora              = ${hora              !== undefined ? (hora              || null) : existente.hora},
        fecha_sello       = ${fecha_sello       !== undefined ? (fecha_sello       || null) : (existente.fecha_sello ?? null)},
        fecha_firma       = ${fecha_firma       !== undefined ? (fecha_firma       || null) : (existente.fecha_firma ?? null)},
        nota              = ${nota              !== undefined ? (nota              || null) : (existente.nota ?? null)},
        updated_at        = NOW()
      WHERE id = ${req.params.id}
      RETURNING *`;

    res.json(actualizado);
  } catch (err) {
    manejarError(res, err, 'No se pudo actualizar el registro.');
  }
});

app.delete('/api/circular/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const [row] = await sql`SELECT no_circular FROM circular WHERE id = ${req.params.id}`;
    if (!row) return res.status(404).json({ mensaje: 'No encontrado.' });

    await sql`DELETE FROM circular WHERE id = ${req.params.id}`;
    await sql`
      INSERT INTO circular_liberados (no_circular, liberado_por, liberado_en)
      VALUES (${row.no_circular}, ${req.user.username}, NOW())
      ON CONFLICT (no_circular) DO NOTHING`;

    console.log(`🗑️   No. Circular ${row.no_circular} eliminado por ${req.user.username} — número liberado`);
    res.json({ mensaje: `Eliminado. El número ${row.no_circular} quedó libre para reutilizarse.` });
  } catch (err) {
    manejarError(res, err, 'No se pudo eliminar el registro.');
  }
});

/* ══════════════════════════════════════════════════════════════
   NO. TARJETA INFORMATIVA
   Misma mecánica que NO. DE OFICIO / NO. CIRCULAR, con su propia
   tabla, secuencia (tarjeta_informativa_seq) y pool de liberados
   (tarjeta_informativa_liberados), totalmente independiente.
   ══════════════════════════════════════════════════════════════ */

async function siguienteTarjetaAutomatico() {
  const [{ siguiente }] = await sql`SELECT nextval('tarjeta_informativa_seq') AS siguiente`;
  return String(siguiente).padStart(4, '0');
}

app.get('/api/tarjeta-informativa', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`
      SELECT * FROM tarjeta_informativa
      ORDER BY CAST(NULLIF(regexp_replace(no_tarjeta, '[^0-9].*$', ''), '') AS INTEGER) DESC, id DESC`;
    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudieron obtener los registros.');
  }
});

app.get('/api/tarjeta-informativa/liberados', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM tarjeta_informativa_liberados ORDER BY no_tarjeta ASC`;
    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudo obtener el listado de tarjetas libres.');
  }
});

app.post('/api/tarjeta-informativa', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const {
      modo, no_tarjeta: numeroElegido,
      fecha, a_quien_se_dirige, asunto, area_solicitante, solicitante, hora
    } = req.body;

    if (!fecha || !a_quien_se_dirige?.trim())
      return res.status(400).json({ mensaje: 'Fecha y A quién se dirige son obligatorios.' });

    let numero;
    if (modo === 'anterior') {
      if (!numeroElegido)
        return res.status(400).json({ mensaje: 'Selecciona un número de la lista de Tarjetas Libres.' });

      const [libre] = await sql`SELECT no_tarjeta FROM tarjeta_informativa_liberados WHERE no_tarjeta = ${numeroElegido}`;
      if (!libre)
        return res.status(400).json({ mensaje: 'Ese número ya no está disponible. Actualiza la lista de Tarjetas Libres.' });

      await sql`DELETE FROM tarjeta_informativa_liberados WHERE no_tarjeta = ${numeroElegido}`;
      numero = numeroElegido;
    } else {
      numero = await siguienteTarjetaAutomatico();
    }

    const [nuevo] = await sql`
      INSERT INTO tarjeta_informativa (
        no_tarjeta, fecha, a_quien_se_dirige, asunto,
        area_solicitante, solicitante, hora, creado_por
      ) VALUES (
        ${numero},
        ${fecha},
        ${a_quien_se_dirige.trim()},
        ${asunto            || null},
        ${area_solicitante  || null},
        ${solicitante       || null},
        ${hora              || null},
        ${req.user.username}
      )
      RETURNING *`;

    console.log(`✅  No. Tarjeta Informativa creado por ${req.user.username}: ${numero} (${modo === 'anterior' ? 'reasignado' : 'automático'})`);
    res.status(201).json(nuevo);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ mensaje: 'Ese número acaba de ser tomado por otra captura. Intenta de nuevo.' });
    }
    manejarError(res, err, 'Error al guardar la No. Tarjeta Informativa.');
  }
});

app.post('/api/tarjeta-informativa/libre-del-dia', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const numero = await siguienteTarjetaAutomatico();

    const [liberado] = await sql`
      INSERT INTO tarjeta_informativa_liberados (no_tarjeta, liberado_por, liberado_en)
      VALUES (${numero}, ${req.user.username}, NOW())
      ON CONFLICT (no_tarjeta) DO NOTHING
      RETURNING *`;

    console.log(`🆓  No. Tarjeta Informativa ${numero} reservado como "Libre del Día" por ${req.user.username}`);
    res.status(201).json(liberado || { no_tarjeta: numero, liberado_por: req.user.username });
  } catch (err) {
    manejarError(res, err, 'No se pudo reservar el número como libre del día.');
  }
});

app.put('/api/tarjeta-informativa/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const [existente] = await sql`SELECT * FROM tarjeta_informativa WHERE id = ${req.params.id}`;
    if (!existente) return res.status(404).json({ mensaje: 'No encontrado.' });

    const {
      fecha, a_quien_se_dirige, asunto, area_solicitante,
      solicitante, hora, fecha_sello, fecha_firma, nota
    } = req.body;

    const [actualizado] = await sql`
      UPDATE tarjeta_informativa SET
        fecha             = COALESCE(${fecha             ?? null}, fecha),
        a_quien_se_dirige = COALESCE(${a_quien_se_dirige  ?? null}, a_quien_se_dirige),
        asunto            = ${asunto            !== undefined ? (asunto            || null) : existente.asunto},
        area_solicitante  = ${area_solicitante  !== undefined ? (area_solicitante  || null) : existente.area_solicitante},
        solicitante       = ${solicitante       !== undefined ? (solicitante       || null) : existente.solicitante},
        hora              = ${hora              !== undefined ? (hora              || null) : existente.hora},
        fecha_sello       = ${fecha_sello       !== undefined ? (fecha_sello       || null) : (existente.fecha_sello ?? null)},
        fecha_firma       = ${fecha_firma       !== undefined ? (fecha_firma       || null) : (existente.fecha_firma ?? null)},
        nota              = ${nota              !== undefined ? (nota              || null) : (existente.nota ?? null)},
        updated_at        = NOW()
      WHERE id = ${req.params.id}
      RETURNING *`;

    res.json(actualizado);
  } catch (err) {
    manejarError(res, err, 'No se pudo actualizar el registro.');
  }
});

app.delete('/api/tarjeta-informativa/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const [row] = await sql`SELECT no_tarjeta FROM tarjeta_informativa WHERE id = ${req.params.id}`;
    if (!row) return res.status(404).json({ mensaje: 'No encontrado.' });

    await sql`DELETE FROM tarjeta_informativa WHERE id = ${req.params.id}`;
    await sql`
      INSERT INTO tarjeta_informativa_liberados (no_tarjeta, liberado_por, liberado_en)
      VALUES (${row.no_tarjeta}, ${req.user.username}, NOW())
      ON CONFLICT (no_tarjeta) DO NOTHING`;

    console.log(`🗑️   No. Tarjeta Informativa ${row.no_tarjeta} eliminado por ${req.user.username} — número liberado`);
    res.json({ mensaje: `Eliminado. El número ${row.no_tarjeta} quedó libre para reutilizarse.` });
  } catch (err) {
    manejarError(res, err, 'No se pudo eliminar el registro.');
  }
});

/* ══ POST /api/oficios/generar-pdf ══ */
app.post('/api/oficios/generar-pdf', verifyToken, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 4)
      return res.status(400).json({ mensaje: 'Debes seleccionar entre 1 y 4 registros.' });

    if (!process.env.APPS_SCRIPT_URL)
      return res.status(500).json({ mensaje: 'APPS_SCRIPT_URL no está configurada en el servidor.' });

    const oficios = [];
    for (const id of ids) {
      const [row] = await sql`SELECT * FROM oficios WHERE id = ${id}`;
      if (!row) return res.status(404).json({ mensaje: `Oficio con id ${id} no encontrado.` });
      oficios.push(row);
    }

    const registros = oficios.map(o => ({
      fecha:      formatearFechaMX(o.f_oficio),
      referencia: o.numero || '',
      remitente:  o.remitente || '',
      asunto:     o.descripcion || '',
      control:    o.n_control || '',
    }));

    const resp = await fetch(process.env.APPS_SCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ registros }),
      redirect: 'follow',
    });

    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'El Apps Script devolvió un error.');

    const [guardado] = await sql`
      INSERT INTO pdfs_generados (oficio_ids, folios, url, file_id, generado_por, area)
      VALUES (${ids}, ${data.folios}, ${data.url}, ${data.fileId || null}, ${req.user.username}, ${req.user.area || null})
      RETURNING *`;

    console.log(`📄  PDF generado por ${req.user.username} (${req.user.area || 'sin área'}) — N. Control: ${data.folios.join(', ')}`);
    res.json(guardado);

  } catch (err) {
    manejarError(res, err, 'Error al generar el PDF.');
  }
});

/* ══ DELETE /api/pdfs-generados/:id ══ */
app.delete('/api/pdfs-generados/:id', verifyToken, async (req, res) => {
  try {
    const [row] = await sql`SELECT * FROM pdfs_generados WHERE id = ${req.params.id}`;
    if (!row) return res.status(404).json({ mensaje: 'No encontrado.' });

    const { rol, area } = req.user;
    const puedeBorrar = rol === 'admin' || (row.area != null && row.area === area);
    if (!puedeBorrar) return res.status(403).json({ mensaje: 'Sin acceso.' });

    if (row.file_id && process.env.APPS_SCRIPT_URL) {
      try {
        const resp = await fetch(process.env.APPS_SCRIPT_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: 'eliminar', fileId: row.file_id }),
          redirect: 'follow',
        });
        const data = await resp.json();
        if (!data.ok) console.warn('⚠️  No se pudo borrar el archivo en Drive:', data.error);
      } catch (driveErr) {
        console.warn('⚠️  Error al intentar borrar el archivo en Drive:', driveErr.message);
      }
    }

    await sql`DELETE FROM pdfs_generados WHERE id = ${req.params.id}`;
    console.log(`🗑️   PDF generado (id ${req.params.id}) eliminado del historial.`);
    res.json({ mensaje: 'Eliminado correctamente.' });
  } catch (err) {
    manejarError(res, err, 'No se pudo eliminar el PDF.');
  }
});

/* ══ GET /api/pdfs-generados ══ */
app.get('/api/pdfs-generados', verifyToken, async (req, res) => {
  try {
    const { rol, area } = req.user;
    const rows = rol === 'admin'
      ? await sql`SELECT * FROM pdfs_generados ORDER BY created_at DESC LIMIT 50`
      : await sql`SELECT * FROM pdfs_generados WHERE area = ${area} ORDER BY created_at DESC LIMIT 50`;
    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudo obtener el historial de PDFs.');
  }
});

function formatearFechaMX(fecha) {
  if (!fecha) return '';
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/* ══════════════════════════════════════════════════════
   MÓDULO: SALAS (dentro de Coordinación)
   Catálogo de salas + apartados por fecha y rango de hora
   (hora_inicio/hora_fin). Igual que No. de Oficio / Circular /
   Tarjeta Informativa, exclusivo de Coordinación Administrativa
   (onlyGestionCompleta). La restricción EXCLUDE USING gist en la
   BD es lo que impide traslapes reales entre rangos — aquí solo
   se traduce el error 23P01 a un mensaje claro para el usuario.
   ══════════════════════════════════════════════════════ */

/* ══ GET /api/salas — catálogo de salas ══ */
app.get('/api/salas', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM salas ORDER BY nombre ASC`;
    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudieron obtener las salas.');
  }
});

/* ══ POST /api/salas — registrar sala nueva. Body: { nombre } ══ */
app.post('/api/salas', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const nombre = req.body?.nombre?.trim();
    if (!nombre) return res.status(400).json({ mensaje: 'El nombre de la sala es obligatorio.' });

    const [nueva] = await sql`
      INSERT INTO salas (nombre) VALUES (${nombre}) RETURNING *`;

    res.status(201).json(nueva);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ mensaje: 'Ya existe una sala con ese nombre.' });
    }
    manejarError(res, err, 'Error al registrar la sala.');
  }
});

/* ══ DELETE /api/salas/:id — eliminar una sala del catálogo.
   Antes de borrar, cualquier apartado vigente de esa sala se registra
   en salas_historial (motivo "sala_eliminada") para que no desaparezca
   sin dejar rastro. Después, ON DELETE CASCADE en salas_apartados
   limpia esos apartados junto con la sala. */
app.delete('/api/salas/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const [sala] = await sql`SELECT * FROM salas WHERE id = ${req.params.id}`;
    if (!sala) return res.status(404).json({ mensaje: 'Sala no encontrada.' });

    const apartados = await sql`SELECT * FROM salas_apartados WHERE sala_id = ${sala.id}`;
    for (const ap of apartados) {
      await sql`
        INSERT INTO salas_historial (sala_id, sala_nombre, fecha, hora_inicio, hora_fin, personas, descripcion, no_oficio, creado_por, motivo_eliminacion, eliminado_por)
        VALUES (${ap.sala_id}, ${sala.nombre}, ${ap.fecha}, ${ap.hora_inicio}, ${ap.hora_fin}, ${ap.personas}, ${ap.descripcion}, ${ap.no_oficio}, ${ap.creado_por}, 'sala_eliminada', ${req.user.username})`;
    }

    await sql`DELETE FROM salas WHERE id = ${sala.id}`;
    res.json({ ok: true });
  } catch (err) {
    manejarError(res, err, 'Error al eliminar la sala.');
  }
});

/* ══ GET /api/salas/proximo-folio-nota — sugerencia del número de
   tarjeta (Nota) para el próximo apartado, MÁS la lista de folios ya
   usados (para que el frontend avise si se repite uno, sin bloquear
   nada — los duplicados están permitidos a propósito).
   Sugerencia = el folio numérico más alto que exista (en apartados
   vigentes o en el historial) + 1. Es solo eso, un cálculo de lectura:
   no reserva nada ni toca ninguna secuencia, así que se puede pedir
   tantas veces como se quiera sin gastar folios. Si la persona edita
   el número antes de apartar la sala, ese valor manual es el que se
   usa (ver POST /api/salas/apartados) y la SIGUIENTE sugerencia sale
   de ahí en adelante (max+1), tal como se pidió. ══ */
app.get('/api/salas/proximo-folio-nota', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const [{ max_folio }] = await sql`
      SELECT MAX(v) AS max_folio FROM (
        SELECT NULLIF(regexp_replace(folio_nota, '[^0-9]', '', 'g'), '')::int AS v
          FROM salas_apartados WHERE folio_nota IS NOT NULL
        UNION ALL
        SELECT NULLIF(regexp_replace(folio_nota, '[^0-9]', '', 'g'), '')::int AS v
          FROM salas_historial WHERE folio_nota IS NOT NULL
      ) t`;
    const siguiente = (max_folio ?? 76) + 1;

    const usados = await sql`
      SELECT folio_nota FROM salas_apartados WHERE folio_nota IS NOT NULL
      UNION
      SELECT folio_nota FROM salas_historial WHERE folio_nota IS NOT NULL`;

    res.json({
      siguiente: String(siguiente).padStart(4, '0'),
      usados: usados.map(r => r.folio_nota),
    });
  } catch (err) {
    manejarError(res, err, 'No se pudo calcular el siguiente folio de Nota.');
  }
});

/* ══ GET /api/salas/apartados — trae todos los apartados vigentes
   (de todas las salas), ordenados del más próximo al más lejano,
   para el tendedero de tarjetas. ══ */
app.get('/api/salas/apartados', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`
      SELECT sa.*, s.nombre AS sala_nombre
      FROM salas_apartados sa
      JOIN salas s ON s.id = sa.sala_id
      ORDER BY sa.fecha ASC, sa.hora_inicio ASC`;

    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudieron obtener los apartados.');
  }
});

/* ══ POST /api/salas/apartados — apartar una sala.
   Body: { sala_id, fecha, hora_inicio, hora_fin, personas, descripcion,
           no_oficio, prestamo }
   Se espera a que el PDF de la Nota esté listo (Gemini + Apps Script,
   con sus reintentos — puede tardar del orden de 10-20s) ANTES de
   responder: el registro no se da por creado hasta que folio y PDF
   están completos, para que en pantalla nunca aparezca un apartado "a
   medias". El frontend cubre esta espera con la ventana "Apartando
   sala…". Si Drive/Apps Script falla incluso tras los reintentos, el
   apartado se guarda igual — solo queda sin nota_pdf_url. ══ */
app.post('/api/salas/apartados', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const { sala_id, fecha, hora_inicio, hora_fin, personas, descripcion, no_oficio, prestamo } = req.body || {};
    if (!sala_id || !fecha || !hora_inicio || !hora_fin) {
      return res.status(400).json({ mensaje: 'Sala, fecha, hora de inicio y hora de fin son obligatorios.' });
    }
    if (hora_fin <= hora_inicio) {
      return res.status(400).json({ mensaje: 'La hora de fin debe ser posterior a la hora de inicio.' });
    }
    const numPersonas = parseInt(personas, 10);
    if (!Number.isInteger(numPersonas) || numPersonas < 1) {
      return res.status(400).json({ mensaje: 'Indica cuántas personas ocuparán la sala (mínimo 1).' });
    }
    const desc = descripcion?.trim();
    if (!desc) {
      return res.status(400).json({ mensaje: 'La descripción del evento es obligatoria.' });
    }
    const oficio = no_oficio?.trim() || null;
    const solicitudPrestamo = prestamo?.trim() || null;

    const [sala] = await sql`SELECT nombre FROM salas WHERE id = ${sala_id}`;
    if (!sala) return res.status(409).json({ mensaje: 'Esa sala ya no existe — actualiza la página y vuelve a intentar.' });

    // El número de la tarjeta (folio de la Nota) se puede editar en el
    // formulario antes de apartar — si viene, se usa TAL CUAL (se
    // permiten duplicados a propósito, el frontend solo avisa). Si no
    // viene (o llega vacío), se cae al automático de siempre.
    const folioNota = normalizarFolioNota(req.body.folio_nota) || await siguienteNotaAutomatica();
    const notaPdfUrl = await generarNotaSalaPDF({
      notj: folioNota, sala: sala.nombre, np: numPersonas,
      horaInicio: hora_inicio, horaFin: hora_fin, fecha, descripcion: desc, prestamo: solicitudPrestamo,
    });

    const [nuevo] = await sql`
      INSERT INTO salas_apartados
        (sala_id, fecha, hora_inicio, hora_fin, personas, descripcion, no_oficio, prestamo, folio_nota, nota_pdf_url, creado_por)
      VALUES
        (${sala_id}, ${fecha}, ${hora_inicio}, ${hora_fin}, ${numPersonas}, ${desc}, ${oficio}, ${solicitudPrestamo}, ${folioNota}, ${notaPdfUrl}, ${req.user.username})
      RETURNING *`;

    const [conNombre] = await sql`
      SELECT sa.*, s.nombre AS sala_nombre
      FROM salas_apartados sa JOIN salas s ON s.id = sa.sala_id
      WHERE sa.id = ${nuevo.id}`;

    res.status(201).json(conNombre);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ mensaje: 'Esa sala ya no existe — actualiza la página y vuelve a intentar.' });
    }
    if (err.code === '23P01') {
      return res.status(409).json({ mensaje: 'Esa sala ya está ocupada en ese horario. Elige otro rango.' });
    }
    manejarError(res, err, 'Error al apartar la sala.');
  }
});

/* ══ PUT /api/salas/apartados/:id — editar un apartado existente.
   Mismas validaciones y mismo manejo de traslapes que al crear uno
   nuevo; la exclusión por rango en la BD también aplica en la edición
   (compara contra las demás filas, no contra sí misma). ══ */
app.put('/api/salas/apartados/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const { sala_id, fecha, hora_inicio, hora_fin, personas, descripcion, no_oficio, prestamo } = req.body || {};
    if (!sala_id || !fecha || !hora_inicio || !hora_fin) {
      return res.status(400).json({ mensaje: 'Sala, fecha, hora de inicio y hora de fin son obligatorios.' });
    }
    if (hora_fin <= hora_inicio) {
      return res.status(400).json({ mensaje: 'La hora de fin debe ser posterior a la hora de inicio.' });
    }
    const numPersonas = parseInt(personas, 10);
    if (!Number.isInteger(numPersonas) || numPersonas < 1) {
      return res.status(400).json({ mensaje: 'Indica cuántas personas ocuparán la sala (mínimo 1).' });
    }
    const desc = descripcion?.trim();
    if (!desc) {
      return res.status(400).json({ mensaje: 'La descripción del evento es obligatoria.' });
    }
    const oficio = no_oficio?.trim() || null;
    const solicitudPrestamo = prestamo?.trim() || null;

    // No se regenera el PDF de la Nota al editar (folio_nota/nota_pdf_url
    // quedan igual) — evitaría gastar un folio nuevo cada vez que se
    // corrige un dato. Si hace falta regenerarla, se hace aparte.
    const rows = await sql`
      UPDATE salas_apartados
      SET sala_id = ${sala_id}, fecha = ${fecha}, hora_inicio = ${hora_inicio}, hora_fin = ${hora_fin},
          personas = ${numPersonas}, descripcion = ${desc}, no_oficio = ${oficio}, prestamo = ${solicitudPrestamo}
      WHERE id = ${req.params.id}
      RETURNING id`;
    if (!rows[0]) return res.status(404).json({ mensaje: 'Apartado no encontrado.' });

    const [conNombre] = await sql`
      SELECT sa.*, s.nombre AS sala_nombre
      FROM salas_apartados sa JOIN salas s ON s.id = sa.sala_id
      WHERE sa.id = ${req.params.id}`;

    res.json(conNombre);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ mensaje: 'Esa sala ya no existe — actualiza la página y vuelve a intentar.' });
    }
    if (err.code === '23P01') {
      return res.status(409).json({ mensaje: 'Esa sala ya está ocupada en ese horario. Elige otro rango.' });
    }
    manejarError(res, err, 'Error al guardar los cambios del apartado.');
  }
});

/* ══ DELETE /api/salas/apartados/:id — quitar una tarjeta.
   Antes de borrar, registra el apartado en salas_historial. El motivo
   ("vencido" o "cancelado") se calcula en el servidor comparando la
   hora de FIN del apartado (el evento no se considera terminado hasta
   entonces) contra el momento real de borrado, para no depender de lo
   que diga el cliente. ══ */
app.delete('/api/salas/apartados/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const [apartado] = await sql`
      SELECT sa.*, s.nombre AS sala_nombre
      FROM salas_apartados sa JOIN salas s ON s.id = sa.sala_id
      WHERE sa.id = ${req.params.id}`;
    if (!apartado) return res.status(404).json({ mensaje: 'Apartado no encontrado.' });

    const finApartado = new Date(`${apartado.fecha.toISOString().slice(0, 10)}T${apartado.hora_fin}`);
    const motivoEliminacion = finApartado < new Date() ? 'vencido' : 'cancelado';

    await sql`
      INSERT INTO salas_historial (sala_id, sala_nombre, fecha, hora_inicio, hora_fin, personas, descripcion, no_oficio, prestamo, folio_nota, nota_pdf_url, creado_por, motivo_eliminacion, eliminado_por)
      VALUES (${apartado.sala_id}, ${apartado.sala_nombre}, ${apartado.fecha}, ${apartado.hora_inicio}, ${apartado.hora_fin}, ${apartado.personas}, ${apartado.descripcion}, ${apartado.no_oficio}, ${apartado.prestamo}, ${apartado.folio_nota}, ${apartado.nota_pdf_url}, ${apartado.creado_por}, ${motivoEliminacion}, ${req.user.username})`;

    await sql`DELETE FROM salas_apartados WHERE id = ${req.params.id}`;
    res.json({ ok: true, motivo_eliminacion: motivoEliminacion });
  } catch (err) {
    manejarError(res, err, 'Error al cancelar el apartado.');
  }
});

/* ══ GET /api/salas/historial — bitácora de tarjetas eliminadas ══ */
app.get('/api/salas/historial', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM salas_historial ORDER BY eliminado_en DESC LIMIT 200`;
    res.json(rows);
  } catch (err) {
    manejarError(res, err, 'No se pudo obtener el historial de salas.');
  }
});

/* ══ DELETE /api/salas/historial/:id — borrar un registro del historial ══ */
/* Al eliminar PERMANENTEMENTE un registro del historial (el que ya trae
   fecha/motivo/quién lo quitó), si tenía folio de Nota se libera: queda
   disponible para que siguienteNotaAutomatica() lo reasigne en la
   siguiente sala apartada, en vez de perderse para siempre. */
app.delete('/api/salas/historial/:id', verifyToken, onlyGestionCompleta, async (req, res) => {
  try {
    const rows = await sql`DELETE FROM salas_historial WHERE id = ${req.params.id} RETURNING folio_nota`;
    if (!rows[0]) return res.status(404).json({ mensaje: 'Registro de historial no encontrado.' });

    if (rows[0].folio_nota) {
      await sql`
        INSERT INTO nota_liberados (folio_nota, liberado_por)
        VALUES (${rows[0].folio_nota}, ${req.user.username})
        ON CONFLICT (folio_nota) DO NOTHING`;
    }

    res.json({ ok: true });
  } catch (err) {
    manejarError(res, err, 'Error al eliminar el registro del historial.');
  }
});

/* ══ Cualquier ruta /api no reconocida responde en JSON ══
   Sin esto, una URL de API mal escrita o un endpoint que ya no existe
   caía en el 404 HTML por defecto de Express, y el frontend (que
   siempre espera JSON de /api/*) truena al intentar leerlo. */
app.use('/api', (req, res) => res.status(404).json({ mensaje: 'Ruta no encontrada.' }));

/* ══ Manejador de errores global ══
   Sin este manejador, un error ocurrido en un middleware ANTES de
   llegar a la ruta —el caso más común es multer, al procesar un
   archivo adjunto que excede el tamaño máximo (50 MB) o que no pasa
   el fileFilter— terminaba respondido con la página de error HTML por
   defecto de Express, y el frontend truena al intentar interpretarla
   como JSON ("Unexpected token '<', "<!DOCTYPE "... is not valid
   JSON"). Ahora cualquier error, multer incluido, siempre se responde
   en JSON con un mensaje claro para el usuario. Debe ir al final,
   después de todas las rutas. */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const mensaje = err.code === 'LIMIT_FILE_SIZE'
      ? `El archivo supera el tamaño máximo permitido (${TAMANO_MAXIMO_MB} MB).`
      : 'No se pudo procesar el archivo adjunto. Verifica que sea un PDF, Word o imagen válido.';
    return res.status(400).json({ mensaje });
  }
  if (err.message === 'Origen no permitido por CORS.') {
    return res.status(403).json({ mensaje: err.message });
  }
  console.error(err);
  res.status(500).json({ mensaje: PROD ? 'Error inesperado en el servidor.' : err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  ✅  Servidor SBIS activo                ║`);
  console.log(`║  🌐  http://localhost:${PORT}              ║`);
  console.log(`║  🗄️   NeonDB conectado                   ║`);
  console.log(`║  🔐  JWT Auth + rate-limit + CORS restringido ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});