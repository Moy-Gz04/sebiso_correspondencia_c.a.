/* ═══════════════════════════════════════════════════
   SBIS — Lluvia de flores de cempasúchil (fondo decorativo)
   Genera una cantidad moderada de flores muy pequeñas que caen
   de forma continua y aleatoria detrás del contenido de la
   página (ver .lluvia-flores / .flor-lluvia en css/styles.css,
   o el bloque equivalente dentro de login.html).
   ═══════════════════════════════════════════════════ */
(function () {
  function crearLluviaDeFlores(idContenedor, cantidad) {
    var contenedor = document.getElementById(idContenedor);
    if (!contenedor) {
      contenedor = document.createElement('div');
      contenedor.id = idContenedor;
      contenedor.className = 'lluvia-flores';
      document.body.prepend(contenedor);
    }
    if (contenedor.dataset.pintado === '1') return; // evita duplicar si se llama más de una vez
    contenedor.dataset.pintado = '1';

    cantidad = cantidad || 17; // ni muchas ni pocas

    for (var i = 0; i < cantidad; i++) {
      var flor = document.createElement('div');
      flor.className = 'flor-lluvia';

      var tam       = (11 + Math.random() * 13).toFixed(0);         // 11–24px: flores muy pequeñas
      var izquierda = (Math.random() * 100).toFixed(1);              // 0–100% del ancho
      var duracion  = (13 + Math.random() * 11).toFixed(1);          // 13–24s: caída relativamente normal
      var retraso   = (Math.random() * duracion).toFixed(1);
      var deriva    = (Math.random() * 70 - 35).toFixed(0) + 'px';   // leve vaivén lateral
      var giro      = ((Math.random() < 0.5 ? -1 : 1) * (220 + Math.random() * 260)).toFixed(0) + 'deg';

      flor.style.width  = tam + 'px';
      flor.style.height = tam + 'px';
      flor.style.left   = izquierda + '%';
      flor.style.animationDuration = duracion + 's';
      flor.style.animationDelay    = '-' + retraso + 's'; // arranca a media caída, para que no se vea vacío al cargar
      flor.style.setProperty('--deriva', deriva);
      flor.style.setProperty('--giro-final', giro);

      contenedor.appendChild(flor);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    crearLluviaDeFlores('lluvia-flores', 17);
  });

  window.crearLluviaDeFlores = crearLluviaDeFlores;
})();