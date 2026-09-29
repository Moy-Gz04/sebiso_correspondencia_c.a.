/* ═══════════════════════════════════════════════════════════
   SBIS — Apps Script: llenar hoja "cds" y exportar PDF
   Se pega en: Extensiones → Apps Script (dentro del propio Sheet)
   Copia versionada en el repo: apps-script-documentos.gs

   2026-09-29 — Carpetas por Área:
   · subirDocumento acepta `carpeta` (nombre del área, ej. "R. Humanos").
     El archivo se guarda en  📁 CORRESPONDENCIA · Archivos por Área / 📁 <área>,
     y cada subcarpeta se crea sola la primera vez.
   · Sin `carpeta`, se guarda en la carpeta GENERAL de siempre
     (FOLDER_ID_DOCUMENTOS), que conserva todo lo subido antes.
   · generarPdf y eliminarPdf NO cambiaron.
   ═══════════════════════════════════════════════════════════ */

const SPREADSHEET_ID = '16eezCel4Z3ZqwDXB8T6AymXpVG7g2-U7WScYHewEfdY';
const SHEET_NAME      = 'cds';
const FOLDER_ID        = '1_YlxxuwdBQHa4SkZp8lnzETcNg9rMJpP';

/* Carpeta GENERAL: documentos subidos hasta ahora (y respaldo si no llega el área) */
const FOLDER_ID_DOCUMENTOS = '1S6ameXMlEgzxtBkKHDmZipAaX51MqtLJ';

/* Carpeta que agrupa las carpetas de cada área. Se crea sola junto a la
   carpeta general la primera vez y su id se guarda en las propiedades del script. */
const NOMBRE_RAIZ_AREAS = 'CORRESPONDENCIA · Archivos por Área';

/* Rango completo que se exporta a PDF (A1:Y44) */
const RANGO_EXPORT = { r1: 0, c1: 0, r2: 44, c2: 25 }; // 0-indexado, fin exclusivo

/* ── Mapa de celdas por posición de registro (1 a 4) ──
   La celda antes llamada "folio" ahora recibe el N. de Control
   (así lo pidió el cliente: L20, X20, L41, X41).
   ⚠️ TODO: confirmar remitente del Registro 2 y asunto del Registro 4
   (actualmente puestos como provisionales, NO pisan otras celdas,
   pero probablemente no son la ubicación final correcta). */
const CELDAS = [
  { fecha: 'E5:F5',   referencia: 'J5:L5',   remitente: 'C7:L8',   asunto: 'C10:L12', control: 'K20:L20' },
  { fecha: 'Q5:R5',   referencia: 'V5:X5',   remitente: 'O7:X8'  /* TODO confirmar */, asunto: 'O10:X12', control: 'W20:X20' },
  { fecha: 'E26:F26', referencia: 'J26:L26', remitente: 'C28:L29', asunto: 'C31:L33', control: 'K41:L41' },
  { fecha: 'Q26:R26', referencia: 'V26:X26', remitente: 'O28:X29', asunto: 'O31:X33' /* TODO confirmar */, control: 'W41:X41' },
];

/* ══ Punto de entrada: recibe POST desde el backend de Node ══ */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'eliminar') {
      return eliminarPdf(data.fileId);
    }

    if (data.action === 'subirDocumento') {
      return subirDocumento(data);
    }

    if (data.action === 'obtenerDocumento') {
      return obtenerDocumento(data);
    }

    return generarPdf(data);

  } catch (err) {
    return respuesta({ ok: false, error: err.message });
  }
}

/* ── Sube un documento (PDF/DOC/imagen) del sistema de correspondencia a Drive ──
   Recibe el archivo en base64 (Apps Script no recibe multipart/form-data en doPost).
   Con `carpeta` va a la carpeta de esa área; sin ella, a la GENERAL. ── */
function subirDocumento(data) {
  try {
    if (!data.contenidoBase64 || !data.nombre) {
      return respuesta({ ok: false, error: 'Falta contenidoBase64 o nombre.' });
    }

    const bytes = Utilities.base64Decode(data.contenidoBase64);
    const blob  = Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', data.nombre);

    const folder = data.carpeta ? carpetaDeArea_(data.carpeta) : DriveApp.getFolderById(FOLDER_ID_DOCUMENTOS);
    const file   = folder.createFile(blob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      Logger.log('No se pudo compartir por link (se ignora): ' + shareErr.message);
    }

    return respuesta({ ok: true, url: file.getUrl(), fileId: file.getId(), carpeta: folder.getName() });
  } catch (err) {
    return respuesta({ ok: false, error: 'No se pudo subir el archivo: ' + err.message });
  }
}

/* ── Entrega un documento al servidor de Correspondencia ──
   La cuenta de la institución no permite "cualquiera con el enlace", así
   que los archivos quedan privados y los usuarios no los podían abrir en
   Drive. Ahora el servidor pide el archivo aquí (este script sí tiene
   acceso) y se lo muestra al usuario él mismo, después de revisar que
   ese usuario tenga permiso sobre el oficio. Solo entrega archivos que
   estén dentro de la carpeta GENERAL o de las carpetas por área. */
function obtenerDocumento(data) {
  try {
    if (!data.fileId) return respuesta({ ok: false, error: 'Falta fileId.' });
    const file = DriveApp.getFileById(data.fileId);
    if (!estaEnCarpetasPermitidas_(file)) {
      return respuesta({ ok: false, error: 'Ese archivo no pertenece a Correspondencia.' });
    }
    if (file.getSize() > 35 * 1024 * 1024) {
      return respuesta({ ok: false, error: 'El archivo es demasiado grande para mostrarse (más de 35 MB).' });
    }
    const blob = file.getBlob();
    return respuesta({
      ok: true,
      nombre: file.getName(),
      mimeType: blob.getContentType() || 'application/octet-stream',
      contenidoBase64: Utilities.base64Encode(blob.getBytes()),
    });
  } catch (err) {
    return respuesta({ ok: false, error: 'No se pudo leer el archivo: ' + err.message });
  }
}

/* ¿El archivo está en la carpeta GENERAL o dentro de la carpeta de áreas? */
function estaEnCarpetasPermitidas_(file) {
  const permitidas = [FOLDER_ID_DOCUMENTOS, FOLDER_ID];
  const raiz = PropertiesService.getScriptProperties().getProperty('carpeta_raiz_areas');
  if (raiz) permitidas.push(raiz);
  const padres = file.getParents();
  while (padres.hasNext()) {
    const p = padres.next();
    if (permitidas.indexOf(p.getId()) !== -1) return true;
    const abuelos = p.getParents();
    while (abuelos.hasNext()) {
      if (permitidas.indexOf(abuelos.next().getId()) !== -1) return true;
    }
  }
  return false;
}

/* ── Carpeta de un área (se crea si no existe) ──
   Los ids se guardan en las propiedades del script para no buscar en
   Drive en cada subida. Un candado evita que dos subidas simultáneas
   creen la misma carpeta dos veces. */
function carpetaDeArea_(area) {
  const nombre = String(area).replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 80) || 'Sin área';
  const props  = PropertiesService.getScriptProperties();
  const clave  = 'carpeta_area_' + nombre;

  const guardada = abrirCarpeta_(props.getProperty(clave));
  if (guardada) return guardada;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const otraVez = abrirCarpeta_(props.getProperty(clave));
    if (otraVez) return otraVez;

    const raiz = carpetaRaizAreas_();
    const existentes = raiz.getFoldersByName(nombre);
    const carpeta = existentes.hasNext() ? existentes.next() : raiz.createFolder(nombre);
    props.setProperty(clave, carpeta.getId());
    return carpeta;
  } finally {
    lock.releaseLock();
  }
}

/* Carpeta que agrupa las de cada área: junto a la carpeta GENERAL. */
function carpetaRaizAreas_() {
  const props = PropertiesService.getScriptProperties();
  const guardada = abrirCarpeta_(props.getProperty('carpeta_raiz_areas'));
  if (guardada) return guardada;

  const general = DriveApp.getFolderById(FOLDER_ID_DOCUMENTOS);
  const padres  = general.getParents();
  const padre   = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  const existentes = padre.getFoldersByName(NOMBRE_RAIZ_AREAS);
  const raiz = existentes.hasNext() ? existentes.next() : padre.createFolder(NOMBRE_RAIZ_AREAS);
  props.setProperty('carpeta_raiz_areas', raiz.getId());
  return raiz;
}

/* Abre una carpeta por id; null si no hay id, no existe o está en la papelera. */
function abrirCarpeta_(id) {
  if (!id) return null;
  try {
    const f = DriveApp.getFolderById(id);
    return f.isTrashed() ? null : f;
  } catch (e) {
    return null;
  }
}

/* ── Elimina (envía a la papelera) el archivo PDF generado previamente ── */
function eliminarPdf(fileId) {
  if (!fileId) return respuesta({ ok: false, error: 'Falta fileId.' });
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    return respuesta({ ok: true });
  } catch (err) {
    return respuesta({ ok: false, error: 'No se pudo eliminar el archivo: ' + err.message });
  }
}

/* ── Llena el Sheet y genera el PDF (flujo original) ── */
function generarPdf(data) {
  try {
    const registros = Array.isArray(data.registros) ? data.registros.slice(0, 4) : [];

    if (!registros.length) {
      return respuesta({ ok: false, error: 'No se recibieron registros.' });
    }

    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return respuesta({ ok: false, error: `No se encontró la hoja "${SHEET_NAME}".` });

    const folios = [];

    registros.forEach((r, i) => {
      const c = CELDAS[i];
      if (!c) return; // más de 4 registros, se ignora

      if (r.fecha)      sheet.getRange(c.fecha).setValue(r.fecha);
      if (r.referencia) sheet.getRange(c.referencia).setValue(r.referencia);
      if (r.remitente)  sheet.getRange(c.remitente).setValue(r.remitente);
      if (r.asunto)     sheet.getRange(c.asunto).setValue(r.asunto);
      if (r.control)    sheet.getRange(c.control).setValue(r.control);

      folios.push(r.control ? String(r.control) : '—');
    });

    SpreadsheetApp.flush();

    const pdfBlob = exportarRangoComoPdf(sheet.getSheetId());

    const nombreArchivo = `PDF_Folio_${folios.join('-')}_${formatoFechaArchivo()}.pdf`;
    pdfBlob.setName(nombreArchivo);

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file   = folder.createFile(pdfBlob);

    // El intento de compartir por link es opcional: si la política de la
    // organización bloquea compartir fuera del dominio, este paso falla,
    // pero el archivo YA fue creado en la carpeta — no debe tumbar todo
    // el proceso. El acceso queda entonces regido por los permisos de
    // la carpeta contenedora (ya compartida con quien la necesite).
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      Logger.log('No se pudo compartir por link (se ignora, el archivo ya existe): ' + shareErr.message);
    }

    return respuesta({
      ok: true,
      url: file.getUrl(),
      fileId: file.getId(),
      folios: folios,
    });

  } catch (err) {
    return respuesta({ ok: false, error: err.message });
  }
}

/* ── Exporta el rango A1:Y44 de la hoja "cds" como PDF ── */
function exportarRangoComoPdf(gid) {
  const base = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export`;
  const params = [
    'format=pdf',
    `gid=${gid}`,
    `r1=${RANGO_EXPORT.r1}`,
    `c1=${RANGO_EXPORT.c1}`,
    `r2=${RANGO_EXPORT.r2}`,
    `c2=${RANGO_EXPORT.c2}`,
    'size=letter',
    'portrait=true',
    'scale=4',          // 1=100%, 2=ajustar ancho, 3=ajustar alto, 4=ajustar a la página (1 sola hoja)
    'gridlines=false',
    'printtitle=false',
    'sheetnames=false',
    'pagenum=UNDEFINED',
    'top_margin=0.15',
    'bottom_margin=0.15',
    'left_margin=0.15',
    'right_margin=0.15',
  ].join('&');

  const url = `${base}?${params}`;
  const respuestaFetch = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });

  if (respuestaFetch.getResponseCode() !== 200) {
    throw new Error('No se pudo generar el PDF (HTTP ' + respuestaFetch.getResponseCode() + ')');
  }
  return respuestaFetch.getBlob();
}

function formatoFechaArchivo() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── Prueba manual desde el editor (Ejecutar → probarEnvio) ── */
function probarEnvio() {
  const payload = {
    registros: [
      { fecha: '01/06/2026', referencia: 'OF-001', remitente: 'Prueba Remitente 1', asunto: 'Asunto de prueba 1', control: '111' },
    ],
  };
  const fake = { postData: { contents: JSON.stringify(payload) } };
  const out = doPost(fake);
  Logger.log(out.getContent());
}

/* ── Prueba de carpetas por área (Ejecutar → probarCarpetasArea) ──
   Crea (si no existen) la carpeta raíz y las 8 carpetas de área, SIN subir
   ningún archivo. Sirve también para dar los permisos la primera vez. */
function probarCarpetasArea() {
  const areas = ['Archivo', 'Coordinación Administrativa', 'Informática', 'R. Financieros',
                 'R. Humanos', 'R. Materiales', 'Seguimiento de Auditorías', 'Transparencia'];
  areas.forEach(a => Logger.log(a + ' → ' + carpetaDeArea_(a).getUrl()));
  Logger.log('Carpeta que agrupa las áreas: ' + carpetaRaizAreas_().getUrl());
}
