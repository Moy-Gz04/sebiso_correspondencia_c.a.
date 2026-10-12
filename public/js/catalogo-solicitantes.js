/* ═══════════════════════════════════════════════════
   SBIS — Área solicitante y Solicitante como listas
   En los formularios de No. de Oficio, No. Circular y No. Tarjeta
   Informativa: «Área solicitante» se elige de una lista y
   «Solicitante» muestra solo las personas de esa área (nombres, sin
   apellidos). «Otra área…» / «Otra persona…» permiten escribirlo.

   Las páginas siguen leyendo y escribiendo los campos de siempre
   (#nof-area y #nof-solicitante): aquí solo se ocultan y se manejan
   con las listas, así que no cambia nada de cómo se guarda.
   ═══════════════════════════════════════════════════ */
(function () {
  const CATALOGO = {
    'R. Humanos': ['Abril', 'Lizeth', 'Carlos', 'Vianney Cristina', 'Susana', 'Francisco'],
    'R. Financieros': ['Ariana', 'Martha Patricia', 'Lizbeth', 'María Fernanda', 'Oscar Adrián', 'María Pilar', 'Gabriela Leticia', 'Laura Trinidad'],
    'Seguimiento de Auditorías': ['Ana Brisna', 'Mary Carmen', 'Raúl Uriel', 'Julio Giezi', 'Eirene', 'Juanita'],
    'Informática': ['Juan Ángel', 'Gardemoa', 'Roberto Carlos', 'Sarabi Valentina'],
    'R. Materiales': ['Victor Hugo', 'Perla Aleli', 'Maythe', 'Carlos Rodrigo', 'Cristian Omar', 'Alfonso', 'Sandra Lizbeth', 'Adriana', 'Ana Luisa', 'José Manuel'],
    'Archivo': ['Luz María', 'César Aarón', 'Gabriela', 'Ana', 'María Elena'],
  };
  // Cómo se reconoce cada área en registros escritos a mano («Humanos», «Recursos M.», «RM»…)
  const PATRON = {
    'R. Humanos': /(humanos|^rh$)/,
    'R. Financieros': /(financier|^rf$)/,
    'Seguimiento de Auditorías': /(auditor|audiria)/,
    'Informática': /informatica/,
    'R. Materiales': /(materiales|recursos m\.?$|^rm$)/,
    'Archivo': /archivo/,
  };
  const OTRA = '__otra__';
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function iniciar() {
    const inArea = document.getElementById('nof-area');
    const inSol = document.getElementById('nof-solicitante');
    if (!inArea || !inSol || inArea.dataset.lista) return;
    inArea.dataset.lista = '1';

    const selArea = document.createElement('select');
    selArea.id = 'nof-area-lista';
    selArea.innerHTML = `<option value="">Selecciona el área…</option>` +
      Object.keys(CATALOGO).map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('') +
      `<option value="${OTRA}">Otra área…</option>`;
    const selSol = document.createElement('select');
    selSol.id = 'nof-solicitante-lista';
    inArea.before(selArea);
    inSol.before(selSol);
    inArea.placeholder = 'Escribe el área';
    inSol.placeholder = 'Escribe el nombre';
    const lblArea = inArea.closest('.modal-campo')?.querySelector('label');
    const lblSol = inSol.closest('.modal-campo')?.querySelector('label');
    if (lblArea) lblArea.htmlFor = 'nof-area-lista';
    if (lblSol) lblSol.htmlFor = 'nof-solicitante-lista';

    const mostrar = (input, si) => { input.hidden = !si; input.classList.toggle('campo-otro', si); };

    function llenarSolicitantes(area, valor = '') {
      const personas = CATALOGO[area] || [];
      if (!area) {
        selSol.innerHTML = `<option value="">Primero elige el área</option>`;
        selSol.disabled = true; mostrar(inSol, false); inSol.value = valor; return;
      }
      selSol.disabled = false;
      if (area === OTRA) {   // área escrita a mano: el solicitante también se escribe
        selSol.innerHTML = `<option value="${OTRA}">Escribe el nombre</option>`;
        selSol.value = OTRA; selSol.disabled = true; mostrar(inSol, true); inSol.value = valor; return;
      }
      selSol.innerHTML = `<option value="">Selecciona a la persona…</option>` +
        personas.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('') +
        `<option value="${OTRA}">Otra persona…</option>`;
      const encontrada = personas.find(p => norm(p) === norm(valor) || norm(valor).startsWith(norm(p) + ' '));
      if (encontrada) { selSol.value = encontrada; inSol.value = encontrada; mostrar(inSol, false); }
      else if (valor) { selSol.value = OTRA; inSol.value = valor; mostrar(inSol, true); }
      else { selSol.value = ''; inSol.value = ''; mostrar(inSol, false); }
    }

    // Lee lo que la página dejó en los campos (nuevo = vacío; editar = el registro) y lo refleja en las listas
    function sincronizar() {
      const area = inArea.value.trim(), sol = inSol.value.trim();
      const conocida = Object.keys(PATRON).find(a => PATRON[a].test(norm(area)));
      if (conocida) { selArea.value = conocida; inArea.value = conocida; mostrar(inArea, false); llenarSolicitantes(conocida, sol); }
      else if (area) { selArea.value = OTRA; mostrar(inArea, true); llenarSolicitantes(OTRA, sol); }
      else { selArea.value = ''; mostrar(inArea, false); llenarSolicitantes('', sol); }
    }

    selArea.addEventListener('change', () => {
      if (selArea.value === OTRA) { inArea.value = ''; mostrar(inArea, true); inArea.focus(); llenarSolicitantes(OTRA, ''); }
      else { inArea.value = selArea.value; mostrar(inArea, false); llenarSolicitantes(selArea.value, ''); }
    });
    selSol.addEventListener('change', () => {
      if (selSol.value === OTRA) { inSol.value = ''; mostrar(inSol, true); inSol.focus(); }
      else { inSol.value = selSol.value; mostrar(inSol, false); }
    });

    // Cada vez que se abre el formulario (nuevo o editar), las listas toman los valores de los campos
    const modal = inArea.closest('.modal-overlay, .sbis-overlay, [id^="modal"]') || inArea.closest('form') || document.body;
    let abierto = false;
    const revisar = () => {
      const ahora = modal.classList.contains('visible');   // los formularios se abren agregando .visible
      if (ahora && !abierto) setTimeout(sincronizar, 0);
      abierto = ahora;
    };
    new MutationObserver(revisar).observe(modal, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    sincronizar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
