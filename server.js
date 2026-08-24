/* ═══════════════════════════════════════════════════
   SBIS — Backend API REST
   Node.js + Express + NeonDB (PostgreSQL)
   ═══════════════════════════════════════════════════ */

import express           from 'express';
import cors              from 'cors';
import multer            from 'multer';
import path              from 'path';
import { fileURLToPath } from 'url';
import { neon }          from '@neondatabase/serverless';
import dotenv            from 'dotenv';
import bcrypt            from 'bcryptjs';
import jwt                from 'jsonwebtoken';

dotenv.config();

if (!process.env.DATABASE_URL) { console.error('❌  Falta DATABASE_URL'); process.exit(1); }
if (!process.env.JWT_SECRET)   { console.error('❌  Falta JWT_SECRET');   process.exit(1); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const sql = neon(process.env.DATABASE_URL);

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// NOTA: los archivos subidos por usuarios ya NO se guardan en disco local
// (Render borra el disco en cada reinicio/redeploy). Ahora se suben a
// Google Drive vía Apps Script — ver subirArchivoADrive() más abajo.

app.get('/', (req, res) => res.redirect('/login.html'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.pdf', '.doc', '.docx'].includes(ext));
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
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ mensaje: 'Token inválido o expirado.' }); }
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

/* ══ HEALTH CHECK ══ */
app.get('/api/ping', (req, res) => res.json({ ok: true, ts: new Date() }));

/* ══ LOGIN ══ */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ mensaje: 'Usuario y contraseña requeridos.' });

    const [usuario] = await sql`
      SELECT * FROM usuarios
      WHERE username = ${username.trim().toLowerCase()} AND activo = TRUE`;

    if (!usuario) return res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' });

    const coincide = await bcrypt.compare(password, usuario.password);
    if (!coincide) return res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' });

    const token = jwt.sign(
      { id: usuario.id, username: usuario.username, area: usuario.area, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    console.log(`🔐  Login: ${usuario.username} (${usuario.rol})`);
    res.json({ token, usuario: { id: usuario.id, username: usuario.username, area: usuario.area, rol: usuario.rol } });
  } catch (err) {
    res.status(500).json({ mensaje: 'Error en el servidor: ' + err.message });
  }
});

/* ══ ME ══ */
app.get('/api/me', verifyToken, (req, res) => res.json({ usuario: req.user }));

/* ══ GET /api/usuarios/area/:area
   Devuelve los usuarios con rol 'usuario_area' del área indicada.
   Solo accesible por el área correspondiente o admin.
══ */
app.get('/api/usuarios/area/:area', verifyToken, async (req, res) => {
  try {
    const { area } = req.params;
    // El área solo puede consultar sus propios usuarios; admin puede consultar cualquiera
    if (req.user.rol !== 'admin' && req.user.area !== area)
      return res.status(403).json({ mensaje: 'Sin acceso.' });

    const rows = await sql`
      SELECT id, username, area
      FROM usuarios
      WHERE area = ${area} AND rol = 'usuario_area' AND activo = TRUE
      ORDER BY username ASC`;

    res.json(rows);
  } catch (err) {
    res.status(500).json({ mensaje: err.message });
  }
});

/* ══ GET /api/oficios ══
   - admin        → todos los oficios (legado)
   - area         → por defecto, lo que le TURNARON a su área (bandeja).
                     Con ?origen=mio → lo que ELLA misma creó (su historial
                     propio). Este historial propio es exclusivo de
                     Coordinación Administrativa (o el admin legado): las
                     demás áreas ya no crean registros, así que no tienen
                     nada que consultar ahí.
   - usuario_area → solo los oficios que tienen usuario_asignado_id = su id
══ */
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
      // Su propio historial: lo que ELLA creó. Reservado a Coordinación
      // Administrativa; cualquier otra área que intente consultarlo
      // (por ejemplo llamando la API directamente) recibe 403, ya que
      // esa opción no le corresponde.
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

    res.json(rows);
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al obtener registros: ' + err.message });
  }
});

/* ══ GET /api/oficios/:id ══ */
app.get('/api/oficios/:id', verifyToken, async (req, res) => {
  try {
    const [row] = await sql`SELECT * FROM oficios WHERE id = ${req.params.id}`;
    if (!row) return res.status(404).json({ mensaje: 'No encontrado.' });

    const { rol, area, id } = req.user;
    if (rol === 'admin') { /* sin restricción */ }
    else if (rol === 'area' && row.turnado_a !== area && row.area_origen !== area)
      return res.status(403).json({ mensaje: 'Sin acceso.' });
    else if (rol === 'usuario_area' && row.usuario_asignado_id !== id)
      return res.status(403).json({ mensaje: 'Sin acceso.' });

    res.json(row);
  } catch (err) {
    res.status(500).json({ mensaje: err.message });
  }
});

/* ══ POST /api/oficios — Exclusivo de Coordinación Administrativa (o el
   admin legado) ══
   Solo Coordinación Administrativa puede dar de alta nuevos registros;
   las demás áreas ya no tienen esta capacidad. Si manda "turnado_a", el
   registro nace directo en estatus 'turnado' (lo crea Y lo turna en un
   solo paso); si no, nace en 'por_turnar' para turnarlo después. ══ */
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

    // El área que crea el registro es la que origina el N. Control con
    // su propio prefijo. El admin legado usa Coordinación como fallback.
    const areaOrigen = req.user.area || 'Coordinación Administrativa';
    const n_control   = await siguienteNControl(areaOrigen);

    const estatusInicial = turnado_a ? 'turnado' : 'por_turnar';

    const files     = req.files || {};
    const ruta_doc1 = files.doc1?.[0] ? await subirArchivoADrive(files.doc1[0]) : null;
    const ruta_doc2 = files.doc2?.[0] ? await subirArchivoADrive(files.doc2[0]) : null;

    const [nuevo] = await sql`
      INSERT INTO oficios (
        n_control, f_sello, f_oficio, dias_entrega, numero,
        n_referencia, remitente, dependencia, instruccion, f_registro,
        folio_despacho, turnado_a, hora_recibido, estatus, descripcion,
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
        ${hora_recibido  || null},
        ${estatusInicial},
        ${descripcion    || null},
        ${ruta_doc1},
        ${ruta_doc2},
        ${areaOrigen}
      )
      RETURNING *`;

    console.log(`✅  Oficio creado por ${areaOrigen}: N. Control ${n_control} → ${estatusInicial}${turnado_a ? ' → ' + turnado_a : ''}`);
    res.status(201).json(nuevo);
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al guardar: ' + err.message });
  }
});

/* ══ PUT /api/oficios/:id ══
   Flujo de estatus:
     área de origen (o admin legado) → crea/edita/turna su propio registro
     área receptora                  → turnado → sub_turnado (asigna usuario_asignado_id)
     usuario_area                    → sub_turnado / rechazado → atendido
     área de origen (o admin legado) → atendido → completado / rechazado
══ */
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
    const esOrigen = rol === 'admin' || (rol === 'area' && oficio.area_origen === area);

    /* ── QUIEN ORIGINÓ EL REGISTRO (admin legado, o el área que lo creó):
         edición completa, incluyendo turnar/re-turnar a cualquier área ── */
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

      // Si se vuelve a turnar (rechaza y manda de vuelta), limpiar asignación de usuario
      const limpiarAsignacion = nuevoEstatus === 'turnado' ? true : false;

      const [updated] = await sql`
        UPDATE oficios SET
          estatus                 = COALESCE(${nuevoEstatus},   estatus),
          turnado_a               = COALESCE(${turnado_a      ?? null}, turnado_a),
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
          updated_at              = NOW()
        WHERE id = ${req.params.id}
        RETURNING *`;
      return res.json(updated);

    /* ── ÁREA RECEPTORA: solo puede sub-turnar (turnado → sub_turnado) ── */
    } else if (rol === 'area' && oficio.turnado_a === area) {
      const { usuario_asignado_id, usuario_asignado_nombre } = req.body;

      if (!usuario_asignado_id)
        return res.status(400).json({ mensaje: 'Debes seleccionar un usuario.' });

      // Verificar que el usuario pertenece al área
      const [usuarioObj] = await sql`
        SELECT id, username FROM usuarios
        WHERE id = ${usuario_asignado_id} AND area = ${area} AND rol = 'usuario_area' AND activo = TRUE`;

      if (!usuarioObj)
        return res.status(400).json({ mensaje: 'El usuario no pertenece a esta área.' });

      const [updated] = await sql`
        UPDATE oficios SET
          estatus                 = 'sub_turnado',
          usuario_asignado_id     = ${usuarioObj.id},
          usuario_asignado_nombre = ${usuarioObj.username},
          updated_at              = NOW()
        WHERE id = ${req.params.id}
        RETURNING *`;
      return res.json(updated);

    /* ── USUARIO_AREA: solo puede marcar atendido y subir docs ── */
    } else if (rol === 'usuario_area') {
      if (oficio.usuario_asignado_id !== id)
        return res.status(403).json({ mensaje: 'Sin acceso.' });

      const { obs_area, estatus: estatusBody } = req.body;
      const nuevoEstatus = estatusBody === 'atendido' ? 'atendido' : null;

      const ruta_doc3 = files.doc3?.[0] ? await subirArchivoADrive(files.doc3[0]) : null;
      const ruta_doc4 = files.doc4?.[0] ? await subirArchivoADrive(files.doc4[0]) : null;

      const [updated] = await sql`
        UPDATE oficios SET
          obs_area   = COALESCE(${obs_area    ?? null}, obs_area),
          estatus    = COALESCE(${nuevoEstatus}, estatus),
          ruta_doc3  = COALESCE(${ruta_doc3},   ruta_doc3),
          ruta_doc4  = COALESCE(${ruta_doc4},   ruta_doc4),
          updated_at = NOW()
        WHERE id = ${req.params.id}
        RETURNING *`;
      return res.json(updated);

    } else {
      return res.status(403).json({ mensaje: 'Sin acceso a este registro.' });
    }

  } catch (err) {
    res.status(500).json({ mensaje: err.message });
  }
});

/* ══ DELETE /api/oficios/:id ══
   Admin legado, o el área que ORIGINÓ el registro, puede borrarlo. ══ */
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
    res.status(500).json({ mensaje: err.message });
  }
});

/* ══ POST /api/oficios/generar-pdf ══
   Recibe hasta 4 IDs de oficios (en el orden de selección del usuario),
   arma los datos (Fecha, Referencia, Remitente, Asunto, Folio) y se los
   envía al Apps Script del Sheet, que llena las celdas y devuelve el
   link del PDF generado (rango A1:Y44 de la hoja "cds").
   El PDF generado queda etiquetado con el ÁREA de quien lo generó, para
   que cada área solo vea (y pueda borrar) los PDFs que ella misma creó.
══ */
app.post('/api/oficios/generar-pdf', verifyToken, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 4)
      return res.status(400).json({ mensaje: 'Debes seleccionar entre 1 y 4 registros.' });

    if (!process.env.APPS_SCRIPT_URL)
      return res.status(500).json({ mensaje: 'APPS_SCRIPT_URL no está configurada en el servidor.' });

    // Se respeta el orden en que el usuario seleccionó los registros
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

    // Guardar en historial de PDFs generados, etiquetado con el área de quien lo generó
    const [guardado] = await sql`
      INSERT INTO pdfs_generados (oficio_ids, folios, url, file_id, generado_por, area)
      VALUES (${ids}, ${data.folios}, ${data.url}, ${data.fileId || null}, ${req.user.username}, ${req.user.area || null})
      RETURNING *`;

    console.log(`📄  PDF generado por ${req.user.username} (${req.user.area || 'sin área'}) — N. Control: ${data.folios.join(', ')} → ${data.url}`);
    res.json(guardado);

  } catch (err) {
    res.status(500).json({ mensaje: 'Error al generar el PDF: ' + err.message });
  }
});

/* ══ DELETE /api/pdfs-generados/:id ══
   Elimina el registro del historial y, si es posible, también el
   archivo real en Drive (a través del mismo Apps Script). Si borrar
   el archivo de Drive falla (p. ej. ya no existe), igual se quita del
   sistema para que el usuario pueda limpiar errores sin quedar atorado.
   Solo el admin legado o la misma área que generó el PDF pueden borrarlo.
══ */
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
    res.status(500).json({ mensaje: err.message });
  }
});

/* ══ GET /api/pdfs-generados ══
   Historial de PDFs generados (más recientes primero).
   - admin → ve todos los PDFs generados por cualquier área (supervisión).
   - area / usuario_area → solo ve los PDFs generados por SU PROPIA área.
   Los PDFs generados antes de esta actualización no tienen área asignada
   (area IS NULL); solo el admin los sigue viendo, para no exponerlos a
   la primera área que entre. Si algún área necesita rescatar uno de esos
   PDFs viejos, un admin puede reasignarle el área desde la base de datos.
══ */
app.get('/api/pdfs-generados', verifyToken, async (req, res) => {
  try {
    const { rol, area } = req.user;
    const rows = rol === 'admin'
      ? await sql`SELECT * FROM pdfs_generados ORDER BY created_at DESC LIMIT 50`
      : await sql`SELECT * FROM pdfs_generados WHERE area = ${area} ORDER BY created_at DESC LIMIT 50`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ mensaje: err.message });
  }
});

function formatearFechaMX(fecha) {
  if (!fecha) return '';
  // Neon puede devolver un objeto Date de JS (no un string) para columnas DATE.
  // Se usa UTC para evitar que el huso horario local recorra el día ±1.
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  ✅  Servidor SBIS activo                ║`);
  console.log(`║  🌐  http://localhost:${PORT}              ║`);
  console.log(`║  🗄️   NeonDB conectado                   ║`);
  console.log(`║  🔐  JWT Auth habilitado                 ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});