/* ════════════════════════════════════════════════════
   DOCUMENTOS EXTRA DE CONTESTACIÓN
   Además del Turno (doc3) y el Seguimiento (doc4), quien atiende un
   oficio puede subir los documentos de contestación que necesite con
   «+ Agregar otro documento». Se usan en area.js y usuario.js (modal
   Atender) y se muestran en las tarjetas de area, usuario e historial.
   Se abren igual que los demás: verDocSeguro(id, 'extra-<id>').
   ════════════════════════════════════════════════════ */
const DocsExtra = (() => {
  let existentes = [];   // docs ya guardados en el oficio
  let quitados = [];     // ids de existentes que el usuario eliminó
  let nuevos = [];       // { key, file } elegidos en este modal
  let oficioId = null;
  let sig = 0;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Tarjetas de solo lectura para la vista del oficio.
     pref = 'doc-admin' (area/usuario) o 'doc-area' (historial). */
  function tarjetas(r, pref = 'doc-admin') {
    return (r?.docs_extra || []).map((d, i) => `
      <div class="${pref}-card" onclick="verDocSeguro(${r.id}, 'extra-${d.id}')">
        <div class="${pref}-icon"><i class="ti ti-file-type-pdf"></i></div>
        <div class="${pref}-info">
          <span class="${pref}-nombre">Archivo de Seguimiento ${i + 2}</span>
          <span class="${pref}-meta">${esc(d.nombre)}</span>
          ${d.subido_por ? `<span class="${pref}-subido-por"><i class="ti ti-user"></i> Subido por ${esc(d.subido_por)}</span>` : ''}
        </div>
        <div class="${pref}-abrir"><i class="ti ti-external-link"></i></div>
      </div>`).join('');
  }

  /* ── Modal Atender ── */
  function iniciar(r) {
    oficioId = r?.id ?? null;
    existentes = (r?.docs_extra || []).slice();
    quitados = [];
    nuevos = [];
    pintar();
  }

  function pintar() {
    const cont = document.getElementById('atender-extras');
    if (!cont) return;
    const visibles = existentes.filter(d => !quitados.includes(d.id));
    let n = 1; // el Archivo de Seguimiento 1 es el Seguimiento (doc4)
    const filasExist = visibles.map(d => `
      <div class="doc-admin-card doc-solo-vista extra-fila">
        <div class="doc-admin-click" onclick="verDocSeguro(${oficioId}, 'extra-${d.id}')">
          <div class="doc-admin-icon"><i class="ti ti-file-type-pdf"></i></div>
          <div class="doc-admin-info">
            <span class="doc-admin-nombre">Archivo de Seguimiento ${++n}</span>
            <span class="doc-admin-meta">${esc(d.nombre)} — ya adjunto, clic para ver</span>
          </div>
        </div>
        <button type="button" class="btn-quitar-doc" title="Eliminar este documento" onclick="DocsExtra.quitarExistente('${d.id}')"><i class="ti ti-trash"></i></button>
      </div>`).join('');
    const filasNuevas = nuevos.map(x => `
      <div class="extra-nuevo">
        <i class="ti ti-file-upload"></i>
        <div class="extra-nuevo-info">
          <span class="extra-nuevo-titulo">Archivo de Seguimiento ${++n}</span>
          <span class="extra-nuevo-nombre">${esc(x.file.name)}</span>
        </div>
        <button type="button" class="btn-quitar-doc" title="Quitar" onclick="DocsExtra.quitarNuevo(${x.key})"><i class="ti ti-x"></i></button>
      </div>`).join('');
    cont.innerHTML = filasExist + filasNuevas + `
      <label class="btn-agregar-doc">
        <input type="file" accept=".pdf,.doc,.docx,image/*" multiple onchange="DocsExtra.agregar(this)"/>
        <i class="ti ti-plus"></i> Agregar otro archivo de seguimiento
      </label>`;
  }

  function agregar(input) {
    for (const f of input.files || []) {
      if (existentes.length - quitados.length + nuevos.length >= 10) {
        alert('Máximo 10 archivos de seguimiento adicionales por oficio.');
        break;
      }
      nuevos.push({ key: ++sig, file: f });
    }
    input.value = '';
    pintar();
  }
  function quitarNuevo(key) { nuevos = nuevos.filter(x => x.key !== key); pintar(); }
  function quitarExistente(id) { quitados.push(id); pintar(); }

  /* Agrega al FormData del guardado los archivos nuevos y los eliminados */
  function anexar(fd) {
    nuevos.forEach(x => fd.append('docs_extra', x.file));
    if (quitados.length) fd.append('docs_extra_quitar', JSON.stringify(quitados));
  }

  return { tarjetas, iniciar, agregar, quitarNuevo, quitarExistente, anexar };
})();
