/* ═══════════════════════════════════════════════════
   SBIS — Backend API REST
   Node.js + Express + NeonDB (PostgreSQL)
   ═══════════════════════════════════════════════════ */

import express           from 'express';
import cors              from 'cors';
import helmet            from 'helmet';
import rateLimit         from 'express-rate-limit';
import multer            from 'multer';
import path              from 'path';
import { fileURLToPath } from 'url';
import { neon }          from '@neondatabase/serverless';
import dotenv            from 'dotenv';
import bcrypt            from 'bcryptjs';
import jwt                from 'jsonwebtoken';
import { randomUUID }     from 'crypto';

dotenv.config();

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
   usuario.js, captura.js): así, después de Cerrar Sesión, la tecla
   Atrás no puede dejar visible una versión cacheada de una pantalla
   que ya no debería ser accesible. */
const PAGINAS = ['login', 'historial', 'area', 'captura', 'usuario'];

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
  { name: 'doc2', maxCount: 1 }
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

    const turnadoPor = turnado_a ? req.user.username : null;

    const [nuevo] = await sql`
      INSERT INTO oficios (
        n_control, f_sello, f_oficio, dias_entrega, numero,
        n_referencia, remitente, dependencia, instruccion, f_registro,
        folio_despacho, turnado_a, turnado_por, hora_recibido, estatus, descripcion,
        ruta_doc1, ruta_doc2, area_origen
      ) VALUES (
        ${n_control},
        ${f_sello        || null},
        ${f_oficio},
        ${Number(dias_entrega) || 0},
        ${numero         || null},
        ${n_referencia   || null},
        ${remitente.trim()},
        ${dependencia    || null},
        ${instruccion    || null},
        ${f_registro     || new Date().toISOString().split('T')[0]},
        ${folio_despacho || null},
        ${turnado_a      || null},
        ${turnadoPor},
        ${hora_recibido  || null},
        ${estatusInicial},
        ${descripcion    || null},
        ${ruta_doc1},
        ${ruta_doc2},
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
          turnado_a               = COALESCE(${turnado_a      ?? null}, turnado_a),
          turnado_por             = COALESCE(${turnadoPor}, turnado_por),
          instruccion             = COALESCE(${instruccion    ?? null}, instruccion),
          descripcion             = COALESCE(${descripcion    ?? null}, descripcion),
          obs_area                = COALESCE(${obs_area       ?? null}, obs_area),
          obs_admin               = COALESCE(${obs_admin      ?? null}, obs_admin),
          nota_rechazo            = COALESCE(${nota_rechazo   ?? null}, nota_rechazo),
          f_sello                 = COALESCE(${f_sello        ?? null}, f_sello),
          f_oficio                = COALESCE(${f_oficio       ?? null}, f_oficio),
          dias_entrega            = COALESCE(${dias_entrega !== undefined && dias_entrega !== null && dias_entrega !== '' ? Number(dias_entrega) : null}, dias_entrega),
          numero                  = COALESCE(${numero         ?? null}, numero),
          n_referencia            = COALESCE(${n_referencia   ?? null}, n_referencia),
          remitente               = COALESCE(${remitente      ?? null}, remitente),
          dependencia             = COALESCE(${dependencia    ?? null}, dependencia),
          f_registro              = COALESCE(${f_registro     ?? null}, f_registro),
          folio_despacho          = COALESCE(${folio_despacho ?? null}, folio_despacho),
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