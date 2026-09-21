/**
 * Apps Script dedicado a generar el PDF de "Nota" al apartar una Sala en el
 * Sistema de Correspondencia (SEBISO). Recibe un POST en JSON con los datos
 * ya redactados por el backend (server.js), llena la plantilla de Google
 * Docs, exporta el PDF a la carpeta de Drive indicada y devuelve la URL.
 *
 * Despliegue: Implementar > Nueva implementación > Tipo "Aplicación web"
 *   - Ejecutar como: Yo (tu cuenta)
 *   - Quién tiene acceso: Cualquier usuario
 * La URL que te da el despliegue (".../exec") es la que le paso a server.js.
 */

var PLANTILLA_NOTA_ID = '14UVl9_ddyhg84RaOpy-gkD4RyT2-jV4Ox3vUVjnw_uI';
var CARPETA_NOTAS_ID  = '1YaW8KYa-1mNPHW4KqwqPRnXbuc2_dFwz';

function doPost(e) {
  var resultado;
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'generarNota') {
      resultado = generarNota_(data);
    } else {
      resultado = { ok: false, error: 'Acción no reconocida: ' + data.action };
    }
  } catch (err) {
    resultado = { ok: false, error: String(err) };
  }

  return ContentService
    .createTextOutput(JSON.stringify(resultado))
    .setMimeType(ContentService.MimeType.JSON);
}

// Prueba rápida desde el navegador (GET) para confirmar que el despliegue
// responde antes de conectarlo al backend.
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, mensaje: 'Apps Script activo.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Copia la plantilla, sustituye los placeholders <<...>>, exporta a PDF
 * dentro de la carpeta de notas y borra el Doc intermedio (solo se
 * conserva el PDF final).
 *
 * data esperado:
 *   { action:'generarNota', notj, np, hora, fecha, asunto, solicitud, sala }
 */
function generarNota_(data) {
  var plantilla = DriveApp.getFileById(PLANTILLA_NOTA_ID);
  var carpeta   = DriveApp.getFolderById(CARPETA_NOTAS_ID);

  var nombreCopia = 'Nota ' + (data.notj || '') + ' - ' + (data.sala || 'Sala');
  var copia = plantilla.makeCopy(nombreCopia, carpeta);

  var doc  = DocumentApp.openById(copia.getId());
  var body = doc.getBody();

  body.replaceText('<<NOTJ>>', data.notj || '');
  body.replaceText('<<NP>>', data.np || '');
  body.replaceText('<<HORA>>', data.hora || '');
  body.replaceText('<<FECHA>>', data.fecha || '');
  body.replaceText('<<ASUNTO>>', data.asunto || '');
  body.replaceText('<<SOLICITUD>>', data.solicitud || '');

  doc.saveAndClose();

  var pdfBlob = copia.getAs('application/pdf');
  pdfBlob.setName(nombreCopia + '.pdf');
  var pdfFile = carpeta.createFile(pdfBlob);

  // Antes se llamaba pdfFile.setSharing(ANYONE_WITH_LINK, VIEW) para que el
  // PDF fuera público. La cuenta institucional (tecnm.mx, Workspace for
  // Education) bloquea "cualquier persona con el enlace" a nivel de dominio,
  // así que esa llamada tronaba con "Access denied: DriveApp". Se quita: el
  // PDF hereda el acceso normal de la carpeta (que ya administra el dueño),
  // no necesita ser público para que el sistema lo enlace en la Nota.

  // El Google Doc intermedio ya no hace falta; solo queremos el PDF.
  DriveApp.getFileById(copia.getId()).setTrashed(true);

  return {
    ok: true,
    url: pdfFile.getUrl(),
    fileId: pdfFile.getId()
  };
}

/**
 * SOLO PARA PROBAR PERMISOS: selecciónala en el desplegable de funciones
 * (junto al botón Ejecutar) y dale Ejecutar. Va a pedir autorización de
 * Drive la primera vez. Bórrala cuando ya funcione, no la necesita el
 * backend.
 */
function testDrive() {
  var carpeta = DriveApp.getFolderById(CARPETA_NOTAS_ID);
  Logger.log('Carpeta encontrada: ' + carpeta.getName());
  var plantilla = DriveApp.getFileById(PLANTILLA_NOTA_ID);
  Logger.log('Plantilla encontrada: ' + plantilla.getName());
}
