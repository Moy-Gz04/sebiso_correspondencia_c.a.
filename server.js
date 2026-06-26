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
import jwt               from 'jsonwebtoken';

dotenv.config();

if (!process.env.DATABASE_URL) { console.error('❌  Falta DATABASE_URL'); process.exit(1); }
if (!process.env.JWT_SECRET)   { console.error('❌  Falta JWT_SECRET');   process.exit(1); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const sql = neon(process.env.DATABASE_URL);

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => res.redirect('/login.html'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename:    (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.pdf', '.doc', '.docx'].includes(ext));
  }
});

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
   - admin        → todos los oficios
   - area         → oficios turnados a su área (cualquier estatus)
   - usuario_area → solo los oficios que tienen usuario_asignado_id = su id
══ */
app.get('/api/oficios', verifyToken, async (req, res) => {
  try {
    const { estatus } = req.query;
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
    else if (rol === 'area' && row.turnado_a !== area)
      return res.status(403).json({ mensaje: 'Sin acceso.' });
    else if (rol === 'usuario_area' && row.usuario_asignado_id !== id)
      return res.status(403).json({ mensaje: 'Sin acceso.' });

    res.json(row);
  } catch (err) {
    res.status(500).json({ mensaje: err.message });
  }
});

/* ══ POST /api/oficios — Solo admin ══ */
app.post('/api/oficios', verifyToken, onlyAdmin, upload.fields([
  { name: 'doc1', maxCount: 1 },
  { name: 'doc2', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      f_sello, f_oficio, dias_entrega, numero, n_referencia,
      remitente, dependencia, instruccion, f_registro,
      folio_despacho, hora_recibido, descripcion
    } = req.body;

    if (!f_oficio || !remitente?.trim())
      return res.status(400).json({ mensaje: 'F. Oficio y Remitente son obligatorios.' });

    const [{ max }] = await sql`SELECT COALESCE(MAX(CAST(n_control AS INTEGER)), 0) AS max FROM oficios`;
    const n_control = String(max + 1);

    const files     = req.files || {};
    const ruta_doc1 = files.doc1?.[0]?.filename ?? null;
    const ruta_doc2 = files.doc2?.[0]?.filename ?? null;

    const [nuevo] = await sql`
      INSERT INTO oficios (
        n_control, f_sello, f_oficio, dias_entrega, numero,
        n_referencia, remitente, dependencia, instruccion, f_registro,
        folio_despacho, turnado_a, hora_recibido, estatus, descripcion,
        ruta_doc1, ruta_doc2
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
        ${null},
        ${hora_recibido  || null},
        'por_turnar',
        ${descripcion    || null},
        ${ruta_doc1},
        ${ruta_doc2}
      )
      RETURNING *`;

    console.log(`✅  Oficio creado: N. Control ${n_control} → por_turnar`);
    res.status(201).json(nuevo);
  } catch (err) {
    res.status(500).json({ mensaje: 'Error al guardar: ' + err.message });
  }
});

/* ══ PUT /api/oficios/:id ══
   Flujo de estatus:
     admin        → por_turnar → turnado → (admin turna a área)
     area         → turnado → sub_turnado (asigna usuario_asignado_id)
     usuario_area → sub_turnado / rechazado → atendido
     admin        → atendido → completado / rechazado
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

    /* ── ADMIN ── */
    if (rol === 'admin') {
      const {
        estatus, turnado_a, instruccion, descripcion,
        obs_area, obs_admin, nota_rechazo,
        f_sello, f_oficio, dias_entrega, numero, n_referencia,
        remitente, dependencia, f_registro, folio_despacho, hora_recibido
      } = req.body;

      const estatusValidos = ['por_turnar', 'turnado', 'sub_turnado', 'atendido', 'rechazado', 'completado'];
      const nuevoEstatus = estatus && estatusValidos.includes(estatus) ? estatus : null;

      const ruta_doc1 = files.doc1?.[0]?.filename ?? null;
      const ruta_doc2 = files.doc2?.[0]?.filename ?? null;

      // Si el admin vuelve a turnar (rechaza y manda de vuelta), limpiar asignación de usuario
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
          dias_entrega            = COALESCE(${dias_entrega   ? Number(dias_entrega) : null}, dias_entrega),
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

    /* ── ÁREA: solo puede sub-turnar (turnado → sub_turnado) ── */
    } else if (rol === 'area') {
      if (oficio.turnado_a !== area)
        return res.status(403).json({ mensaje: 'Sin acceso.' });

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

      const ruta_doc3 = files.doc3?.[0]?.filename ?? null;
      const ruta_doc4 = files.doc4?.[0]?.filename ?? null;

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
      return res.status(403).json({ mensaje: 'Rol no reconocido.' });
    }

  } catch (err) {
    res.status(500).json({ mensaje: err.message });
  }
});

/* ══ DELETE /api/oficios/:id ══ */
app.delete('/api/oficios/:id', verifyToken, onlyAdmin, async (req, res) => {
  try {
    await sql`DELETE FROM oficios WHERE id = ${req.params.id}`;
    console.log(`🗑️   Oficio ${req.params.id} eliminado`);
    res.json({ mensaje: 'Eliminado correctamente.' });
  } catch (err) {
    res.status(500).json({ mensaje: err.message });
  }
});

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