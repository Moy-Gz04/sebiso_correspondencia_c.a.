/* ═══════════════════════════════════════════════════
   SBIS — Formulario de Captura (Admin)
   Solo captura Datos del Oficio + Descripción.
   El oficio se crea en estatus "por_turnar".
   ═══════════════════════════════════════════════════ */

const API = window.location.origin + '/api';

let TOKEN   = localStorage.getItem('sbis_token');
let USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');

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
  window.location.href = '/login.html';
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
  preRellenar();
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

    /* Modal de confirmación de éxito → al cerrar va a historial */
    const yaFueTurnado = !!data.turnado_a;
    await sbisAlert({
      titulo:  `Oficio N° ${data.n_control} registrado`,
      mensaje: yaFueTurnado
        ? `El oficio quedó turnado directamente a ${data.turnado_a}.`
        : 'El oficio quedó en estatus "Por Turnar". Recuerda asignarlo a un área desde el Historial.',
      tipo:    'success',
      btnOk:   'Ver Historial',
      onClose: () => { window.location.href = 'historial.html'; }
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
  if (!TOKEN || (USUARIO?.rol !== 'admin' && USUARIO?.rol !== 'area')) {
    window.location.href = '/login.html';
    return;
  }
  const navBandeja = document.getElementById('nav-bandeja');
  if (navBandeja && USUARIO?.rol === 'area') navBandeja.style.display = '';

  inyectarModales();
  pintarUsuarioHeader(USUARIO?.username || '');
  mostrarFecha();
  preRellenar();

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