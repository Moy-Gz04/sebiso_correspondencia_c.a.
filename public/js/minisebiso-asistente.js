// =========================================================
// minisebiso-asistente.js
// Convierte a MiniSEBISO en el asistente de todo el sistema. Se carga
// después de minisebiso-flotante.js en cada página y, sin tocar la
// lógica de cada vista, hace que la mascota:
//   - salude por su nombre al usuario y le cuente qué tiene pendiente;
//   - dé consejos de la página al tocarla;
//   - hable todos los avisos y confirmaciones (sbisAlert / sbisConfirm);
//   - acompañe cada ventana con formulario y señale el dato que falta;
//   - avise cuando llegan oficios nuevos;
//   - comente búsquedas sin resultados, archivos elegidos y guardados;
//   - pregunte antes de cerrar la sesión.
// =========================================================
(function () {
  const M = window.MiniSEBISO;
  if (!M || !M.preguntar) return;

  /* ─────────────── Contexto ─────────────── */
  const API = location.origin + '/api';
  const pagina = (location.pathname.split('/').pop() || '').replace(/\.html$/, '') || 'login';
  let usuario = null;
  try { usuario = JSON.parse(localStorage.getItem('sbis_usuario') || 'null'); } catch { usuario = null; }
  const nombre = !usuario?.username ? '' : usuario.username === 'admin' ? 'Administrador'
    : usuario.username.charAt(0).toUpperCase() + usuario.username.slice(1);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const conNombre = (texto) => nombre ? `${texto}, ${nombre}` : texto;
  function saludoHora() {
    const h = new Date().getHours();
    return h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  }
  function despedidaHora() {
    const h = new Date().getHours();
    return h < 6 ? 'Que descanses.' : h < 12 ? 'Que tengas un excelente día.' : h < 19 ? 'Que tengas una excelente tarde.' : 'Que descanses.';
  }
  const sesion = {
    get(k) { try { return sessionStorage.getItem('ms_' + k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem('ms_' + k, v); } catch { /* sin storage */ } },
  };
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const sinAcentos = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  async function api(ruta) {
    const token = localStorage.getItem('sbis_token');
    if (!token) return null;
    try {
      const res = await fetch(API + ruta, { headers: { Authorization: `Bearer ${token}` } });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }

  /* ─────────────── Lo que sabe de cada página ─────────────── */
  // Para qué sirve cada página (se dice una vez por sesión al entrar)
  const PAGINAS = {
    historial: 'Aquí está el Historial de Oficios: puedes turnarlos a un área, pedir correcciones y finalizarlos.',
    area: `Esta es la Bandeja de ${usuario?.area || 'tu área'}: aquí llegan los oficios que les turnan.`,
    usuario: 'Esta es tu Bandeja: aquí están los oficios que te asignaron para atender.',
    captura: 'Aquí registras un oficio a mano para generar su número.',
    'captura-auto': 'Aquí registras un oficio a partir de su foto: yo leo los datos por ti.',
    'captura-movil': 'Toma la foto del oficio y envíala; después terminas el registro en la computadora.',
    circular: 'Aquí llevas el control de los números de Circular.',
    'no-oficio': 'Aquí llevas el control de los números de Oficio.',
    'tarjeta-informativa': 'Aquí llevas el control de los números de Tarjeta Informativa.',
    minutario: 'Aquí registras la Fecha de Sello, la Fecha de Firma y notas de cada número.',
    salas: 'Aquí apartas las salas de juntas y ves los próximos apartados.',
  };
  const info = PAGINAS[pagina] ? { intro: PAGINAS[pagina] } : null;

  /* ─────────────── Avisos y confirmaciones hablados ─────────────── */
  const SALUDO_AVISO = {
    success: ['¡Listo!', '¡Hecho!', '¡Excelente!', '¡Perfecto!'],
    error:   ['¡Ups!', '¡Ay, no!'],
    warning: ['¡Ojo!', '¡Un detalle!'],
    info:    ['¡Te cuento!', '¡Dato importante!'],
  };
  let ultimoError = 0;

  function alerta({ titulo = 'Aviso', mensaje = '', btnOk = 'Aceptar', tipo = 'info', onClose = null } = {}) {
    if (tipo === 'error') ultimoError = Date.now();
    const saludo = azar(SALUDO_AVISO[tipo] || SALUDO_AVISO.info);
    const boton = btnOk === 'Aceptar' ? (tipo === 'success' ? 'Continuar' : 'Entendido') : btnOk;
    return M.preguntar({
      titulo: esc(tipo === 'success' && Math.random() < .5 ? conNombre(saludo.replace('!', '')) + '!' : saludo),
      pregunta: esc(titulo),
      detalle: esc(mensaje),
      soloOk: true,
      btnOk: esc(boton),
      iconoOk: tipo === 'success' ? 'ti-check' : tipo === 'error' ? 'ti-refresh' : 'ti-thumb-up',
      estiloOk: tipo === 'success' ? 'verde' : 'dorado',
      tono: { success: 'exito', error: 'error', warning: 'aviso' }[tipo] || '',
      saludoOk: tipo === 'error' ? '¡Ánimo!' : tipo === 'success' ? '¡Sigamos!' : '¡Va!',
      textoOk: tipo === 'error' ? 'Lo resolvemos juntos.' : tipo === 'success' ? 'Seguimos trabajando…' : 'Aquí sigo por si me necesitas.',
    }).then(() => {
      if (onClose) onClose();
      if (tipo === 'warning' || tipo === 'error') setTimeout(senalarInvalido, 60);
    });
  }

  let ultimaConfirmacion = { cuando: 0, ok: false };
  function confirmar({ titulo = '¿Estás seguro?', mensaje = '', btnOk = 'Aceptar', btnCancel = 'Cancelar', tipo = 'confirm' } = {}) {
    const peligro = tipo === 'danger';
    const borra = /eliminar|borrar|descartar|quitar|limpiar/i.test(btnOk);
    return M.preguntar({
      titulo: esc(peligro ? azar(['¡Un momento!', nombre ? `¡Espera, ${nombre}!` : '¡Espera!']) : azar(['¡Oye!', '¡Una pregunta!'])),
      pregunta: esc(titulo),
      detalle: esc(mensaje),
      btnOk: esc(btnOk),
      // «Cancelar» junto a «Cancelar apartado» confunde: el de salir dice otra cosa
      btnCancel: esc(btnCancel === 'Cancelar' && /cancelar/i.test(btnOk) ? 'No, mantenerlo' : btnCancel),
      iconoOk: borra ? 'ti-trash' : peligro ? 'ti-alert-triangle' : 'ti-check',
      estiloOk: peligro || borra ? '' : 'verde',
      tono: peligro || borra ? 'aviso' : '',
      saludoOk: '¡Entendido!',
      textoOk: borra ? 'Lo hago ahora mismo…' : '¡Manos a la obra!',
    }).then(ok => { ultimaConfirmacion = { cuando: Date.now(), ok }; return ok; });
  }

  // Con el asistente apagado (botón «Asistente» del encabezado) vuelven las ventanas normales de la página
  const originales = { alerta: window.sbisAlert, confirmar: window.sbisConfirm, alert: window.alert };
  window.sbisAlert = (o = {}) => M.apagado && originales.alerta ? Promise.resolve(originales.alerta(o)) : alerta(o);
  window.sbisConfirm = (o = {}) => M.apagado ? Promise.resolve(originales.confirmar ? originales.confirmar(o) : window.confirm(o.mensaje || o.titulo || '¿Continuar?')) : confirmar(o);
  // Los alert() nativos que quedan también los dice él (sin bloquear la página)
  window.alert = (msg) => { if (M.apagado) return originales.alert.call(window, msg); alerta({ titulo: 'Revisa esto', mensaje: String(msg ?? ''), tipo: 'warning' }); };

  /* Después de un aviso de datos incompletos, salta junto al primer campo marcado en rojo */
  function etiquetaDe(campo) {
    let txt = '';
    if (campo.id) txt = document.querySelector(`label[for="${CSS.escape(campo.id)}"]`)?.textContent || '';
    if (!txt) txt = campo.closest('label')?.textContent || '';
    if (!txt) txt = campo.closest('.campo, .form-group, .modal-campo, .grupo, .form-campo, div')?.querySelector('label')?.textContent || '';
    if (!txt) txt = campo.getAttribute('aria-label') || campo.placeholder || '';
    return txt.replace(/[*:]/g, '').replace(/\s+/g, ' ').trim();
  }
  // Uno por uno: al llenar un campo salta al siguiente que siga vacío
  function senalarInvalido(primero = true) {
    const campo = [...document.querySelectorAll('.invalido, [aria-invalid="true"]')]
      .find(c => visible(c) && !String(c.value || '').trim());
    if (!campo) { if (!primero) M.decir('¡Excelente! Ya está todo lo obligatorio, puedes guardar.', { duracion: 4500 }); return; }
    const etq = etiquetaDe(campo);
    const texto = primero
      ? (etq ? `Empecemos por aquí: me falta «${etq}».` : 'Empecemos por aquí: me falta este dato.')
      : (etq ? `¡Bien! Ahora me falta «${etq}».` : '¡Bien! Ahora me falta este dato.');
    presentarYEsperar(campo, texto, () => setTimeout(() => senalarInvalido(false), 950));
  }

  /* presentar() + se retira solo cuando el campo ya tiene valor (o a los 12 s) */
  function presentarYEsperar(campo, texto, alLlenar = null) {
    if (!M.presentar) return;
    M.presentar(campo, texto);
    let hecho = false;
    const listo = () => {
      if (hecho || !String(campo.value || '').trim()) return;
      hecho = true; limpiar();
      if (M.presentando && M.presentando() === campo) M.retirar();
      if (alLlenar) alLlenar();
    };
    // Texto: espera a que deje de escribir un momento; listas, fechas y archivos: al elegir
    const esTexto = campo.tagName === 'TEXTAREA' || ['text', 'search', 'email', 'number', 'tel', ''].includes(campo.type);
    let pausa = 0;
    const alEscribir = esTexto ? () => { clearTimeout(pausa); pausa = setTimeout(listo, 1300); } : listo;
    const limpiar = () => { clearTimeout(pausa); campo.removeEventListener('input', alEscribir); campo.removeEventListener('change', listo); };
    campo.addEventListener('input', alEscribir);
    campo.addEventListener('change', listo);
    setTimeout(() => { if (!hecho) { hecho = true; limpiar(); if (M.presentando && M.presentando() === campo) M.retirar(); } }, 12000);
  }

  /* ─────────────── Cerrar sesión: pregunta antes ─────────────── */
  // Solo los botones de «Cerrar sesión»: las salidas automáticas (sesión
  // vencida) siguen llamando a cerrarSesion() directo, sin preguntar.
  function prepararSalida() {
    document.querySelectorAll('button[onclick="cerrarSesion()"]').forEach(btn => {
      btn.removeAttribute('onclick');
      btn.addEventListener('click', async () => {
        if (M.apagado) { if (typeof window.cerrarSesion === 'function') window.cerrarSesion(); return; }
        const ok = await M.preguntar({
          titulo: esc(nombre ? `¿Ya te vas, ${nombre}?` : '¿Ya te vas?'),
          pregunta: '¿Cierro tu sesión?',
          detalle: 'Puedes volver a entrar cuando quieras con tu usuario y contraseña.',
          btnOk: 'Sí, cerrar sesión', btnCancel: 'Me quedo',
          iconoOk: 'ti-logout', estiloOk: 'dorado',
          saludoOk: '¡Hasta pronto!', textoOk: despedidaHora(),
          saludoCancel: '¡Qué bien!', textoCancel: 'Sigo aquí para ayudarte.',
        });
        if (ok && typeof window.cerrarSesion === 'function') window.cerrarSesion();
      });
    });
  }

  /* ─────────────── Saludo y resumen de pendientes ─────────────── */
  // Qué tiene pendiente el usuario, según su rol y la página
  async function pendientes() {
    if (!usuario) return null;
    if (pagina === 'area' && usuario.rol === 'area') {
      const d = await api('/oficios/bandeja?desde=0&limite=1&filtro=turnado');
      if (!d) return null;
      return { nuevos: d.total || 0, corregir: d.conteos?.rechazado || 0, mios: d.conteos?.asignados_mi || 0 };
    }
    if (pagina === 'usuario' && usuario.rol === 'usuario_area') {
      const d = await api('/oficios/bandeja?desde=0&limite=1&filtro=sub_turnado');
      if (!d) return null;
      return { nuevos: d.total || 0, corregir: d.conteos?.rechazado || 0 };
    }
    if (pagina === 'historial') {
      const [a, b] = await Promise.all([
        api('/oficios/historial?limite=1&estatus=por_turnar'),
        api('/oficios/historial?limite=1&estatus=atendido'),
      ]);
      if (!a || !b) return null;
      return { porTurnar: a.total || 0, atendidos: b.total || 0 };
    }
    return null;
  }

  function resumenTexto(p) {
    if (!p) return null;
    if (pagina === 'historial') {
      const partes = [];
      if (p.porTurnar) partes.push(`${plural(p.porTurnar, 'oficio', 'oficios')} por turnar`);
      if (p.atendidos) partes.push(`${plural(p.atendidos, 'oficio atendido', 'oficios atendidos')} por finalizar`);
      return partes.length
        ? { texto: `Hoy tienes ${partes.join(' y ')}.`, chip: p.porTurnar ? 'por_turnar' : 'atendido', accion: 'Ver pendientes' }
        : { texto: '¡Todo al día! No hay oficios por turnar ni por finalizar.' };
    }
    const partes = [];
    if (p.nuevos) partes.push(pagina === 'area' ? `${plural(p.nuevos, 'oficio', 'oficios')} por asignar` : `${plural(p.nuevos, 'oficio', 'oficios')} por atender`);
    if (p.corregir) partes.push(`${plural(p.corregir, 'oficio', 'oficios')} por corregir`);
    if (pagina === 'area' && p.mios) partes.push(`${plural(p.mios, 'oficio asignado', 'oficios asignados')} a ti`);
    if (!partes.length) return { texto: '¡Tu bandeja está al día! No tienes oficios pendientes.' };
    const chip = p.nuevos ? (pagina === 'area' ? 'turnado' : 'sub_turnado') : p.corregir ? 'rechazado' : 'asignados_mi';
    return { texto: `Tienes ${partes.join(', ').replace(/, ([^,]*)$/, ' y $1')}.`, chip, accion: 'Ver pendientes' };
  }

  // Abre el filtro que corresponde (el mismo botón que usaría el usuario)
  function irAlFiltro(estatus) {
    const chip = document.querySelector(`.chip[data-estatus="${estatus}"]`)
      || [...document.querySelectorAll('.chip')].find(c => (c.getAttribute('onclick') || '').includes(`'${estatus}'`));
    if (chip) { chip.click(); chip.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }

  // Dice una serie de mensajes uno tras otro en la esquina
  function decirSerie(mensajes) {
    let espera = 0;
    mensajes.forEach(m => {
      setTimeout(() => M.decir(m.texto, m), espera);
      espera += (m.duracion || 6500) + 350;
    });
  }

  async function saludar() {
    if (!usuario || !info) return;
    const clave = 'saludo_' + usuario.username;
    const mensajes = [];
    if (!sesion.get(clave)) {
      sesion.set(clave, '1');
      sesion.set('intro_' + pagina, '1');
      mensajes.push({ texto: `¡${saludoHora()}, ${nombre}! Aquí estoy para ayudarte en lo que necesites.`, duracion: 5500 });
      mensajes.push({ texto: info.intro + ' Si tienes una duda, tócame.', duracion: 7000 });
    } else if (!sesion.get('intro_' + pagina)) {
      sesion.set('intro_' + pagina, '1');
      mensajes.push({ texto: info.intro, duracion: 7000 });
    }
    // El resumen de pendientes, la primera vez que entra a su bandeja en la sesión
    if (!sesion.get('resumen_' + pagina)) {
      const r = resumenTexto(await pendientes());
      if (r) {
        sesion.set('resumen_' + pagina, '1');
        mensajes.push(r.chip
          ? { texto: r.texto, duracion: 10000, accion: r.accion, alTocar: () => irAlFiltro(r.chip) }
          : { texto: r.texto, duracion: 6500 });
      }
    }
    if (mensajes.length) decirSerie(mensajes);
  }

  /* Al tocarlo en la esquina: «¿En qué puedo ayudarte?» (ver menú de ayuda, más abajo) */
  M.alTocarEsquina = () => abrirAyuda();

  /* ─────────────── Avisa cuando llegan oficios nuevos ─────────────── */
  function vigilarNovedades() {
    if (!['area', 'usuario', 'historial'].includes(pagina)) return;
    let antes = null;
    const revisar = async () => {
      if (document.hidden) return;
      const p = await pendientes();
      if (!p) return;
      if (antes) {
        const avisos = [];
        if (pagina === 'historial') {
          if (p.atendidos > antes.atendidos) avisos.push({ n: p.atendidos - antes.atendidos, txt: (n) => `¡Un área terminó de atender ${plural(n, 'oficio', 'oficios')}! Ya puedes revisarlo y finalizarlo.`, chip: 'atendido' });
        } else {
          if (p.nuevos > antes.nuevos) avisos.push({ n: p.nuevos - antes.nuevos, txt: (n) => n === 1 ? '¡Te llegó un oficio nuevo!' : `¡Te llegaron ${n} oficios nuevos!`, chip: pagina === 'area' ? 'turnado' : 'sub_turnado' });
          if (p.corregir > antes.corregir) avisos.push({ n: p.corregir - antes.corregir, txt: (n) => `${n === 1 ? 'Un oficio regresó' : `${n} oficios regresaron`} para corregirse.`, chip: 'rechazado' });
        }
        avisos.forEach((a, i) => setTimeout(() => M.decir(a.txt(a.n), {
          duracion: 15000, accion: 'Ver ahora',
          alTocar: async () => {
            if (typeof window.cargarOficios === 'function' && pagina !== 'historial') await window.cargarOficios();
            irAlFiltro(a.chip);
          },
        }), i * 15500));
      }
      antes = p;
    };
    revisar();
    setInterval(revisar, 60000);
  }

  /* ─────────────── Acompaña cada ventana con formulario ─────────────── */
  const NOMBRE_REGISTRO = { circular: 'No. Circular', 'no-oficio': 'No. de Oficio', 'tarjeta-informativa': 'No. de Tarjeta Informativa' };
  function textoVentana(modal) {
    switch (modal.id) {
      case 'modal-subturnar': return '¡Vamos a turnarlo! Elige a quién se lo asignas y, si quieres, déjale una instrucción.';
      case 'modal-atender':   return '¡A atender este oficio! Adjunta los documentos que falten, cuéntame qué se hizo y guarda.';
      case 'modal-turnar':    return '¡Elijamos a qué área lo turnas!';
      case 'modal-rechazar':  return 'Cuéntale al área, con detalle, qué debe corregir.';
      case 'modal-nuevo-no-of': {
        const t = document.getElementById('modal-nuevo-titulo')?.textContent || '';
        return /editar/i.test(t)
          ? 'Te ayudo a corregir este registro. Cambia lo que necesites y guarda.'
          : `¡Registremos tu nuevo ${NOMBRE_REGISTRO[pagina] || 'número'}! Llena los datos y guarda.`;
      }
      default: return '¡Aquí estoy para ayudarte con esta ventana!';
    }
  }
  function tieneCampos(modal) {
    return [...modal.querySelectorAll('input, select, textarea')].some(c => c.type !== 'hidden' && visible(c));
  }
  function vigilarVentanas() {
    document.querySelectorAll('[id^="modal-"]').forEach(modal => {
      if (modal.id === 'modal-editar') return;   // el Historial ya lo acompaña con su propio mensaje
      let abierto = false;
      new MutationObserver(() => {
        const ahora = getComputedStyle(modal).display !== 'none';
        if (ahora === abierto) return;
        abierto = ahora;
        if (ahora && M.ayudarEditar && tieneCampos(modal)) M.ayudarEditar(modal, { texto: textoVentana(modal), persistente: true });
      }).observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
    });
  }

  /* ─────────────── Mensajes de error: señala el dato que falta ─────────────── */
  function adivinarCampo(contenedor, mensaje) {
    const palabras = sinAcentos(mensaje).split(/[^a-zñ]+/).filter(p => p.length >= 4);
    let mejor = null, puntos = 0;
    contenedor.querySelectorAll('input, select, textarea').forEach(c => {
      if (['hidden', 'button', 'submit', 'checkbox', 'radio'].includes(c.type) || c.disabled || !visible(c)) return;
      let p = 0;
      const vacio = c.type === 'file' ? !c.files?.length : !String(c.value || '').trim();
      if (vacio) p += 3;
      const etq = sinAcentos(etiquetaDe(c) + ' ' + (c.id || '') + ' ' + (c.name || ''));
      palabras.forEach(w => { if (etq.includes(w)) p += 2; });
      if (c.type === 'file' && /adjunt|document|archivo/.test(sinAcentos(mensaje))) p += 4;
      if (c.tagName === 'SELECT' && /seleccion|elige|opcion/.test(sinAcentos(mensaje))) p += 3;
      if (c.type === 'date' && /fecha/.test(sinAcentos(mensaje))) p += 3;
      if (c.type === 'time' && /hora/.test(sinAcentos(mensaje))) p += 2;
      if (p > puntos) { puntos = p; mejor = c; }
    });
    return puntos >= 4 ? mejor : null;
  }
  function alErrorVisible(el, texto) {
    const modal = el.closest('[id^="modal-"]');
    if (modal && M.ayudando && M.ayudando()) {
      const campo = adivinarCampo(modal, texto);
      if (!(campo && M.senalar(campo, texto, { textoListo: '¡Perfecto! Ya puedes guardar.' }))) M.comentar(texto, { alerta: true });
      return;
    }
    if (modal) return;
    const zona = el.closest('form, .salas-panel, .panel-gestion, .cm-card, section, .main-contenido') || document.body;
    presentarYEsperar(adivinarCampo(zona, texto) || el, texto);
  }
  function vigilarErrores() {
    const vistos = new WeakMap();
    const revisar = (el) => {
      const texto = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const antes = vistos.get(el) || '';
      vistos.set(el, visible(el) ? texto : '');
      if (texto && visible(el) && texto !== antes) alErrorVisible(el, texto);
    };
    document.querySelectorAll('[id*="error"]:not([id^="sbis"]):not(input):not(select):not(textarea)').forEach(el => {
      new MutationObserver(() => revisar(el)).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    });
  }

  /* ─────────────── Archivos elegidos ─────────────── */
  function vigilarArchivos() {
    document.addEventListener('change', (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
      const n = input.files.length;
      const nom = n === 1 ? `«${input.files[0].name}»` : `${n} archivos`;
      if (M.ayudando && M.ayudando()) { M.comentar(`¡Recibí ${nom}! Se subirá cuando guardes.`); return; }
      if (pagina === 'captura-movil') M.decir('¡Buena foto! Revísala y, si se ve bien, toca «Enviar».', { duracion: 5500 });
    }, true);
  }

  /* ─────────────── Búsquedas sin resultados ─────────────── */
  function vigilarBusquedas() {
    if (typeof window.crearPaginador !== 'function') return;
    const original = window.crearPaginador;
    let ultimo = '';
    window.crearPaginador = function (cfg) {
      const vacioOriginal = cfg.vacio;
      return original.call(this, Object.assign({}, cfg, {
        vacio: () => {
          const caja = [...document.querySelectorAll('.buscador-input, #buscador, input[type="search"]')].find(visible);
          const q = (caja?.value || '').trim();
          if (q && q !== ultimo) {
            ultimo = q;
            setTimeout(() => presentarYEsperar(caja, `No encontré nada con «${q}». Prueba con el número de oficio, el remitente o una palabra del asunto.`), 50);
          }
          if (!q) ultimo = '';
          return vacioOriginal();
        },
      }));
    };
  }

  /* ─────────────── Minutario: confirma cada dato guardado ─────────────── */
  function vigilarMinutario() {
    if (pagina !== 'minutario' || typeof window.guardarSello !== 'function') return;
    const original = window.guardarSello;
    const NOMBRE = { fecha_sello: 'la Fecha de Sello', fecha_firma: 'la Fecha de Firma', nota: 'la nota' };
    window.guardarSello = async function (id, campo, input) {
      const inicio = Date.now();
      await original.apply(this, arguments);
      if (ultimoError < inicio) M.decir(`¡Guardé ${NOMBRE[campo] || 'el dato'}!`, { duracion: 2500 });
    };
  }

  /* ─────────────── Eliminaciones que la página hace sin avisar ─────────────── */
  // Tras confirmar y si no hubo error, MiniSEBISO avisa que quedó hecho
  function vigilarEliminaciones() {
    const DE = { circular: 'No. Circular', 'no-oficio': 'No. de Oficio', 'tarjeta-informativa': 'No. de Tarjeta Informativa' };
    const envolver = (nombreFn, texto) => {
      const original = window[nombreFn];
      if (typeof original !== 'function') return;
      window[nombreFn] = async function () {
        const inicio = Date.now();
        const r = await original.apply(this, arguments);
        if (ultimaConfirmacion.ok && ultimaConfirmacion.cuando >= inicio && ultimoError < inicio) {
          setTimeout(() => M.decir(texto(...arguments), { duracion: 5500 }), 300);
        }
        return r;
      };
    };
    if (DE[pagina]) envolver('eliminarFila', (id, numero) => `¡Listo! Eliminé el ${DE[pagina]} ${numero}. Su número quedó libre para reasignarlo después.`);
    if (pagina === 'salas') {
      envolver('eliminarSala', (id, nombre) => `¡Listo! Eliminé la sala${nombre ? ' «' + nombre + '»' : ''}.`);
      envolver('eliminarHistorial', () => '¡Listo! Eliminé ese registro del historial.');
      envolver('descartarApartado', () => '¡Listo! Cancelé el apartado; la sala quedó libre en ese horario.');
    }
  }

  /* ─────────────── Captura desde celular: foto enviada ─────────────── */
  function vigilarFotoEnviada() {
    const exito = document.getElementById('cm-exito');
    if (!exito) return;
    new MutationObserver(() => {
      if (exito.classList.contains('visible')) M.decir('¡Foto enviada! Ya la estoy procesando. Puedes tomar otra cuando quieras.', { duracion: 6000 });
    }).observe(exito, { attributes: true, attributeFilter: ['class'] });
  }

  /* ─────────────── Menú de ayuda: «¿En qué puedo ayudarte?» ─────────────── */
  // Al tocarlo pregunta en qué ayudar; las preguntas dependen de la página, el
  // rol y el área. Cada respuesta explica los pasos y ofrece llevarte a hacerlo.
  const gestion = usuario?.rol === 'admin' || (usuario?.rol === 'area' && usuario?.area === 'Coordinación Administrativa');
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));
  const miArea = usuario?.area || 'tu área';

  // Señala un botón o campo de la página (abre su tarjeta si está cerrada)
  async function guiar(selector, texto) {
    const todos = [...document.querySelectorAll(selector)];
    const el = todos.find(e => e.getClientRects().length) || todos[0];
    if (!el) { M.decir('Ahora mismo no hay nada de eso en la lista. Prueba con otro filtro o búscalo.', { duracion: 5500 }); return; }
    const tarjeta = el.closest('[id^="tarjeta-"]');
    if (tarjeta && !tarjeta.classList.contains('abierta')) { tarjeta.querySelector('.t-header')?.click(); await esperar(450); }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) { presentarYEsperar(el, texto); return; }
    M.presentar(el, texto);
    const soltar = () => { if (M.presentando && M.presentando() === el) M.retirar(); };
    el.addEventListener('click', soltar, { once: true });
    setTimeout(soltar, 12000);
  }
  const ir = (ruta) => () => { location.href = ruta; };
  const filtrarY = (estatus, selector, texto) => async () => {
    irAlFiltro(estatus);
    if (selector) { await esperar(1200); guiar(selector, texto); }
  };
  const buscador = () => guiar('#buscador, .buscador-input', 'Escribe aquí lo que buscas: número, remitente o una palabra del asunto.');

  // Lo que tiene pendiente, con botones para ir a cada grupo
  async function respuestaPendientes() {
    const p = await pendientes();
    const r = resumenTexto(p);
    if (!r) return { texto: 'No pude consultar tus pendientes en este momento. Intenta de nuevo en un momento.' };
    const acc = [];
    if (pagina === 'historial') {
      if (p.porTurnar) acc.push({ texto: 'Ver por turnar', icono: 'ti-arrow-forward', hacer: () => irAlFiltro('por_turnar') });
      if (p.atendidos) acc.push({ texto: 'Ver atendidos', icono: 'ti-circle-check', hacer: () => irAlFiltro('atendido') });
    } else {
      if (p.nuevos) acc.push({ texto: pagina === 'area' ? 'Ver por asignar' : 'Ver por atender', icono: 'ti-inbox', hacer: () => irAlFiltro(pagina === 'area' ? 'turnado' : 'sub_turnado') });
      if (p.corregir) acc.push({ texto: 'Ver por corregir', icono: 'ti-arrow-back-up', hacer: () => irAlFiltro('rechazado') });
      if (pagina === 'area' && p.mios) acc.push({ texto: 'Ver asignados a mí', icono: 'ti-user-check', hacer: () => irAlFiltro('asignados_mi') });
    }
    return { texto: r.texto, acciones: acc };
  }

  const P_REGISTRAR = {
    pregunta: 'Quiero registrar un oficio nuevo', icono: 'ti-file-plus',
    texto: 'Tienes dos formas de registrarlo:',
    pasos: ['Con la foto del oficio (Registro Automático): yo leo los datos y tú solo los revisas.', 'A mano (Nuevo Registro): llenas los datos tú mismo.'],
    acciones: [
      { texto: 'Con la foto', icono: 'ti-camera', hacer: ir('/captura-auto') },
      { texto: 'A mano', icono: 'ti-pencil', hacer: ir('/captura') },
    ],
  };
  const P_BUSCAR = (que) => ({
    pregunta: '¿Cómo encuentro un registro?', icono: 'ti-search',
    texto: `Usa el buscador: ${que}`,
    acciones: [{ texto: 'Llévame al buscador', icono: 'ti-search', hacer: buscador }],
  });
  const P_LIMPIAR = {
    pregunta: 'Quiero empezar de nuevo', icono: 'ti-eraser',
    texto: 'Usa «Limpiar»: te pediré confirmación antes de borrar lo capturado.',
    acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: () => guiar('#btn-limpiar', 'Con este botón limpias el formulario.') }],
  };

  function preguntas() {
    switch (pagina) {
      case 'historial': return [
        { pregunta: '¿Qué tengo pendiente?', icono: 'ti-list-check', cargar: respuestaPendientes },
        { pregunta: '¿Cómo turno un oficio a un área?', icono: 'ti-arrow-forward',
          pasos: ['Abre el filtro «Por Turnar».', 'Despliega la tarjeta del oficio.', 'Toca «Turnar a Área», elige el área y confirma.'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: filtrarY('por_turnar', 'button[onclick^="abrirTurnar"]', 'Toca aquí para turnarlo a un área.') }] },
        { pregunta: '¿Cómo finalizo un oficio atendido?', icono: 'ti-circle-check',
          pasos: ['Abre el filtro «Atendido».', 'Revisa los documentos que subió el área.', 'Si todo está bien toca «Finalizar»; si falta algo, «Rechazar» y explica qué corregir.'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: filtrarY('atendido', 'button[onclick^="finalizar"]', 'Cuando todo esté en orden, finalízalo aquí.') }] },
        { pregunta: '¿Cómo corrijo los datos de un oficio?', icono: 'ti-edit',
          pasos: ['Despliega la tarjeta del oficio.', 'Toca «Editar».', 'Cambia lo necesario y toca «Actualizar cambios».'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: () => guiar('button[onclick^="abrirEditar"]', 'Aquí editas los datos del oficio.') }] },
        P_BUSCAR('acepta el número de oficio, el remitente, la dependencia o una palabra del asunto. También puedes filtrar por área.'),
        P_REGISTRAR,
      ];
      case 'area': return [
        { pregunta: '¿Qué tengo pendiente?', icono: 'ti-list-check', cargar: respuestaPendientes },
        { pregunta: `¿Cómo asigno un oficio a alguien de ${miArea}?`, icono: 'ti-user-share',
          pasos: ['Abre el filtro «Pendientes».', 'Despliega la tarjeta del oficio.', 'Toca «Turnar / Atender».', 'Elige a la persona (o «Yo mismo») y toca «Confirmar Asignación».'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: filtrarY('turnado', '.btn-subturnar', 'Toca aquí para asignarlo.') }] },
        { pregunta: '¿Cómo atiendo un oficio que me asignaron?', icono: 'ti-circle-check',
          pasos: ['Abre el filtro «Para Atender».', 'Toca «Atender Oficio» en su tarjeta.', 'Adjunta el Turno (si no viene) y el Seguimiento, describe lo realizado y guarda.'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: filtrarY('asignados_mi', '.btn-atender', 'Toca aquí para atenderlo.') }] },
        { pregunta: 'Me regresaron un oficio para corregir', icono: 'ti-arrow-back-up',
          pasos: ['Abre el filtro «Por Corregir».', 'Lee en la tarjeta qué se debe corregir.', 'Toca «Corregir y Reenviar», o «Re-asignar para Corrección» si lo corregirá otra persona.'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: filtrarY('rechazado', '.btn-atender, .btn-subturnar', 'Desde aquí lo corriges o lo reasignas.') }] },
        { pregunta: '¿Cómo reasigno un oficio a otra persona?', icono: 'ti-user-switch',
          pasos: ['Abre el filtro «Sub-turnados» (o «Para Atender» si es tuyo).', 'Despliega la tarjeta y toca «Reasignar».', 'Elige a la nueva persona y confirma.'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: filtrarY('sub_turnado', '.btn-reasignar', 'Toca aquí para reasignarlo.') }] },
        P_BUSCAR('acepta el número de oficio, el remitente o una palabra del asunto.'),
        ...(gestion ? [P_REGISTRAR, { pregunta: 'Quiero ver todos los oficios registrados', icono: 'ti-history', texto: 'Todos los oficios que registra Coordinación están en el Historial.', acciones: [{ texto: 'Ir al Historial', icono: 'ti-history', hacer: ir('/historial') }] }] : []),
      ];
      case 'usuario': return [
        { pregunta: '¿Qué tengo pendiente?', icono: 'ti-list-check', cargar: respuestaPendientes },
        { pregunta: '¿Cómo atiendo un oficio?', icono: 'ti-circle-check',
          pasos: ['Abre el filtro de oficios por atender.', 'Toca «Atender Oficio» en su tarjeta.', 'Adjunta el Turno (si no viene) y el Seguimiento, describe lo realizado y guarda.'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: filtrarY('sub_turnado', '.btn-atender', 'Toca aquí para atenderlo.') }] },
        { pregunta: 'Me regresaron un oficio para corregir', icono: 'ti-arrow-back-up',
          pasos: ['Abre el filtro de oficios por corregir.', 'Lee en la tarjeta qué se debe corregir.', 'Atiéndelo de nuevo con los cambios y guarda para reenviarlo.'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: filtrarY('rechazado', '.btn-atender', 'Desde aquí lo corriges y lo reenvías.') }] },
        { pregunta: '¿Dónde veo lo que ya entregué?', icono: 'ti-archive', texto: 'Lo que ya atendiste está en «Atendidos», y lo que se cerró por completo en «Completados».',
          acciones: [{ texto: 'Ver atendidos', icono: 'ti-archive', hacer: () => irAlFiltro('atendido') }] },
        P_BUSCAR('acepta el número de oficio, el remitente o una palabra del asunto.'),
      ];
      case 'captura': return [
        { pregunta: '¿Qué datos son obligatorios?', icono: 'ti-asterisk',
          cargar: async () => {
            const req = [...document.querySelectorAll('#form-captura [required]')];
            const nombres = req.map(etiquetaDe).filter(Boolean);
            return {
              texto: nombres.length ? `Para guardar necesito: ${nombres.join(', ')}. Lo demás ayuda a encontrarlo después.` : 'F. Oficio y Remitente son obligatorios; lo demás ayuda a encontrarlo después.',
              acciones: [{ texto: 'Llévame al primero que falta', icono: 'ti-hand-finger', hacer: () => {
                const c = req.find(e => visible(e) && !String(e.value || '').trim());
                if (c) presentarYEsperar(c, `Empecemos por aquí: «${etiquetaDe(c)}».`);
                else M.decir('¡Ya tienes todo lo obligatorio! Puedes guardar.', { duracion: 4500 });
              } }],
            };
          } },
        { pregunta: 'Prefiero registrarlo con la foto', icono: 'ti-camera', texto: 'En Registro Automático eliges la foto del oficio y yo lleno los datos por ti.', acciones: [{ texto: 'Ir a Registro Automático', icono: 'ti-camera', hacer: ir('/captura-auto') }] },
        { pregunta: '¿Se pierde lo que escribo si cierro?', icono: 'ti-device-floppy', texto: 'No: lo que escribes se guarda como borrador en este equipo hasta que registres el oficio o limpies el formulario.' },
        P_LIMPIAR,
      ];
      case 'captura-auto': return [
        { pregunta: '¿Cómo registro un oficio con su foto?', icono: 'ti-photo-scan',
          pasos: ['Toma la foto con tu celular (en «Captura desde celular») o elige una de la lista de pendientes.', 'Espera a que lea los datos.', 'Revisa lo que llené, completa lo que falte y guarda.'] },
        { pregunta: '¿Cómo tomo la foto con mi celular?', icono: 'ti-device-mobile', texto: 'Entra al sistema desde tu celular y abre «Captura desde celular»: ahí tomas la foto y la envías. Luego la verás aquí lista para usar.' },
        { pregunta: 'Prefiero escribirlo a mano', icono: 'ti-pencil', texto: 'En Nuevo Registro llenas los datos tú mismo.', acciones: [{ texto: 'Ir a Nuevo Registro', icono: 'ti-pencil', hacer: ir('/captura') }] },
        { pregunta: 'Una foto no sirve, ¿qué hago?', icono: 'ti-photo-x', texto: 'Puedes descartarla de la lista de pendientes; te pediré confirmación antes. Después toma una nueva con mejor luz.' },
        P_LIMPIAR,
      ];
      case 'captura-movil': return [
        { pregunta: '¿Cómo tomo una buena foto?', icono: 'ti-camera', pasos: ['Pon la hoja sobre una superficie lisa y con buena luz.', 'Que se vea la hoja completa, sin sombras.', 'Revisa la vista previa y toca «Enviar».'] },
        { pregunta: '¿Ya se envió mi foto?', icono: 'ti-history', texto: 'En «Tus fotos recientes» ves cada foto que enviaste y si ya se procesó.', acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: () => guiar('.cm-recientes-titulo', 'Aquí están tus fotos recientes.') }] },
        { pregunta: '¿Dónde termino el registro?', icono: 'ti-device-desktop', texto: 'En la computadora, en «Registro Automático»: ahí eliges tu foto, revisas los datos y guardas.' },
      ];
      case 'circular': case 'no-oficio': case 'tarjeta-informativa': {
        const N = NOMBRE_REGISTRO[pagina];
        return [
          { pregunta: `Quiero registrar un ${N} nuevo`, icono: 'ti-file-plus', pasos: ['Toca el botón «Nuevo».', 'Llena los datos de la ventana.', 'Guarda: se toma el siguiente número consecutivo.'],
            acciones: [{ texto: 'Hazlo ahora', icono: 'ti-file-plus', hacer: () => { if (typeof window.abrirNuevo === 'function') window.abrirNuevo(); } }] },
          ...(pagina === 'no-oficio' ? [{ pregunta: 'Quiero reservar un número para hoy', icono: 'ti-calendar-star', texto: '«Oficio Libre del Día» reserva el siguiente número con la fecha de hoy y lo deja en Oficios Libres para usarlo después.',
            acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: () => guiar('.btn-libre-del-dia', 'Con este botón reservas el número de hoy.') }] }] : []),
          { pregunta: '¿Qué pasa con el número si elimino un registro?', icono: 'ti-recycle', texto: 'El número queda libre y no se reutiliza solo: al registrar uno nuevo puedes elegirlo con «Asignar Anteriores».' },
          P_BUSCAR('acepta asunto, destinatario o solicitante. También puedes filtrar por fechas con «Desde» y «Hasta».'),
        ];
      }
      case 'minutario': return [
        { pregunta: '¿Cómo registro la Fecha de Sello o de Firma?', icono: 'ti-calendar-check', pasos: ['Busca el número en la tabla.', 'Elige la fecha en su columna (Sello o Firma).', 'Se guarda sola; yo te aviso cuando quede guardada.'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: () => guiar('[onchange*="fecha_sello"]', 'Aquí eliges la Fecha de Sello.') }] },
        { pregunta: 'Quiero ver Circulares o Tarjetas', icono: 'ti-switch-horizontal', texto: 'Cambia de tipo con las pestañas de arriba: No. de Oficio, No. Circular o No. Tarjeta Informativa.',
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: () => guiar('.minutario-tab', 'Con estas pestañas cambias de tipo.') }] },
        { pregunta: 'Quiero ver solo un periodo', icono: 'ti-calendar', texto: 'Usa «Desde» y «Hasta»; con «Limpiar» vuelves a ver todo.', acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: () => guiar('#filtro-desde', 'Elige aquí desde qué fecha.') }] },
        P_BUSCAR('acepta número, asunto o solicitante.'),
      ];
      case 'salas': return [
        { pregunta: '¿Cómo aparto una sala?', icono: 'ti-calendar-plus', pasos: ['En «Apartar Sala» elige la sala.', 'Pon la fecha (y «Hasta» si son varios días) y el horario.', 'Indica cuántas personas y el evento, y toca «Apartar sala».'],
          acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: () => guiar('#select-sala', 'Empieza eligiendo la sala.') }] },
        { pregunta: '¿Cómo cancelo o cambio un apartado?', icono: 'ti-calendar-x', texto: 'En «Próximos apartados», en la tarjeta del apartado: el lápiz lo edita y la ✕ lo cancela (te pediré confirmación).' },
        { pregunta: 'Tengo la solicitud en papel', icono: 'ti-camera', texto: 'Tómale foto desde tu celular («Captura desde celular») y aparecerá en «Fotos por procesar»: al elegirla propongo los datos del apartado.' },
        { pregunta: 'Quiero registrar una sala nueva', icono: 'ti-building', texto: 'En el panel para registrar sala escribe su nombre y datos, y toca el botón para registrarla.', acciones: [{ texto: 'Muéstrame', icono: 'ti-hand-finger', hacer: () => guiar('#btn-registrar-sala', 'Con este botón la registras.') }] },
      ];
      default: return [];
    }
  }

  let panel = null;
  function cerrarAyuda() {
    if (!panel) return;
    panel.remove(); panel = null;
    M.despierto(false);
    document.removeEventListener('keydown', teclaAyuda);
    document.removeEventListener('pointerdown', fueraAyuda, true);
  }
  const teclaAyuda = (e) => { if (e.key === 'Escape') cerrarAyuda(); };
  const fueraAyuda = (e) => { if (panel && !panel.contains(e.target) && !M.esquina().contains(e.target)) cerrarAyuda(); };

  function abrirAyuda() {
    if (panel) { cerrarAyuda(); return; }
    const lista = preguntas();
    if (!lista.length) { M.decir(nombre ? `¡Hola, ${nombre}! Aquí estoy para ayudarte.` : '¡Hola! Aquí estoy para ayudarte.'); return; }
    M.callar();
    M.despierto(true);
    panel = document.createElement('div');
    panel.className = 'ms-ayuda';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ayuda');
    document.body.appendChild(panel);
    pintarMenu(lista);
    document.addEventListener('keydown', teclaAyuda);
    document.addEventListener('pointerdown', fueraAyuda, true);
  }

  function pintarMenu(lista = preguntas()) {
    panel.innerHTML = `
      <div class="ms-ayuda-cab">
        <span class="ms-ayuda-saludo">${esc(nombre ? `¡Hola, ${nombre}!` : '¡Hola!')}</span>
        <strong class="ms-ayuda-titulo">¿En qué puedo ayudarte?</strong>
      </div>
      <div class="ms-ayuda-lista">
        ${lista.map((q, i) => `<button type="button" class="ms-ayuda-op" data-i="${i}"><i class="ti ${q.icono || 'ti-help-circle'}" aria-hidden="true"></i><span>${esc(q.pregunta)}</span><i class="ti ti-chevron-right ms-ayuda-flecha" aria-hidden="true"></i></button>`).join('')}
      </div>
      <button type="button" class="ms-ayuda-cerrar">Nada por ahora, gracias</button>`;
    panel.querySelectorAll('.ms-ayuda-op').forEach(b => { b.onclick = () => pintarRespuesta(lista[Number(b.dataset.i)]); });
    panel.querySelector('.ms-ayuda-cerrar').onclick = cerrarAyuda;
    panel.querySelector('.ms-ayuda-op')?.focus();
  }

  async function pintarRespuesta(q) {
    panel.innerHTML = `
      <div class="ms-ayuda-cab ms-ayuda-cab-resp">
        <button type="button" class="ms-ayuda-volver" aria-label="Volver a las preguntas"><i class="ti ti-arrow-left"></i></button>
        <strong class="ms-ayuda-titulo">${esc(q.pregunta)}</strong>
      </div>
      <div class="ms-ayuda-resp"><p class="ms-ayuda-cargando">Déjame revisar…</p></div>`;
    panel.querySelector('.ms-ayuda-volver').onclick = () => pintarMenu();
    const r = q.cargar ? await q.cargar() : {};
    if (!panel) return;
    const texto = r.texto ?? q.texto, pasos = r.pasos ?? q.pasos, acciones = r.acciones ?? q.acciones ?? [];
    panel.querySelector('.ms-ayuda-resp').innerHTML = `
      ${texto ? `<p>${esc(texto)}</p>` : ''}
      ${pasos ? `<ol class="ms-ayuda-pasos">${pasos.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
      <div class="ms-ayuda-acciones">
        ${acciones.map((a, i) => `<button type="button" class="ms-ayuda-accion" data-i="${i}"><i class="ti ${a.icono || 'ti-arrow-right'}" aria-hidden="true"></i> ${esc(a.texto)}</button>`).join('')}
        <button type="button" class="ms-ayuda-otra">Otra pregunta</button>
      </div>`;
    panel.querySelectorAll('.ms-ayuda-accion').forEach(b => { b.onclick = () => { const a = acciones[Number(b.dataset.i)]; cerrarAyuda(); a.hacer(); }; });
    panel.querySelector('.ms-ayuda-otra').onclick = () => pintarMenu();
    (panel.querySelector('.ms-ayuda-accion') || panel.querySelector('.ms-ayuda-otra')).focus();
  }

  /* ─────────────── Arranque ─────────────── */
  // Antes de que cada página arme sus listas (lo hacen al DOMContentLoaded)
  vigilarBusquedas();
  function iniciar() {
    prepararSalida();
    vigilarVentanas();
    vigilarErrores();
    vigilarArchivos();
    vigilarMinutario();
    vigilarEliminaciones();
    vigilarFotoEnviada();
    // Deja que la página termine de pintarse antes de saludar y de vigilar
    setTimeout(saludar, 1200);
    setTimeout(vigilarNovedades, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
