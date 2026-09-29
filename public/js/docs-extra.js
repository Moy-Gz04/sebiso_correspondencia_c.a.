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

  /* Agrega al FormData del guardado los archivos nuevos y los eliminados.
     Las fotos se comprimen antes (ver comprimir). */
  async function anexar(fd) {
    for (const x of nuevos) fd.append('docs_extra', await comprimir(x.file));
    if (quitados.length) fd.append('docs_extra_quitar', JSON.stringify(quitados));
  }

  /* Fotos tomadas con el celular: pesan 4–12 MB y por datos móviles la
     subida tardaba tanto que fallaba sin avisar. Se reducen a máx. 2000 px
     en JPEG (≈300–600 KB), que sigue leyéndose perfecto. PDF, Word y lo que
     el navegador no pueda dibujar (p. ej. HEIC en Android) se mandan igual;
     si comprimir no ayuda, también se queda el original. */
  async function comprimir(file, maxLado = 2000, calidad = 0.82) {
    if (!file || !/^image\/(jpeg|png|webp|bmp)$/i.test(file.type) || file.size < 700 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', calidad));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
    } catch {
      return file;
    }
  }

  return { tarjetas, iniciar, agregar, quitarNuevo, quitarExistente, anexar, comprimir };
})();
