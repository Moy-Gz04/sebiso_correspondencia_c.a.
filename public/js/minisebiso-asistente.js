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
  const PAGINAS = {
    historial: {
      intro: 'Aquí está el Historial de Oficios: puedes editarlos, turnarlos a un área, pedir correcciones y finalizarlos.',
      tips: [
        'Usa los filtros de arriba (Por Turnar, Turnado, Atendido…) para ver solo lo que te interesa.',
        'En el buscador puedes escribir el número de oficio, el remitente, la dependencia o parte del asunto.',
        'Cuando un área termina de atender un oficio, aparece como Atendido: revísalo y finalízalo.',
        'Si un área debe corregir algo, usa «Solicitar corrección» y explica qué necesita cambiar.',
      ],
    },
    area: {
      intro: 'Esta es la Bandeja de tu área: aquí llegan los oficios que te turnan para asignarlos o atenderlos.',
      tips: [
        'En «Pendientes» están los oficios que acaban de llegar a tu área y aún no asignas.',
        'Con «Turnar Oficio» se lo asignas a alguien de tu área, o a ti mismo si lo vas a atender.',
        'El filtro con contador junto a «Completados» te muestra lo que tienes asignado a ti.',
        'Si un oficio regresó para corregirse, lo verás marcado: atiéndelo de nuevo y reenvíalo.',
        'Puedes buscar por número de oficio, remitente o asunto.',
      ],
    },
    usuario: {
      intro: 'Esta es tu Bandeja personal: aquí están los oficios que te asignaron para atender.',
      tips: [
        'Abre «Atender Oficio», adjunta el documento de Turno y el de Seguimiento, y guarda.',
        'Si un oficio regresó para corregirse, lo verás en su filtro con contador: corrígelo y vuelve a enviarlo.',
        'En «Atendidos» puedes revisar lo que ya entregaste.',
        'Puedes buscar por número de oficio, remitente o asunto.',
      ],
    },
    captura: {
      intro: 'Aquí registras un oficio a mano: llena sus datos y guárdalo para generar su número.',
      tips: [
        'F. Oficio y Remitente son obligatorios; lo demás ayuda a encontrarlo después.',
        'Lo que escribes se guarda como borrador en este equipo, por si cierras la página sin querer.',
        'Si tienes la foto del oficio, prueba Registro Automático: yo leo los datos por ti.',
      ],
    },
    'captura-auto': {
      intro: 'Registro Automático: elige la foto de un oficio y yo leo sus datos para llenar el formulario.',
      tips: [
        'Toma la foto desde tu celular en «Captura desde celular» y aquí la verás lista para usar.',
        'Revisa siempre lo que llené antes de guardar: a veces una letra se lee distinto.',
        'Si una foto no sirve, puedes descartarla de la lista de pendientes.',
      ],
    },
    'captura-movil': {
      intro: 'Toma la foto del oficio con tu celular y envíala; después la terminas de registrar en la computadora.',
      tips: [
        'Coloca la hoja sobre una superficie lisa y con buena luz para que se lea mejor.',
        'Después de enviar puedes tomar otra foto de inmediato.',
        'Abajo verás tus fotos recientes y si ya se procesaron.',
      ],
    },
    circular: {
      intro: 'Aquí llevas el control de los números de Circular: registra uno nuevo o consulta los anteriores.',
      tips: [
        'Con «Nuevo No. Circular» se toma el siguiente número consecutivo.',
        'Si eliminas un registro, su número queda libre y puedes reasignarlo después.',
        'Puedes filtrar por fechas y buscar por asunto, destinatario o solicitante.',
      ],
    },
    'no-oficio': {
      intro: 'Aquí llevas el control de los números de Oficio: registra uno nuevo o reutiliza un número libre.',
      tips: [
        'Con «Nuevo No. de Oficio» se toma el siguiente número consecutivo.',
        '«Oficio Libre del Día» reserva el siguiente número y lo deja disponible en Oficios Libres.',
        'Los números que eliminas quedan en Oficios Libres para reasignarlos con «Asignar Anteriores».',
      ],
    },
    'tarjeta-informativa': {
      intro: 'Aquí llevas el control de los números de Tarjeta Informativa.',
      tips: [
        'Con «Nuevo No. Tarjeta Informativa» se toma el siguiente número consecutivo.',
        'Si eliminas un registro, su número queda libre para reasignarlo después.',
        'Puedes filtrar por fechas y buscar por asunto, destinatario o solicitante.',
      ],
    },
    minutario: {
      intro: 'Este es el Minutario: aquí registras la Fecha de Sello, la Fecha de Firma y notas de cada número.',
      tips: [
        'Cambia entre No. de Oficio, No. Circular y No. Tarjeta Informativa con las pestañas de arriba.',
        'Cada fecha o nota se guarda sola en cuanto la cambias; yo te aviso cuando quede guardada.',
        'Usa «Desde» y «Hasta» para ver solo un periodo.',
      ],
    },
    salas: {
      intro: 'Aquí apartas las salas de juntas y ves los próximos apartados.',
      tips: [
        'Para apartar elige la sala, la fecha y el horario; puedes apartar varios días con «Hasta».',
        'Si tienes la solicitud en papel, tómale foto con el celular y yo propongo los datos.',
        'En «Próximos apartados» ves lo que viene, del más cercano al último.',
      ],
    },
  };
  const info = PAGINAS[pagina];

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

  window.sbisAlert = alerta;
  window.sbisConfirm = confirmar;
  // Los alert() nativos que quedan también los dice él (sin bloquear la página)
  window.alert = (msg) => { alerta({ titulo: 'Revisa esto', mensaje: String(msg ?? ''), tipo: 'warning' }); };

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
      mensajes.push({ texto: `¡${saludoHora()}, ${nombre}! Soy MiniSEBISO y hoy te acompaño en todo lo que hagas.`, duracion: 6000 });
      mensajes.push({ texto: info.intro + ' Tócame cuando quieras un consejo.', duracion: 7500 });
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

  /* Al tocarlo en la esquina: consejos de la página, uno distinto cada vez */
  let consejo = -1;
  M.alTocarEsquina = () => {
    if (!info) { M.decir(nombre ? `¡Hola, ${nombre}! Aquí estoy para ayudarte.` : '¡Hola! Aquí estoy para ayudarte.'); return; }
    consejo = (consejo + 1) % (info.tips.length + 1);
    if (consejo === 0) M.decir(`${info.intro} Tócame otra vez para un consejo.`, { duracion: 7000 });
    else M.decir(`Consejo ${consejo} de ${info.tips.length}: ${info.tips[consejo - 1]}`, { duracion: 7500 });
  };

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
