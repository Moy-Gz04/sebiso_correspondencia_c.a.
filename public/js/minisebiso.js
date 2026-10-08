// =========================================================
// minisebiso.js
// MiniSEBISO (la mascota del login): sus ojos siguen al ratón o al dedo,
// con un tope para que no se salgan de la cara; si el puntero sale de la
// ventana vuelve a mirar de frente.
// =========================================================

(function () {
  const ojos = document.querySelectorAll('.minisebiso .ms-ojo-mov');
  if (!ojos.length) return;
  const centrar = () => ojos.forEach(o => { o.style.setProperty('--dx', '0px'); o.style.setProperty('--dy', '0px'); });
  window.addEventListener('pointermove', (e) => {
    ojos.forEach(o => {
      const r = o.getBoundingClientRect();
      if (!r.width) return;
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const fuerza = Math.min(1, dist / 220);
      o.style.setProperty('--dx', (dx / dist * r.width * .55 * fuerza).toFixed(1) + 'px');
      o.style.setProperty('--dy', (dy / dist * r.height * .32 * fuerza).toFixed(1) + 'px');
    });
  });
  document.documentElement.addEventListener('mouseleave', centrar);
})();

// Al tocarlo saluda: brinca y muestra una burbuja sobre su cabeza unos segundos
(function () {
  const ms = document.querySelector('.minisebiso');
  if (!ms) return;
  let temporizador = null;
  function saludar() {
    ms.classList.remove('saltando'); void ms.offsetWidth; ms.classList.add('saltando');
    ms.classList.add('hablando');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => ms.classList.remove('hablando'), 4500);
  }
  ms.addEventListener('click', saludar);
  ms.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); saludar(); } });
  ms.addEventListener('animationend', (e) => { if (e.animationName === 'msSalto') ms.classList.remove('saltando'); });
})();

// =========================================================
// MiniSEBISO en el login: saluda (por su nombre si lo recuerda), se tapa
// los ojos mientras escribes la contraseña, avisa los errores y acompaña
// mientras se verifica el acceso.
// =========================================================
(function () {
  const ms = document.querySelector('.login-eclipse .minisebiso, .minisebiso');
  const burbuja = ms && ms.querySelector('.ms-burbuja');
  const usuario = document.getElementById('inp-usuario');
  const clave = document.getElementById('inp-password');
  const errorMsg = document.getElementById('error-msg');
  const errorTxt = document.getElementById('error-txt');
  const boton = document.getElementById('btn-login');
  if (!ms || !burbuja || !usuario || !clave) return;

  // Sesión nueva: que el asistente vuelva a saludar al entrar al sistema
  try { Object.keys(sessionStorage).filter(k => k.startsWith('ms_')).forEach(k => sessionStorage.removeItem(k)); } catch { /* sin storage */ }

  let callar = null;
  function decir(texto, duracion = 5000, { sacudir = false } = {}) {
    burbuja.textContent = texto;
    ms.classList.remove('saltando', 'ms-sacudir'); void ms.offsetWidth;
    ms.classList.add(sacudir ? 'ms-sacudir' : 'saltando', 'hablando');
    clearTimeout(callar);
    if (duracion) callar = setTimeout(() => ms.classList.remove('hablando'), duracion);
  }
  ms.addEventListener('animationend', (e) => { if (e.animationName === 'msSacudirLogin') ms.classList.remove('ms-sacudir'); });

  const bonito = (u) => u ? u.charAt(0).toUpperCase() + u.slice(1) : '';
  const h = new Date().getHours();
  const saludo = h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const recordado = (() => { try { return localStorage.getItem('sbis_usuario_recordado'); } catch { return null; } })();
  setTimeout(() => decir(recordado
    ? `¡${saludo}, ${bonito(recordado)}! Qué gusto verte de nuevo. Solo falta tu contraseña.`
    : `¡${saludo}! Soy MiniSEBISO, tu asistente. Escribe tu usuario y contraseña para empezar.`, 6500), 700);

  // Contraseña: cierra los ojos para no ver (a menos que la muestres con el ojito)
  let avisoOjos = false;
  const ojos = () => ms.classList.toggle('ojos-cerrados', document.activeElement === clave && clave.type === 'password');
  clave.addEventListener('focus', () => {
    ojos();
    if (!avisoOjos && clave.type === 'password') { avisoOjos = true; decir('No te preocupes: no estoy viendo tu contraseña.', 3500); }
  });
  clave.addEventListener('blur', ojos);
  new MutationObserver(ojos).observe(clave, { attributes: true, attributeFilter: ['type'] });

  // Errores del formulario: los dice él
  if (errorMsg && errorTxt) {
    new MutationObserver(() => {
      if (!errorMsg.classList.contains('visible')) return;
      const t = errorTxt.textContent.trim();
      const amable = /incorrect/i.test(t) ? 'Mmm, ese usuario o contraseña no coinciden. Revisa mayúsculas y vuelve a intentarlo.'
        : /completa/i.test(t) ? '¡Me falta un dato! Escribe tu usuario y tu contraseña.'
        : /conectar/i.test(t) ? 'No logro conectarme con el servidor. Revisa tu internet e inténtalo de nuevo.'
        : t;
      decir(amable, 6000, { sacudir: true });
    }).observe(errorMsg, { attributes: true, attributeFilter: ['class'] });
  }

  // Mientras se verifica el acceso
  if (boton) {
    new MutationObserver(() => {
      if (boton.classList.contains('cargando')) decir(`Verificando tus datos${usuario.value.trim() ? ', ' + bonito(usuario.value.trim()) : ''}…`, 0);
    }).observe(boton, { attributes: true, attributeFilter: ['class'] });
  }
})();
