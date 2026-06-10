/* ═══════════════════════════════════════════════════
   SBIS — Formulario de Captura (Admin)
   ═══════════════════════════════════════════════════ */

const API = 'http://localhost:3000/api';

let TOKEN   = localStorage.getItem('sbis_token');
let USUARIO = JSON.parse(localStorage.getItem('sbis_usuario') || 'null');

/* ════════════════════════════════════════════════════
   SISTEMA DE MODALES (mismo que app.js)
   ════════════════════════════════════════════════════ */
function inyectarModales() {
  if (document.getElementById('sbis-modal-root')) return;
  const div = document.createElement('div');
  div.id = 'sbis-modal-root';
  div.innerHTML = `
    <style>
      .sbis-overlay {
        display: none; position: fixed; inset: 0;
        background: rgba(0,0,0,0.48); z-index: 10000;
        align-items: center; justify-content: center; padding: 20px;
      }
      .sbis-overlay.visible { display: flex; }
      .sbis-modal {
        background: #fff; border-radius: 10px;
        width: 100%; max-width: 400px;
        box-shadow: 0 12px 48px rgba(107,15,43,0.22);
        font-family: 'Source Sans 3', sans-serif;
        overflow: hidden; animation: sbisSlide .18s ease;
      }
      @keyframes sbisSlide {
        from { transform: translateY(-18px); opacity: 0; }
        to   { transform: translateY(0);     opacity: 1; }
      }
      .sbis-modal-icon {
        display: flex; align-items: center; justify-content: center;
        padding: 28px 0 16px;
      }
      .sbis-modal-icon .ico-circle {
        width: 58px; height: 58px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; font-size: 26px;
      }
      .ico-confirm  { background: #fff3e0; color: #e65100; }
      .ico-success  { background: #e8f5e9; color: #2e7d32; }
      .ico-error    { background: #fce4ec; color: #c62828; }
      .ico-info     { background: #e3f2fd; color: #1565c0; }
      .ico-warning  { background: #fff8e1; color: #f57f17; }
      .sbis-modal-body { padding: 0 28px 20px; text-align: center; }
      .sbis-modal-title {
        font-family: 'Crimson Pro', serif; font-size: 1.35rem;
        font-weight: 700; color: #1a1a1a; margin: 0 0 8px;
      }
      .sbis-modal-msg { font-size: 0.92rem; color: #555; line-height: 1.5; margin: 0; }
      .sbis-modal-btns { padding: 0 20px 22px; display: flex; gap: 10px; justify-content: center; }
      .sbis-btn {
        padding: 10px 26px; border-radius: 6px; font-size: 13.5px; font-weight: 600;
        font-family: 'Source Sans 3', sans-serif; cursor: pointer; border: none;
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

function irAHistorial() {
  window.location.href = 'historial.html';
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
  document.getElementById('f_registro').value    = hoy;
  document.getElementById('hora_recibido').value = new Date().toTimeString().slice(0, 5);
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

function initArchivos() {
  ['doc1', 'doc2'].forEach(id => {
    const input = document.getElementById(id);
    const zona  = document.getElementById(`zona-${id}`);
    const txt   = document.getElementById(`txt-${id}`);
    if (!input) return;

    input.addEventListener('change', () => {
      if (input.files.length > 0) {
        txt.textContent = `${input.files[0].name} (${(input.files[0].size / 1024).toFixed(0)} KB)`;
        zona.classList.add('con-archivo');
      } else {
        txt.textContent = 'Seleccionar o arrastrar archivo';
        zona.classList.remove('con-archivo');
      }
    });

    zona.addEventListener('dragover',  e => { e.preventDefault(); zona.classList.add('con-archivo'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('con-archivo'));
    zona.addEventListener('drop', e => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change'));
      }
    });
  });
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
  document.querySelectorAll('.campo-archivo').forEach(z => z.classList.remove('con-archivo'));
  document.querySelectorAll('.archivo-txt').forEach(t => t.textContent = 'Seleccionar o arrastrar archivo');
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
      'folio_despacho', 'turnado_a', 'hora_recibido', 'descripcion'
    ];
    campos.forEach(c => {
      const el = document.getElementById(c);
      if (el) fd.append(c, el.value);
    });

    const doc1 = document.getElementById('doc1');
    const doc2 = document.getElementById('doc2');
    if (doc1.files[0]) fd.append('doc1', doc1.files[0]);
    if (doc2.files[0]) fd.append('doc2', doc2.files[0]);

    const res = await fetch(`${API}/oficios`, {
      method:  'POST',
      body:    fd,
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });

    if (res.status === 401) { cerrarSesion(); return; }

    const data = await res.json();
    if (!res.ok) throw new Error(data.mensaje || 'Error al guardar');

    const area = document.getElementById('turnado_a').value;

    /* Modal de confirmación de éxito → al cerrar va a historial */
    await sbisAlert({
      titulo:  `Oficio N° ${data.n_control} registrado`,
      mensaje: area
        ? `Turnado correctamente a: ${area}`
        : 'Registro guardado sin área asignada.',
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
  if (!TOKEN || USUARIO?.rol !== 'admin') {
    window.location.href = '/login.html';
    return;
  }

  inyectarModales();
  mostrarFecha();
  preRellenar();
  initArchivos();

  document.getElementById('dias_entrega').addEventListener('change', onDiasChange);
  document.getElementById('btn-limpiar').addEventListener('click', confirmarLimpiar);
  document.getElementById('form-captura').addEventListener('submit', enviarForm);
});