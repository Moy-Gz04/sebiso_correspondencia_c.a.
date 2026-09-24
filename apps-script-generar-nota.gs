/**
 * Apps Script dedicado a generar el PDF de "Nota" al apartar una Sala en el
 * Sistema de Correspondencia (SEBISO). Recibe un POST en JSON con los datos
 * ya redactados por el backend (server.js), llena la plantilla de Google
 * Docs, exporta el PDF a la carpeta de Drive indicada y devuelve la URL.
 *
 * Placeholders de la plantilla: <<NOTJ>> <<NP>> <<HORA>> <<FECHA>>
 * <<FECHAREG>> <<ASUNTO>> <<SOLICITUD>>. (La sala solo va en el nombre del archivo.)
 *
 * <<FECHAREG>> = fecha en que se CREA el registro, con el formato
 * "a 23 de octubre del 2026". El backend la manda en `fechareg`; si no
 * llegara (backend viejo), el script la calcula solo con la fecha de hoy
 * en hora de México.
 *
 * Despliegue: Implementar > Administrar implementaciones > (lápiz) >
 * Versión: "Nueva versión" > Implementar. Así la URL ".../exec" NO cambia.
 */

var PLANTILLA_NOTA_ID = '14UVl9_ddyhg84RaOpy-gkD4RyT2-jV4Ox3vUVjnw_uI';
var CARPETA_NOTAS_ID  = '1YaW8KYa-1mNPHW4KqwqPRnXbuc2_dFwz';

var MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

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

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, mensaje: 'Apps Script activo.', version: 'fechareg-2026-09-24' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** "a 23 de octubre del 2026" con la fecha de hoy, en hora de México. */
function fechaRegistroPorDefecto_() {
  var p = Utilities.formatDate(new Date(), 'America/Mexico_City', 'd|M|yyyy').split('|');
  return 'a ' + p[0] + ' de ' + MESES_ES[Number(p[1]) - 1] + ' del ' + p[2];
}

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
  body.replaceText('<<FECHAREG>>', data.fechareg || fechaRegistroPorDefecto_());
  body.replaceText('<<ASUNTO>>', data.asunto || '');
  body.replaceText('<<SOLICITUD>>', data.solicitud || '');

  doc.saveAndClose();

  var pdfBlob = copia.getAs('application/pdf');
  pdfBlob.setName(nombreCopia + '.pdf');
  var pdfFile = carpeta.createFile(pdfBlob);

  DriveApp.getFileById(copia.getId()).setTrashed(true);

  return { ok: true, url: pdfFile.getUrl(), fileId: pdfFile.getId() };
}

/**
 * SOLO PARA PROBAR PERMISOS: selecciónala en el desplegable de funciones
 * (junto al botón Ejecutar) y dale Ejecutar. Bórrala cuando ya funcione.
 */
function testDrive() {
  var carpeta = DriveApp.getFolderById(CARPETA_NOTAS_ID);
  Logger.log('Carpeta encontrada: ' + carpeta.getName());
  var plantilla = DriveApp.getFileById(PLANTILLA_NOTA_ID);
  Logger.log('Plantilla encontrada: ' + plantilla.getName());
}

/** Prueba de la fecha de registro SIN crear ningún archivo. */
function testFechaRegistro() {
  Logger.log(fechaRegistroPorDefecto_());
}

function testDoPostSimulado() {
  var fakeEvent = {
    postData: {
      contents: JSON.stringify({
        action: 'generarNota',
        notj: '0077',
        sala: 'Sala 4',
        np: '6',
        hora: 'en un horario de 15:00 a 17:00 horas',
        fecha: 'el próximo 18 de septiembre de 2026',
        fechareg: 'a 23 de octubre del 2026',
        asunto: 'Lo anterior, con la finalidad de reunión de área',
        solicitud: 'Asimismo, solicitamos el préstamo de 1 micrófono.'
      })
    }
  };
  var resultado = doPost(fakeEvent);
  Logger.log(resultado.getContent());
}
