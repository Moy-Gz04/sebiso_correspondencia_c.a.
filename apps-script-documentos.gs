/* =============================================================
   SBIS - Apps Script de Correspondencia
   Se pega en: Extensiones > Apps Script (dentro del propio Sheet)
   Copia versionada en el repo: apps-script-documentos.gs

   Que hace:
   - subirDocumento: guarda el archivo en la carpeta de su area
     (CARPETAS_AREA). Sin area, o area sin carpeta, va a la GENERAL.
     No crea ni comparte carpetas: no se manda ningun correo.
   - tokenDrive: le presta al servidor una llave temporal de Drive para
     que descargue los archivos directo (rapido). Protegida con la
     contrasena SECRETO_SERVIDOR (Propiedades de la secuencia de comandos).
   - obtenerDocumento: respaldo lento (pasa el archivo por aqui).
   - generarPdf y eliminarPdf: PDF de listados (sin cambios).
   ============================================================= */

var SPREADSHEET_ID = '16eezCel4Z3ZqwDXB8T6AymXpVG7g2-U7WScYHewEfdY';
var SHEET_NAME     = 'cds';
var FOLDER_ID      = '1_YlxxuwdBQHa4SkZp8lnzETcNg9rMJpP';

/* Carpeta GENERAL: documentos subidos hasta ahora (y respaldo si no hay area) */
var FOLDER_ID_DOCUMENTOS = '1S6ameXMlEgzxtBkKHDmZipAaX51MqtLJ';

/* Carpeta de cada area (creadas y compartidas a mano, solo con la gente del area).
   El nombre debe ser igual al del area en el sistema.
   Transparencia no tiene carpeta todavia: guarda en la GENERAL. */
var CARPETAS_AREA = {
  'Archivo':                     '10qz6yJC_ENBWtuRLPV4htQaE_E_7QHCV',
  'Coordinación Administrativa': '1LDvalB_L0RpJhRMFW9EyqwjVEh4czIBL',
  'Informática':                 '1OhyjGE8gFX8g-n3ClpPKcqq6OWR1cYSB',
  'R. Financieros':              '1cUHqb6mYED--GXqLtQHEaC6QcfUnGbgb',
  'R. Humanos':                  '1ZPtjkjxO_2Ju9d9eCSk8HbKq83_fvbT8',
  'R. Materiales':               '1BCv5KqPr36OEYYd9KVvHRYckjLhvcr6W',
  'Seguimiento de Auditorías':   '1qa-U1iiJHcCf-uERjh6ACqS773XjVw3z'
};

/* Rango que se exporta a PDF (A1:Y44), 0-indexado, fin exclusivo */
var RANGO_EXPORT = { r1: 0, c1: 0, r2: 44, c2: 25 };

/* Celdas por posicion de registro (1 a 4). La celda "folio" recibe el N. de Control.
   PENDIENTE: confirmar remitente del Registro 2 y asunto del Registro 4. */
var CELDAS = [
  { fecha: 'E5:F5',   referencia: 'J5:L5',   remitente: 'C7:L8',   asunto: 'C10:L12', control: 'K20:L20' },
  { fecha: 'Q5:R5',   referencia: 'V5:X5',   remitente: 'O7:X8',   asunto: 'O10:X12', control: 'W20:X20' },
  { fecha: 'E26:F26', referencia: 'J26:L26', remitente: 'C28:L29', asunto: 'C31:L33', control: 'K41:L41' },
  { fecha: 'Q26:R26', referencia: 'V26:X26', remitente: 'O28:X29', asunto: 'O31:X33', control: 'W41:X41' }
];

/* ===== Punto de entrada: recibe POST desde el servidor ===== */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'eliminar')         return eliminarPdf(data.fileId);
    if (data.action === 'subirDocumento')   return subirDocumento(data);
    if (data.action === 'obtenerDocumento') return obtenerDocumento(data);
    if (data.action === 'tokenDrive')       return tokenDrive(data);

    return generarPdf(data);
  } catch (err) {
    return respuesta({ ok: false, error: err.message });
  }
}

/* ===== Sube un documento a la carpeta de su area (o a la GENERAL) ===== */
function subirDocumento(data) {
  try {
    if (!data.contenidoBase64 || !data.nombre) {
      return respuesta({ ok: false, error: 'Falta contenidoBase64 o nombre.' });
    }
    var bytes  = Utilities.base64Decode(data.contenidoBase64);
    var blob   = Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', data.nombre);
    var folder = data.carpeta ? carpetaDeArea_(data.carpeta) : DriveApp.getFolderById(FOLDER_ID_DOCUMENTOS);
    var file   = folder.createFile(blob);

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

/* ===== Llave temporal de Drive para el servidor (descarga directa, 1-2 s) =====
   Solo se entrega si el servidor manda la contrasena correcta. */
function tokenDrive(data) {
  var secreto = PropertiesService.getScriptProperties().getProperty('SECRETO_SERVIDOR');
  if (!secreto || data.secreto !== secreto) {
    return respuesta({ ok: false, error: 'No autorizado.' });
  }
  DriveApp.getRootFolder(); // asegura que la llave incluya el permiso de Drive
  return respuesta({ ok: true, token: ScriptApp.getOAuthToken(), expiraEnSeg: 3000 });
}

/* ===== Respaldo: entrega el archivo pasandolo por aqui (lento) ===== */
function obtenerDocumento(data) {
  try {
    if (!data.fileId) return respuesta({ ok: false, error: 'Falta fileId.' });
    var file = DriveApp.getFileById(data.fileId);
    if (!estaEnCarpetasPermitidas_(file)) {
      return respuesta({ ok: false, error: 'Ese archivo no pertenece a Correspondencia.' });
    }
    if (file.getSize() > 35 * 1024 * 1024) {
      return respuesta({ ok: false, error: 'El archivo es demasiado grande (mas de 35 MB).' });
    }
    var blob = file.getBlob();
    return respuesta({
      ok: true,
      nombre: file.getName(),
      mimeType: blob.getContentType() || 'application/octet-stream',
      contenidoBase64: Utilities.base64Encode(blob.getBytes())
    });
  } catch (err) {
    return respuesta({ ok: false, error: 'No se pudo leer el archivo: ' + err.message });
  }
}

/* El archivo esta en la GENERAL, en la de listados o en la carpeta de un area */
function estaEnCarpetasPermitidas_(file) {
  var permitidas = [FOLDER_ID_DOCUMENTOS, FOLDER_ID];
  Object.keys(CARPETAS_AREA).forEach(function (a) { permitidas.push(CARPETAS_AREA[a]); });
  var raiz = PropertiesService.getScriptProperties().getProperty('carpeta_raiz_areas');
  if (raiz) permitidas.push(raiz);
  var padres = file.getParents();
  while (padres.hasNext()) {
    var p = padres.next();
    if (permitidas.indexOf(p.getId()) !== -1) return true;
    var abuelos = p.getParents();
    while (abuelos.hasNext()) {
      if (permitidas.indexOf(abuelos.next().getId()) !== -1) return true;
    }
  }
  return false;
}

/* Carpeta fija del area; si no tiene o no se puede abrir, la GENERAL */
function carpetaDeArea_(area) {
  var id = CARPETAS_AREA[String(area).trim()];
  return abrirCarpeta_(id) || DriveApp.getFolderById(FOLDER_ID_DOCUMENTOS);
}

/* Abre una carpeta por id; null si no hay id, no existe o esta en la papelera */
function abrirCarpeta_(id) {
  if (!id) return null;
  try {
    var f = DriveApp.getFolderById(id);
    return f.isTrashed() ? null : f;
  } catch (e) {
    return null;
  }
}

/* ===== Envia a la papelera un PDF generado ===== */
function eliminarPdf(fileId) {
  if (!fileId) return respuesta({ ok: false, error: 'Falta fileId.' });
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    return respuesta({ ok: true });
  } catch (err) {
    return respuesta({ ok: false, error: 'No se pudo eliminar el archivo: ' + err.message });
  }
}

/* ===== Llena la hoja "cds" y genera el PDF de listados ===== */
function generarPdf(data) {
  try {
    var registros = Array.isArray(data.registros) ? data.registros.slice(0, 4) : [];
    if (!registros.length) {
      return respuesta({ ok: false, error: 'No se recibieron registros.' });
    }

    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return respuesta({ ok: false, error: 'No se encontró la hoja "' + SHEET_NAME + '".' });

    var folios = [];
    registros.forEach(function (r, i) {
      var c = CELDAS[i];
      if (!c) return;
      if (r.fecha)      sheet.getRange(c.fecha).setValue(r.fecha);
      if (r.referencia) sheet.getRange(c.referencia).setValue(r.referencia);
      if (r.remitente)  sheet.getRange(c.remitente).setValue(r.remitente);
      if (r.asunto)     sheet.getRange(c.asunto).setValue(r.asunto);
      if (r.control)    sheet.getRange(c.control).setValue(r.control);
      folios.push(r.control ? String(r.control) : '-');
    });

    SpreadsheetApp.flush();

    var pdfBlob = exportarRangoComoPdf(sheet.getSheetId());
    pdfBlob.setName('PDF_Folio_' + folios.join('-') + '_' + formatoFechaArchivo() + '.pdf');

    var folder = DriveApp.getFolderById(FOLDER_ID);
    var file   = folder.createFile(pdfBlob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      Logger.log('No se pudo compartir por link (se ignora): ' + shareErr.message);
    }

    return respuesta({ ok: true, url: file.getUrl(), fileId: file.getId(), folios: folios });
  } catch (err) {
    return respuesta({ ok: false, error: err.message });
  }
}

/* ===== Exporta el rango A1:Y44 de la hoja "cds" como PDF ===== */
function exportarRangoComoPdf(gid) {
  var base = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/export';
  var params = [
    'format=pdf',
    'gid=' + gid,
    'r1=' + RANGO_EXPORT.r1,
    'c1=' + RANGO_EXPORT.c1,
    'r2=' + RANGO_EXPORT.r2,
    'c2=' + RANGO_EXPORT.c2,
    'size=letter',
    'portrait=true',
    'scale=4',
    'gridlines=false',
    'printtitle=false',
    'sheetnames=false',
    'pagenum=UNDEFINED',
    'top_margin=0.15',
    'bottom_margin=0.15',
    'left_margin=0.15',
    'right_margin=0.15'
  ].join('&');

  var respuestaFetch = UrlFetchApp.fetch(base + '?' + params, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (respuestaFetch.getResponseCode() !== 200) {
    throw new Error('No se pudo generar el PDF (HTTP ' + respuestaFetch.getResponseCode() + ')');
  }
  return respuestaFetch.getBlob();
}

function formatoFechaArchivo() {
  var d = new Date();
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===== Pruebas desde el editor ===== */

/* Ejecutar > probarEnvio: genera un PDF de listados de prueba */
function probarEnvio() {
  var payload = {
    registros: [
      { fecha: '01/06/2026', referencia: 'OF-001', remitente: 'Prueba Remitente 1', asunto: 'Asunto de prueba 1', control: '111' }
    ]
  };
  var out = doPost({ postData: { contents: JSON.stringify(payload) } });
  Logger.log(out.getContent());
}

/* Ejecutar > probarCarpetasArea: confirma que abre cada carpeta (no cambia nada) */
function probarCarpetasArea() {
  Object.keys(CARPETAS_AREA).forEach(function (a) {
    var f = abrirCarpeta_(CARPETAS_AREA[a]);
    if (f) {
      Logger.log('OK - ' + a + ' - carpeta: ' + f.getName());
    } else {
      Logger.log('NO SE PUDO ABRIR - ' + a);
    }
  });
  Logger.log('Transparencia no tiene carpeta propia: guarda en la GENERAL');
}

/* Ejecutar > probarContrasena: confirma que la contrasena quedo guardada (no la muestra) */
function probarContrasena() {
  var s = PropertiesService.getScriptProperties().getProperty('SECRETO_SERVIDOR');
  Logger.log(s ? 'OK - la contrasena SECRETO_SERVIDOR esta guardada (' + s.length + ' caracteres)' : 'FALTA - no hay SECRETO_SERVIDOR en las propiedades');
}
