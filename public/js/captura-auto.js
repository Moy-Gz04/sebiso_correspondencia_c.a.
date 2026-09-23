/* ═══════════════════════════════════════════════════
   SBIS — Registro Automático (clon de captura.js)
   Mismo formulario que "Nuevo Registro", más un panel de "Registros
   pendientes": fotos tomadas desde /captura-movil, procesadas con
   Gemini Vision en el servidor (ver POST /api/oficios/pendientes en
   server.js). Al seleccionar una ya "lista", los campos del formulario
   se rellenan solos con lo que la IA leyó — la persona solo revisa y
   completa lo que falte. El N. Control se sigue asignando igual que
   siempre, únicamente al guardar (POST /api/oficios sin cambios).

   Acceso: exclusivo de Coordinación Administrativa (o el admin
   legado) — mismo permiso que Nuevo Registro.
   ═══════════════════════════════════════════════════ */

const API = window.location.origin + '/api';

let TOKEN   = localStorage.getItem('sbis_token');
let USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');

const AREA_CON_GESTION_COMPLETA = 'Coordinación Administrativa';
function tieneGestionCompleta(usuario) {
  return usuario?.rol === 'admin' ||
    (usuario?.rol === 'area' && usuario?.area === AREA_CON_GESTION_COMPLETA);
}

/* Revalida sesión y permisos leyendo siempre el localStorage más
   reciente (no una copia vieja en memoria). Se usa tanto en la carga
   normal de la página como al restaurarla con el botón Atrás/Adelante
   del navegador (ver el listener de "pageshow" al final del archivo).
   Devuelve true si el acceso es válido; si no, ya redirigió y hay que
   detener cualquier otra inicialización. */
function verificarAcceso() {
  TOKEN   = localStorage.getItem('sbis_token');
  USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');

  if (!TOKEN || (USUARIO?.rol !== 'admin' && USUARIO?.rol !== 'area')) {
    window.location.href = '/login';
    return false;
  }

  /* Nuevo Registro es exclusivo de Coordinación Administrativa (y del
     admin legado). Cualquier otra área que entre directo por URL es
     redirigida a su Bandeja de Oficios: no tiene permiso para crear. */
  if (!tieneGestionCompleta(USUARIO)) {
    window.location.href = '/area';
    return false;
  }

  return true;
}

/* ── Usuarios Activos: heartbeat (ver nota en area.js) ── */
function iniciarHeartbeat() {
  const ping = () => fetch(`${API}/heartbeat`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  }).catch(() => {});
  ping();
  setInterval(ping, 60000);
}

/* ── Usuarios Activos: badge discreto en el header con panel al pasar
   el cursor ──
   Se inyecta una sola vez el CSS del panel (inyectarEstilosUsuariosActivos)
   y luego, cada vez que se actualiza el contador, se repinta la lista
   de usuario + área/rol dentro del panel. El panel se muestra por CSS
   (:hover / :focus-within), sin depender del title nativo del navegador. */
function inyectarEstilosUsuariosActivos() {
  if (document.getElementById('estilos-usuarios-activos')) return;
  const style = document.createElement('style');
  style.id = 'estilos-usuarios-activos';
  style.textContent = `
    .badge-usuarios-activos {
      position: relative;
      display: flex; align-items: center; gap: 5px;
      color: #6b6b6b; font-size: 12.5px; font-weight: 600;
      font-family: 'Montserrat', sans-serif; white-space: nowrap;
      cursor: default; padding: 3px 6px; border-radius: 6px;
      transition: background .15s;
    }
    .badge-usuarios-activos:hover,
    .badge-usuarios-activos:focus-within { background: #f4eef0; }
    .badge-usuarios-activos:hover .panel-usuarios-activos,
    .badge-usuarios-activos:focus-within .panel-usuarios-activos {
      opacity: 1; visibility: visible; transform: translateY(0);
    }
    .panel-usuarios-activos {
      position: absolute; top: calc(100% + 8px); right: 0;
      min-width: 220px; max-width: 280px;
      background: #fff; border: 1px solid #e6dde1; border-radius: 10px;
      box-shadow: 0 10px 26px rgba(0,0,0,.14);
      padding: 10px 12px; z-index: 20000;
      opacity: 0; visibility: hidden; transform: translateY(-4px);
      transition: opacity .15s ease, transform .15s ease, visibility .15s;
      text-align: left; white-space: normal; cursor: default;
    }
    .panel-usuarios-activos-titulo {
      font-size: 10.5px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .5px; color: #999; margin-bottom: 7px;
    }
    .panel-usuarios-activos-lista {
      display: flex; flex-direction: column; gap: 6px;
      max-height: 190px; overflow-y: auto;
    }
    .panel-usuarios-activos-fila {
      display: flex; align-items: center; gap: 7px;
      font-size: 12px; color: #333;
    }
    .panel-usuarios-activos-nombre {
      font-weight: 600; color: #222;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .panel-usuarios-activos-area {
      color: #918a8d; font-size: 10.5px; margin-left: auto;
      text-align: right; flex-shrink: 0; max-width: 120px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .punto-activo {
      width: 6px; height: 6px; border-radius: 50%;
      background: #2e7d32; flex-shrink: 0;
    }
    .chip-sesiones {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 16px; height: 16px; padding: 0 4px;
      border-radius: 999px; background: #fff3e0; color: #b45309;
      border: 1px solid #f3d9a8; font-size: 9.5px; font-weight: 700;
      flex-shrink: 0; cursor: help;
    }
    .panel-usuarios-activos-vacio { font-size: 12px; color: #999; font-style: italic; }
  `;
  document.head.appendChild(style);
}

function pintarPanelUsuariosActivos(usuarios) {
  const listaEl = document.getElementById('lista-usuarios-activos');
  if (!listaEl) return;
  listaEl.innerHTML = usuarios.length
    ? usuarios.map(u => `
        <div class="panel-usuarios-activos-fila">
          <span class="punto-activo"></span>
          <span class="panel-usuarios-activos-nombre">${u.username}</span>
          ${u.sesiones > 1 ? `<span class="chip-sesiones" title="Esta cuenta tiene ${u.sesiones} sesiones activas al mismo tiempo (posiblemente en distintos dispositivos)">×${u.sesiones}</span>` : ''}
          <span class="panel-usuarios-activos-area">${u.area || (u.rol === 'admin' ? 'Administración' : u.rol)}</span>
        </div>`).join('')
    : '<span class="panel-usuarios-activos-vacio">Sin usuarios activos en este momento</span>';
}

function iniciarContadorUsuariosActivos() {
  inyectarEstilosUsuariosActivos();

  const badge = document.createElement('div');
  badge.id = 'badge-usuarios-activos';
  badge.className = 'badge-usuarios-activos';
  badge.tabIndex = 0;
  badge.innerHTML = `
    <span style="position:relative; display:inline-flex;">
      <i class="ti ti-users" style="font-size:17px; line-height:1;"></i>
      <span style="position:absolute; bottom:-1px; right:-2px; width:7px; height:7px;
                   background:#2e7d32; border:1.5px solid #fff; border-radius:50%;"></span>
    </span>
    <span id="txt-usuarios-activos">—</span>
    <div class="panel-usuarios-activos">
      <div class="panel-usuarios-activos-titulo">Usuarios activos</div>
      <div class="panel-usuarios-activos-lista" id="lista-usuarios-activos">
        <span class="panel-usuarios-activos-vacio">Cargando…</span>
      </div>
    </div>`;

  const headerDerecha = document.querySelector('.header-derecha');
  if (headerDerecha) headerDerecha.prepend(badge);

  const actualizar = async () => {
    try {
      const res  = await fetch(`${API}/usuarios-activos`, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
      const data = await res.json();
      const txt  = document.getElementById('txt-usuarios-activos');
      if (txt) txt.textContent = data.total;
      pintarPanelUsuariosActivos(data.usuarios || []);
    } catch { /* silencioso */ }
  };

  actualizar();
  setInterval(actualizar, 30000);
}

/* ════════════════════════════════════════════════════
   SISTEMA DE MODALES (mismo que app.js) — tipografía
   institucional Montserrat en todas las ventanas emergentes.
   ════════════════════════════════════════════════════ */
function inyectarModales() {
  if (document.getElementById('sbis-modal-root')) return;
  const div = document.createElement('div');
  div.id = 'sbis-modal-root';
  div.innerHTML = `
    <style>
      .sbis-overlay {
        display: none; position: fixed; inset: 0;
        background: rgba(0,0,0,0.48);
        backdrop-filter: blur(2px);
        z-index: 10000;
        align-items: center; justify-content: center; padding: 20px;
      }
      .sbis-overlay.visible { display: flex; }
      .sbis-modal {
        background: #fff; border-radius: 14px;
        width: 100%; max-width: 400px;
        font-family: 'Montserrat', sans-serif;
        overflow: hidden; animation: sbisSlide .22s cubic-bezier(.22,1,.36,1);
      }
      @keyframes sbisSlide {
        from { transform: translateY(-18px) scale(.97); opacity: 0; }
        to   { transform: translateY(0)     scale(1);   opacity: 1; }
      }
      .sbis-modal-icon {
        display: flex; align-items: center; justify-content: center;
        padding: 28px 0 16px;
      }
      .sbis-modal-icon .ico-circle {
        width: 58px; height: 58px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; font-size: 26px;
        box-shadow: 0 4px 12px rgba(0,0,0,.12);
      }
      .ico-confirm  { background: #fff3e0; color: #e65100; }
      .ico-success  { background: #e8f5e9; color: #2e7d32; }
      .ico-error    { background: #fce4ec; color: #c62828; }
      .ico-info     { background: #e3f2fd; color: #1565c0; }
      .ico-warning  { background: #fff8e1; color: #f57f17; }
      .sbis-modal-body { padding: 0 28px 20px; text-align: center; }
      .sbis-modal-title {
        font-family: 'Montserrat', sans-serif; font-size: 1.35rem;
        font-weight: 700; color: #1a1a1a; margin: 0 0 8px;
      }
      .sbis-modal-msg { font-size: 0.92rem; color: #555; line-height: 1.5; margin: 0; }
      .sbis-modal-btns { padding: 0 20px 22px; display: flex; gap: 10px; justify-content: center; }
      .sbis-btn {
        padding: 10px 26px; border-radius: 999px; font-size: 13.5px; font-weight: 600;
        font-family: 'Montserrat', sans-serif; cursor: pointer; border: none;
        display: inline-flex; align-items: center; gap: 7px;
        transition: background .18s, transform .1s;
      }
      .sbis-btn:active { transform: scale(.97); }
      .sbis-btn-primary   { background: #6B0F2B; color: #fff; }
      .sbis-btn-primary:hover { background: #8B1535; }
      .sbis-btn-danger    { background: #c62828; color: #fff; }
      .sbis-btn-danger:hover  { background: #b71c1c; }
      .sbis-btn-secondary { background: #eeeeee; color: #333; }
      .sbis-btn-secondary:hover { background: #e0e0e0; }
      .sbis-btn-success   { background: #2e7d32; color: #fff; }
      .sbis-btn-success:hover { background: #1b5e20; }
    </style>
    <div class="sbis-overlay" id="sbis-overlay">
      <div class="sbis-modal" id="sbis-modal">
        <div class="sbis-modal-icon">
          <div class="ico-circle" id="sbis-ico-circle">
            <i id="sbis-ico" class="ti ti-alert-triangle"></i>
          </div>
        </div>
        <div class="sbis-modal-body">
          <p class="sbis-modal-title" id="sbis-title">Título</p>
          <p class="sbis-modal-msg"   id="sbis-msg">Mensaje</p>
        </div>
        <div class="sbis-modal-btns" id="sbis-btns"></div>
      </div>
    </div>`;
  document.body.appendChild(div);
}

function sbisAlert({ titulo = 'Aviso', mensaje = '', btnOk = 'Aceptar', tipo = 'info', onClose = null } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('sbis-overlay');
    document.getElementById('sbis-title').textContent = titulo;
    document.getElementById('sbis-msg').textContent   = mensaje;
    const MAP = {
      success: ['ico-success', 'ti-circle-check',  'sbis-btn-success'],
      error:   ['ico-error',   'ti-alert-circle',  'sbis-btn-danger'],
      warning: ['ico-warning', 'ti-alert-triangle','sbis-btn-primary'],
      info:    ['ico-info',    'ti-info-circle',   'sbis-btn-primary'],
    };
    const [cls, icoName, btnCls] = MAP[tipo] || MAP.info;
    document.getElementById('sbis-ico-circle').className = `ico-circle ${cls}`;
    document.getElementById('sbis-ico').className        = `ti ${icoName}`;
    document.getElementById('sbis-btns').innerHTML = `
      <button class="sbis-btn ${btnCls}" id="sbis-ok">
        <i class="ti ti-check"></i> ${btnOk}
      </button>`;
    overlay.classList.add('visible');
    const cerrar = () => {
      overlay.classList.remove('visible');
      if (onClose) onClose();
      resolve();
    };
    document.getElementById('sbis-ok').onclick = cerrar;
    overlay.onclick = e => { if (e.target === overlay) cerrar(); };
  });
}

function sbisConfirm({ titulo = '¿Estás seguro?', mensaje = '', btnOk = 'Aceptar', btnCancel = 'Cancelar', tipo = 'confirm' } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('sbis-overlay');
    document.getElementById('sbis-title').textContent = titulo;
    document.getElementById('sbis-msg').textContent   = mensaje;
    const circle = document.getElementById('sbis-ico-circle');
    const ico    = document.getElementById('sbis-ico');
    circle.className = `ico-circle ${tipo === 'danger' ? 'ico-error' : 'ico-warning'}`;
    ico.className    = `ti ${tipo === 'danger' ? 'ti-trash' : 'ti-alert-triangle'}`;
    document.getElementById('sbis-btns').innerHTML = `
      <button class="sbis-btn sbis-btn-secondary" id="sbis-cancel">
        <i class="ti ti-x"></i> ${btnCancel}
      </button>
      <button class="sbis-btn ${tipo === 'danger' ? 'sbis-btn-danger' : 'sbis-btn-primary'}" id="sbis-ok">
        <i class="ti ${tipo === 'danger' ? 'ti-trash' : 'ti-check'}"></i> ${btnOk}
      </button>`;
    overlay.classList.add('visible');
    const cerrar = (val) => { overlay.classList.remove('visible'); resolve(val); };
    document.getElementById('sbis-ok').onclick     = () => cerrar(true);
    document.getElementById('sbis-cancel').onclick = () => cerrar(false);
    overlay.onclick = e => { if (e.target === overlay) cerrar(false); };
  });
}

/* ════════════════════════════════════════════════════
   LÓGICA DEL FORMULARIO
   ════════════════════════════════════════════════════ */
function cerrarSesion() {
  localStorage.removeItem('sbis_token');
  localStorage.removeItem('sbis_usuario');
  window.location.href = '/login';
}

/* Icono elegante en vez de emoji para el usuario del header */
function pintarUsuarioHeader(username) {
  const elUser = document.getElementById('header-usuario');
  if (!elUser) return;
  elUser.innerHTML = `<span class="ico-usuario"><i class="ti ti-user-circle"></i></span><span>${username}</span>`;
}

function mostrarFecha() {
  const el = document.getElementById('header-fecha');
  if (!el) return;
  const txt = new Date().toLocaleDateString('es-MX',
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  el.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
}

function preRellenar() {
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('f_registro').value = hoy;
}

/* Desplegable (datalist) de "Remitente": mismo catálogo curado y fijo
   de personas usado en No. de Oficio. Sigue permitiendo escribir un
   remitente nuevo que no esté en la lista. */
const CATALOGO_REMITENTE = [
  'Ana Karen Ceron Martínez, Coordinador Territorial del Polígono 6 Pachuca de la DGSP',
  'Arq. Analy Meneses Meneses, Encargada de la Administración del Edificio Casa del Pueblo',
  'Edgar Orlando Ángeles Pérez, Oficial Mayor del Poder Ejecutivo del Estado de Hidalgo',
  'Erik Guzmán Hernández, Director General de Desarrollo Institucional de la Secretaría del Despacho',
  'I.F. Ariana Salas Lugo, Directora de Recursos Financieros',
  'Ing. David Robles Hernández, Subsecretario de Desarrollo Social y Humano',
  'Ing. Juan Angel Aguilar Mendoza, Encargado de la Subdirección de Informática y Sistemas',
  'Israel Guarnero Rico, Secretario General del Comité Ejecutivo Interino del SUTSPEEH',
  'Ixchel Hernández Hernández',
  'José Augusto Olvera Esparza, Subsecretario de Programación y Presupuesto del Gasto de Inversión',
  'José Horacio Fuentes Islas, Director General de Giras de la Secretaría del Despacho',
  'L.D. Luis Enrique López Farias, Titular del OIC',
  'L.D. Luis Enrrique López Farias, Titular del Órgano Interno de Control en la SEBISO',
  'L.A.P. Jorge Miguel García Vázquez, Director General de los Servidores del Pueblo',
  'L.A. Fabian Ordóñez Cruz, Director General de Recursos Materiales de la Oficialía Mayor',
  'L.A.E. Lizeth Vidal Cano, Directora de Recursos Humanos',
  'L.A.P. José Luis González Martínez, Director de Logística y Operación de la Dirección General de los Servidores del Pueblo',
  'L.A.P. Luz María Luque Gómez, Subdirectora de Integración y Control de Información',
  'L.C. Iris Vianney Hernández Hernández, Subsecretaria de Egresos de la SH',
  'L.C. Irma Iliana Hidalgo Lugo, Directora General de Recursos Humanos de la OM',
  'L.C. y M.P.P. Yolanda Ferreira Martínez, Secretaria del Comité de Adquisiciones, Arrendamientos y Servicios',
  'L.D. Luis Ricardo Olvera Molina, Director General del Instituto Hidalguense de la Juventud (IHJ)',
  'L.D. Manuel Alejandro Hernández Rivera, Líder de Proyecto del Programa Subsidio a Verificentros',
  'Lic. Marlen Elva Arista Amador, Directora de Gestión Institucional de la SEBISO',
  'Lic. Analinn Rivera Deldado, Titular de la Unidad Administrativa de la Secretaría del Despacho',
  'Lic. Areli Maya Monzalvo, Subsecretaria de Participación Social y Fomento Artesanal de la OM',
  'Lic. Ariadna Penélope Apodaca Sinsel, Directora General del IAAMEH',
  'Lic. Guillermo Olivares Reyna, Secretario de Gobierno',
  'Lic. José Antonio Mendoza Mejía, Jefe de Área A',
  'Lic. Karla Soberanes Sierra, Directora General de Prospectiva, Planeación y Evaluación de los Programas Sociales',
  'Lic. Ma. Guadalupe Pineda González, Subdirectora del Centro de Atención Ciudadana',
  'Lic. Manuel Enrique Aranda Montero, Director General de Atención al Migrante',
  'Mtra. Nora Aidhé Luciano Martínez, Directora General de Fomento Artesanal',
  'Lic. Sergio Daniel Barrera Hernández, Director General de Servicios Generales de la OM',
  'Licenciada Anahi Castro García, Coordinadora de Operación Institucional',
  'Luis Fernando García Cruz, Representante del Presidente del Comité de Adquisiciones, Arrendamientos y Servicios',
  'M.E.F. Ricardo Enrique Alviso Contreras, Titular del Sistema para el Desarrollo Integral de la Familia del Estado de Hidalgo',
  'M.I.E.F. Daniela Salinas Rosales, Directora General de Administración de la OM',
  'M.T.I. Edwin Mellado García, Director General de Innovación Gubernamental de la OM',
  'María Andrea Reyes Escudero',
  'Mtra. Diana Reyes Gómez, Subsecretaria de Salud Pública',
  'Mtra. Ana Brisna Cervantes Hidalgo, Enlace del Sistema de Control Interno Institucional',
  'Mtra. Ana Brisna Cervantes Hidalgo, Directora de Control y Seguimiento a Auditorías de la SEBISO',
  'Mtra. Esther Yolanda Castelán Alatorre, Directora de Administración, Finanzas y Planeación',
  'Mtra. Kenia Dayanne Ramírez Barranco, Coordinadora Administrativa de la SADERH',
  'Mtra. María C. Hernández Palafox, Directora General de Compras Públicas de la OM',
  'Mtra. Mariela Benítez Barrera, Directora General de Asistencia, Atención y Protección',
  'Mtra. Rosa Leticia Muñoz Chávez, Coordinadora Administrativa de la SEBISO',
  'Mtro. Alejandro Salinas Ayotitla, Director General de Operación y Logística de Programas',
  'Mtro. Alfonso Hayyim Flores Barrera, Director General de Inclusión para las Personas con Discapacidad',
  'Mtro. Juan Roberto Lazcano Trejo, Subsecretario de Inclusión y Desarrollo',
  'Mtro. Ricardo Gómez Moreno, Titular de la SEBISO',
  'Mtro. Uziel de Jesús Zenil Salinas, Director de Atención Jurídica',
  'Susana Ruiz Reyes',
  'Susana Serrano Camargo',
  'Víctor Hugo Pérez Guati Rojo, Director de Recursos Materiales',
];

function pintarOpcionesRemitente() {
  const dl = document.getElementById('remitente-list');
  if (!dl) return;
  const valores = CATALOGO_REMITENTE.slice().sort((a, b) => a.localeCompare(b, 'es'));
  dl.innerHTML = valores.map(v => `<option value="${v.replace(/"/g, '&quot;')}"></option>`).join('');
}

function onDiasChange() {
  const val  = parseInt(document.getElementById('dias_entrega').value);
  const hint = document.getElementById('dias-hint');
  const sel  = document.getElementById('dias_entrega');
  if (val && val <= 3) {
    if (hint) hint.style.display = 'block';
    sel.style.borderColor = '#c62828';
    sel.style.color       = '#c62828';
  } else {
    if (hint) hint.style.display = 'none';
    sel.style.borderColor = '';
    sel.style.color       = '';
  }
}

/* Solo valida los campos con atributo required (f_oficio y remitente) */
function validarForm(form) {
  let valido = true;
  form.querySelectorAll('[required]').forEach(el => {
    el.classList.remove('invalido');
    if (!el.value.trim()) { el.classList.add('invalido'); valido = false; }
  });
  return valido;
}

function limpiarForm() {
  document.getElementById('form-captura').reset();
  document.querySelectorAll('.invalido').forEach(el => el.classList.remove('invalido'));
  borrarBorrador();
  preRellenar();
  onDiasChange();
  // Limpiar el formulario NO descarta la foto pendiente (por si la
  // persona solo se equivocó y quiere volver a seleccionarla) — solo
  // se quita la marca de "ya se usó esta" en pantalla.
  PENDIENTE_SELECCIONADO_ID = null;
  document.getElementById('pendiente_ia_id').value = '';
  const aviso = document.getElementById('aviso-pendiente-usado');
  if (aviso) aviso.style.display = 'none';
  pintarPendientesIA();
}

async function enviarForm(e) {
  e.preventDefault();
  const form = document.getElementById('form-captura');

  if (!validarForm(form)) {
    await sbisAlert({
      titulo:  'Campos requeridos',
      mensaje: 'F. Oficio y Remitente son obligatorios para guardar el registro.',
      tipo:    'warning',
      btnOk:   'Entendido'
    });
    return;
  }

  const btn = document.getElementById('btn-guardar');
  btn.classList.add('cargando');

  try {
    const fd = new FormData();
    const campos = [
      'f_sello', 'f_oficio', 'dias_entrega', 'numero', 'n_referencia',
      'remitente', 'dependencia', 'instruccion', 'f_registro',
      'folio_despacho', 'descripcion', 'turnado_a'
    ];
    campos.forEach(c => {
      const el = document.getElementById(c);
      if (el) fd.append(c, el.value);
    });

    const res = await fetch(`${API}/oficios`, {
      method:  'POST',
      body:    fd,
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });

    if (res.status === 401) { cerrarSesion(); return; }

    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al guardar');

    /* El registro ya quedó guardado en el servidor: se descarta el
       borrador local para que la próxima captura empiece en blanco. */
    borrarBorrador();

    /* Si el registro se armó a partir de una foto pendiente, esa foto
       ya cumplió su propósito: se descarta de la lista. */
    await limpiarPendienteUsado();

    /* Modal de confirmación de éxito → al cerrar va a historial */
    const yaFueTurnado = !!data.turnado_a;
    await sbisAlert({
      titulo:  `Oficio N° ${data.n_control} registrado`,
      mensaje: yaFueTurnado
        ? `El oficio quedó turnado directamente a ${data.turnado_a}.`
        : 'El oficio quedó en estatus "Por Turnar". Recuerda asignarlo a un área desde el Historial.',
      tipo:    'success',
      btnOk:   'Ver Historial',
      onClose: () => { window.location.href = '/historial'; }
    });

  } catch (err) {
    await sbisAlert({
      titulo:  'Error al guardar',
      mensaje: err.message || 'No se pudo conectar con el servidor.',
      tipo:    'error',
      btnOk:   'Cerrar'
    });
  } finally {
    btn.classList.remove('cargando');
  }
}

async function confirmarLimpiar() {
  const ok = await sbisConfirm({
    titulo:  'Limpiar formulario',
    mensaje: '¿Deseas borrar todos los datos ingresados?',
    btnOk:   'Limpiar',
    tipo:    'confirm'
  });
  if (ok) limpiarForm();
}

document.addEventListener('DOMContentLoaded', () => {
  if (!verificarAcceso()) return;

  const navBandeja = document.getElementById('nav-bandeja');
  if (navBandeja && USUARIO?.rol === 'area') navBandeja.style.display = '';

  inyectarModales();
  pintarUsuarioHeader(USUARIO?.username || '');
  mostrarFecha();
  preRellenar();
  pintarOpcionesRemitente();
  /* Recupera lo que se estuviera capturando antes de salir de la
     página (ver bloque "BORRADOR AUTOMÁTICO" al final del archivo).
     Va después de preRellenar() para no pisar F. Registro. */
  restaurarBorrador();
  activarAutoguardadoBorrador();
  iniciarHeartbeat();
  iniciarContadorUsuariosActivos();

  document.getElementById('dias_entrega').addEventListener('change', onDiasChange);
  document.getElementById('btn-limpiar').addEventListener('click', confirmarLimpiar);
  document.getElementById('form-captura').addEventListener('submit', enviarForm);

  // Auto-copiar "# Número de Oficio" → "N. Referencia" mientras se escribe.
  // Deja de copiar en automático en cuanto el usuario edita N. Referencia
  // a mano (para no pisarle un valor distinto que haya puesto a propósito).
  sincronizarNumeroConReferencia();

  // No tiene sentido turnarse un oficio a uno mismo
  if (USUARIO?.rol === 'area' && USUARIO?.area) {
    const sel = document.getElementById('turnado_a');
    const opt = sel?.querySelector(`option[value="${CSS.escape(USUARIO.area)}"]`);
    if (opt) opt.remove();
  }
});

/* ── Romper el acceso vía botón "Atrás" tras cerrar sesión ──
   Si el navegador restaura este formulario desde su caché en memoria
   (bfcache) al usar Atrás/Adelante, se revalida el token guardado
   antes de dejarlo visible. Si ya no hay sesión válida, se redirige
   de inmediato a login. */
window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) {
    verificarAcceso();
  }
});

function sincronizarNumeroConReferencia() {
  const numero      = document.getElementById('numero');
  const nReferencia = document.getElementById('n_referencia');
  if (!numero || !nReferencia) return;

  let ultimoValorSincronizado = '';

  numero.addEventListener('input', () => {
    // Solo actualiza automáticamente si N. Referencia está vacío o si su
    // valor actual es el que nosotros mismos pusimos la última vez
    // (así no se pisa un valor que el usuario haya escrito a propósito).
    if (nReferencia.value === '' || nReferencia.value === ultimoValorSincronizado) {
      nReferencia.value = numero.value;
      ultimoValorSincronizado = numero.value;
    }
  });
}

/* ════════════════════════════════════════════════════
   BORRADOR AUTOMÁTICO — "memoria" del Nuevo Registro
   Mientras se captura, lo escrito se guarda en localStorage.
   Si el usuario cambia de página (p. ej. entra a Historial)
   y vuelve a Nuevo Registro, el formulario se restaura tal
   como lo dejó. El borrador se descarta al guardar el
   registro con éxito o al pulsar "Limpiar".

   No se recuerdan n_control ni f_registro: los pone el
   sistema, no el usuario. Tampoco se recuerda "instruccion": es un
   campo que se llena a mano para CADA oficio en particular, así que
   no debe arrastrarse de una captura a la siguiente — se limpia solo
   al guardar (enviarForm) y nunca se restaura de un borrador viejo.
   ════════════════════════════════════════════════════ */
const CAMPOS_BORRADOR = [
  'f_oficio', 'f_sello', 'dias_entrega', 'numero', 'n_referencia',
  'remitente', 'dependencia', 'folio_despacho',
  'descripcion', 'turnado_a'
];

/* Clave por usuario: si dos cuentas usan el mismo navegador, cada
   una recupera su propio borrador y no el de la otra. */
function claveBorrador() {
  const quien = (USUARIO?.username || 'anon').trim().toLowerCase();
  return `sbis_borrador_captura_${quien}`;
}

function guardarBorrador() {
  const datos = {};
  CAMPOS_BORRADOR.forEach(id => {
    const el = document.getElementById(id);
    if (el) datos[id] = el.value;
  });
  try {
    localStorage.setItem(claveBorrador(), JSON.stringify({ datos, ts: Date.now() }));
  } catch { /* almacenamiento no disponible o lleno: se ignora */ }
}

function restaurarBorrador() {
  let guardado = null;
  try {
    guardado = JSON.parse(localStorage.getItem(claveBorrador()) || 'null');
  } catch { guardado = null; }
  if (!guardado || !guardado.datos) return;

  // Se filtra por CAMPOS_BORRADOR (y no solo por si el <input> existe)
  // para que un borrador viejo guardado con una lista de campos
  // distinta —p. ej. de antes de quitar "instruccion" de aquí— no
  // restaure algo que ya no debería recordarse.
  Object.entries(guardado.datos).forEach(([id, valor]) => {
    if (!CAMPOS_BORRADOR.includes(id)) return;
    const el = document.getElementById(id);
    if (el && valor != null && valor !== '') el.value = valor;
  });
  // Reaplica el aviso "🔴 Urgente" según los días restaurados.
  onDiasChange();
}

function borrarBorrador() {
  try { localStorage.removeItem(claveBorrador()); } catch { /* nada */ }
}

function activarAutoguardadoBorrador() {
  const form = document.getElementById('form-captura');
  if (!form) return;
  // 'input' cubre inputs de texto y el textarea; 'change' cubre los
  // <select> y los campos de fecha. Ambos se delegan en el <form>.
  form.addEventListener('input',  guardarBorrador);
  form.addEventListener('change', guardarBorrador);
}

/* ════════════════════════════════════════════════════
   REGISTROS PENDIENTES (IA) — fotos capturadas desde el celular
   ════════════════════════════════════════════════════ */
let PENDIENTES_IA = [];
let PENDIENTE_SELECCIONADO_ID = null;
let TIMER_POLL_PENDIENTES = null;

/* Trae la lista de pendientes y repinta el panel. Se llama al cargar
   la página y luego cada 6s (mientras la página siga abierta) para
   que "procesando" pase a "listo" solo, sin que la persona tenga que
   refrescar. El polling se detiene si no hay ninguno "procesando" en
   este momento, y se reactiva en cuanto aparece uno nuevo (subida
   desde el celular) — así no se hacen peticiones de más todo el rato. */
async function cargarPendientesIA() {
  try {
    const res = await fetch(`${API}/oficios/pendientes`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { cerrarSesion(); return; }
    if (!res.ok) return;
    PENDIENTES_IA = await res.json();
    pintarPendientesIA();

    const hayProcesando = PENDIENTES_IA.some(p => p.estado === 'procesando');
    if (hayProcesando && !TIMER_POLL_PENDIENTES) {
      TIMER_POLL_PENDIENTES = setInterval(cargarPendientesIA, 6000);
    } else if (!hayProcesando && TIMER_POLL_PENDIENTES) {
      clearInterval(TIMER_POLL_PENDIENTES);
      TIMER_POLL_PENDIENTES = null;
    }
  } catch { /* red caída: se reintenta en el próximo poll o al recargar */ }
}

function tiempoRelativo(fechaISO) {
  const seg = Math.round((Date.now() - new Date(fechaISO).getTime()) / 1000);
  if (seg < 60) return 'hace un momento';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return `hace ${h} h`;
}

/* Las URLs de imagen son tokens de un solo propósito (ver
   /imagen-token en server.js) — se piden una vez por id y se guardan
   aquí, porque un <img src> no puede mandar el header Authorization
   y por eso no se puede usar directo el endpoint autenticado normal. */
const URLS_IMAGEN_PENDIENTE = {};

async function obtenerUrlImagenPendiente(id) {
  if (URLS_IMAGEN_PENDIENTE[id]) return URLS_IMAGEN_PENDIENTE[id];
  try {
    const res = await fetch(`${API}/oficios/pendientes/${id}/imagen-token`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (!res.ok) return '';
    const data = await res.json();
    URLS_IMAGEN_PENDIENTE[id] = data.url;
    return data.url;
  } catch {
    return '';
  }
}

/* Vista previa grande al pasar el cursor sobre una miniatura. */
function mostrarPreviewImagen(url) {
  const cont = document.getElementById('preview-imagen-flotante');
  const img  = document.getElementById('preview-imagen-flotante-img');
  if (!cont || !img) return;
  img.src = url;
  cont.classList.add('visible');
}

function ocultarPreviewImagen() {
  document.getElementById('preview-imagen-flotante')?.classList.remove('visible');
}

async function pintarPendientesIA() {
  const cont = document.getElementById('pendientes-ia-lista');
  if (!cont) return;
  // Si la lista se vuelve a pintar (p. ej. por el polling) mientras el
  // cursor está sobre una miniatura, el <img> viejo desaparece sin
  // disparar mouseleave y la vista previa se quedaría pegada en pantalla.
  ocultarPreviewImagen();

  if (!PENDIENTES_IA.length) {
    cont.innerHTML = '<p class="pendientes-ia-vacio">Todavía no hay fotos pendientes. Tómala desde tu celular con "Abrir captura desde celular".</p>';
    return;
  }

  // Se piden todos los tokens de imagen en paralelo antes de pintar,
  // así no hay parpadeo de "imagen rota" mientras llegan uno por uno.
  const urls = await Promise.all(PENDIENTES_IA.map(p => obtenerUrlImagenPendiente(p.id)));

  cont.innerHTML = PENDIENTES_IA.map((p, i) => {
    const seleccionada = p.id === PENDIENTE_SELECCIONADO_ID ? 'seleccionada' : '';
    const clicable = p.estado === 'listo' ? `onclick="seleccionarPendiente(${p.id})"` : '';

    let overlay = '';
    let badge = '';
    if (p.estado === 'procesando') {
      overlay = '<div class="tpi-overlay spin"><i class="ti ti-loader-2"></i></div>';
      badge = '<span class="tpi-badge b-procesando">Procesando…</span>';
    } else if (p.estado === 'error') {
      badge = '<span class="tpi-badge b-error">Error — reintentar</span>';
    } else {
      badge = `<span class="tpi-badge b-listo">Listo · ${tiempoRelativo(p.creado_en)}</span>`;
    }

    const btnReintentar = p.estado === 'error'
      ? `<button type="button" class="tpi-reintentar" title="Reintentar" onclick="event.stopPropagation(); reintentarPendiente(${p.id})"><i class="ti ti-refresh"></i></button>`
      : '';

    return `
      <div class="tarjeta-pendiente-ia estado-${p.estado} ${seleccionada}" ${clicable}>
        <button type="button" class="tpi-descartar" title="Descartar" onclick="event.stopPropagation(); descartarPendiente(${p.id})"><i class="ti ti-x"></i></button>
        ${btnReintentar}
        <img class="tpi-thumb" src="${urls[i]}" loading="lazy" alt="Foto del oficio"
             onmouseenter="mostrarPreviewImagen('${urls[i]}')" onmouseleave="ocultarPreviewImagen()"/>
        ${overlay}
        ${badge}
      </div>`;
  }).join('');
}

/* Rellena el formulario con lo que Gemini extrajo de la foto. Los
   campos que la IA no pudo leer (cadena vacía) se dejan tal cual
   están — así, si la persona ya había escrito algo a mano antes de
   seleccionar la foto, no se lo borra. Días de Entrega, F. Sello si no
   vino, Folio Despacho y Turnar a NO los toca la IA a propósito: son
   decisiones/datos que le tocan a la persona. */
function seleccionarPendiente(id) {
  const p = PENDIENTES_IA.find(x => x.id === id);
  if (!p || p.estado !== 'listo' || !p.datos_json) return;

  const datos = p.datos_json;
  // "instruccion" queda fuera a propósito: es un campo que llena la
  // persona a mano, la IA nunca lo debe tocar.
  const camposIA = ['f_oficio', 'f_sello', 'numero', 'remitente', 'dependencia', 'descripcion'];
  camposIA.forEach(campo => {
    const valor = datos[campo];
    if (!valor) return;
    const el = document.getElementById(campo);
    if (el) el.value = valor;
  });

  // N. Referencia siempre es igual a Número de Oficio — se copia
  // directo aquí en vez de pedírselo a la IA por separado.
  const numeroEl = document.getElementById('numero');
  const referenciaEl = document.getElementById('n_referencia');
  if (numeroEl?.value && referenciaEl) referenciaEl.value = numeroEl.value;

  PENDIENTE_SELECCIONADO_ID = id;
  document.getElementById('pendiente_ia_id').value = id;
  document.getElementById('aviso-pendiente-usado').style.display = 'flex';
  pintarPendientesIA();

  document.getElementById('titulo-panel-apartar')?.scrollIntoView?.({ behavior: 'smooth' });
  document.querySelector('.card-captura-unica')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function reintentarPendiente(id) {
  try {
    await fetch(`${API}/oficios/pendientes/${id}/reintentar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    await cargarPendientesIA();
  } catch { /* se puede reintentar de nuevo manualmente */ }
}

async function descartarPendiente(id) {
  const ok = await sbisConfirm({
    titulo: '¿Descartar esta foto?',
    mensaje: 'Ya no aparecerá en la lista de pendientes.',
    btnOk: 'Descartar',
    tipo: 'danger',
  });
  if (!ok) return;

  try {
    await fetch(`${API}/oficios/pendientes/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    if (PENDIENTE_SELECCIONADO_ID === id) {
      PENDIENTE_SELECCIONADO_ID = null;
      document.getElementById('pendiente_ia_id').value = '';
      document.getElementById('aviso-pendiente-usado').style.display = 'none';
    }
    await cargarPendientesIA();
  } catch { /* si falla, se puede reintentar descartar manualmente */ }
}

/* Se llama justo después de guardar el registro con éxito: la foto ya
   cumplió su propósito, se quita de la lista de pendientes para que
   no aparezca de nuevo como seleccionable. */
async function limpiarPendienteUsado() {
  const id = document.getElementById('pendiente_ia_id')?.value;
  if (!id) return;
  try {
    await fetch(`${API}/oficios/pendientes/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
  } catch { /* no crítico: si falla, la foto solo se queda visible un rato más */ }
  PENDIENTE_SELECCIONADO_ID = null;
  document.getElementById('pendiente_ia_id').value = '';
  const aviso = document.getElementById('aviso-pendiente-usado');
  if (aviso) aviso.style.display = 'none';
  cargarPendientesIA();
}

document.addEventListener('DOMContentLoaded', () => {
  if (!TOKEN) return; // verificarAcceso() ya redirigió si hacía falta
  cargarPendientesIA();
});
