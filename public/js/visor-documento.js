/* =========================================================
   visor-documento.js
   Visor de documentos dentro de la misma página (como el de Salas, pero en
   grande): se abre al centro de la pantalla, sin otra pestaña, con botones
   para Descargar e Imprimir. El archivo se baja aquí con barra de avance y
   se muestra según su tipo:
     · PDF     -> visor de PDF del navegador dentro del recuadro
     · imagen  -> la imagen ajustada al recuadro
     · otros (Word, etc.) -> aviso + botón Descargar (el navegador no los muestra)
   Uso:  abrirVisorDocumento({ titulo: 'Documento de Turno', obtenerUrl: async () => url });
   obtenerUrl devuelve la URL de un solo uso (/api/docs/:token); si lanza un
   error, el visor muestra el mensaje en lugar del documento.
   ========================================================= */

(() => {
  let raiz = null, urlActual = null, nombreActual = 'documento', tipoActual = '', ctrl = null, ultimoFoco = null;

  function inyectar() {
    if (raiz) return;
    const st = document.createElement('style');
    st.textContent = `
      .vd-fondo { position: fixed; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center;
        padding: 3vh 3vw; background: rgba(28, 8, 16, .62); backdrop-filter: blur(3px); animation: vdAparece .18s ease-out; }
      .vd-fondo[hidden] { display: none; }
      @keyframes vdAparece { from { opacity: 0; } to { opacity: 1; } }
      .vd-ventana { width: min(1180px, 100%); height: 100%; max-height: 94vh; display: flex; flex-direction: column;
        background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45);
        font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif; animation: vdSube .22s cubic-bezier(.22,1,.36,1); }
      @keyframes vdSube { from { transform: translateY(14px) scale(.985); } to { transform: none; } }
      .vd-barra { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 18px;
        background: linear-gradient(135deg, #5F2132 0%, #3D1420 100%); color: #F6EEDD; flex-shrink: 0; }
      .vd-icono { font-size: 21px; color: #D8B866; flex-shrink: 0; }
      .vd-titulos { min-width: 0; flex: 1; display: flex; flex-direction: column; }
      .vd-titulo { font-size: 14.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vd-sub { font-size: 11.5px; color: rgba(246,238,221,.72); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vd-acciones { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .vd-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 999px;
        font: 600 13px 'Montserrat', 'Segoe UI', Arial, sans-serif; cursor: pointer; border: 1px solid rgba(216,184,102,.7);
        background: transparent; color: #F6EEDD; transition: background .15s, opacity .15s; }
      .vd-btn:hover { background: rgba(255,255,255,.1); }
      .vd-btn i { font-size: 17px; }
      .vd-btn-dorado { background: linear-gradient(135deg, #D8B866, #9C7A2E); border-color: transparent; color: #3A0818; }
      .vd-btn-dorado:hover { background: linear-gradient(135deg, #e3c578, #a8853a); }
      .vd-btn:disabled { opacity: .45; pointer-events: none; }
      .vd-cerrar { width: 36px; padding: 0; justify-content: center; border-color: rgba(246,238,221,.35); }
      .vd-btn:focus-visible { outline: 2px solid #D8B866; outline-offset: 2px; }
      .vd-cuerpo { position: relative; flex: 1; min-height: 0; background: #ECE7E1; display: flex; align-items: center; justify-content: center; }
      .vd-cuerpo iframe { width: 100%; height: 100%; border: 0; background: #fff; }
      .vd-cuerpo img { max-width: 100%; max-height: 100%; object-fit: contain; padding: 18px; box-sizing: border-box; }
      .vd-img-marco { width: 100%; height: 100%; overflow: auto; display: flex; align-items: center; justify-content: center; }
      .vd-img-marco img { background: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.18); padding: 0; margin: 18px; max-width: calc(100% - 36px); max-height: calc(100% - 36px); }
      .vd-estado { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; text-align: center; color: #5F2132; max-width: 420px; }
      .vd-estado b { font-size: 16px; }
      .vd-estado span { font-size: 13px; color: #6B5563; line-height: 1.5; }
      .vd-estado > i { font-size: 40px; color: #BC955C; }
      .vd-pista { width: min(340px, 70vw); height: 9px; border-radius: 999px; background: #E1D7CB; overflow: hidden; }
      .vd-avance { height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg, #5F2132, #BC955C); transition: width .2s ease; }
      .vd-pct { font-weight: 700; font-variant-numeric: tabular-nums; }
      @media (max-width: 640px) {
        .vd-fondo { padding: 0; }
        .vd-ventana { max-height: none; border-radius: 0; }
        .vd-btn span { display: none; }
        .vd-btn { width: 38px; padding: 0; justify-content: center; }
        .vd-sub { display: none; }
      }
      @media (prefers-reduced-motion: reduce) { .vd-fondo, .vd-ventana { animation: none; } }
    `;
    document.head.appendChild(st);
    raiz = document.createElement('div');
    raiz.className = 'vd-fondo';
    raiz.hidden = true;
    raiz.innerHTML = `
      <div class="vd-ventana" role="dialog" aria-modal="true" aria-labelledby="vd-titulo">
        <div class="vd-barra">
          <i class="ti ti-file-text vd-icono" aria-hidden="true"></i>
          <div class="vd-titulos">
            <span class="vd-titulo" id="vd-titulo">Documento</span>
            <span class="vd-sub" id="vd-sub"></span>
          </div>
          <div class="vd-acciones">
            <button type="button" class="vd-btn" id="vd-imprimir" disabled><i class="ti ti-printer"></i><span>Imprimir</span></button>
            <button type="button" class="vd-btn vd-btn-dorado" id="vd-descargar" disabled><i class="ti ti-download"></i><span>Descargar</span></button>
            <button type="button" class="vd-btn vd-cerrar" id="vd-cerrar" aria-label="Cerrar visor"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <div class="vd-cuerpo" id="vd-cuerpo"></div>
      </div>`;
    document.body.appendChild(raiz);
    raiz.querySelector('#vd-cerrar').addEventListener('click', cerrar);
    raiz.addEventListener('click', (e) => { if (e.target === raiz) cerrar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !raiz.hidden) cerrar(); });
    raiz.querySelector('#vd-descargar').addEventListener('click', descargar);
    raiz.querySelector('#vd-imprimir').addEventListener('click', imprimir);
  }

  const $ = (id) => raiz.querySelector('#' + id);

  function estado(icono, titulo, texto, conBarra) {
    $('vd-cuerpo').innerHTML = `
      <div class="vd-estado">
        ${icono ? `<i class="ti ${icono}" aria-hidden="true"></i>` : ''}
        <b>${titulo}</b>
        ${conBarra ? '<div class="vd-pista"><div class="vd-avance" id="vd-avance"></div></div><span class="vd-pct" id="vd-pct">0%</span>' : ''}
        ${texto ? `<span>${texto}</span>` : ''}
      </div>`;
  }

  function cerrar() {
    if (!raiz || raiz.hidden) return;
    if (ctrl) ctrl.abort();
    raiz.hidden = true;
    $('vd-cuerpo').innerHTML = '';
    if (urlActual) { URL.revokeObjectURL(urlActual); urlActual = null; }
    document.body.style.overflow = '';
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
  }

  function descargar() {
    if (!urlActual) return;
    const a = document.createElement('a');
    a.href = urlActual; a.download = nombreActual;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function imprimir() {
    if (!urlActual) return;
    const marco = $('vd-cuerpo').querySelector('iframe');
    if (/pdf/i.test(tipoActual) && marco) {
      try { marco.contentWindow.focus(); marco.contentWindow.print(); return; } catch { /* abajo: otra vía */ }
    }
    // Imágenes (o si el PDF no deja imprimir desde el recuadro): se imprime desde un marco oculto
    const oculto = document.createElement('iframe');
    oculto.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(oculto);
    const d = oculto.contentDocument;
    if (/^image\//i.test(tipoActual)) {
      d.open();
      d.write(`<!doctype html><title>${nombreActual.replace(/</g, '')}</title><style>@page{margin:10mm}html,body{margin:0;height:100%}img{display:block;max-width:100%;max-height:100vh;margin:0 auto}</style><img src="${urlActual}">`);
      d.close();
      oculto.contentWindow.onload = () => { oculto.contentWindow.focus(); oculto.contentWindow.print(); setTimeout(() => oculto.remove(), 60000); };
    } else {
      oculto.src = urlActual;
      oculto.onload = () => { try { oculto.contentWindow.print(); } catch { window.open(urlActual, '_blank'); } setTimeout(() => oculto.remove(), 60000); };
    }
  }

  function nombreDesde(r, tipo) {
    const cd = r.headers.get('Content-Disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
    let nombre = m ? decodeURIComponent(m[1]) : 'documento';
    if (!/\.\w{2,5}$/.test(nombre)) {
      const ext = /pdf/i.test(tipo) ? 'pdf' : (tipo.split('/')[1] || 'bin').replace('jpeg', 'jpg').split(';')[0];
      nombre += '.' + ext;
    }
    return nombre;
  }

  async function abrirVisorDocumento({ titulo = 'Documento', subtitulo = '', obtenerUrl }) {
    inyectar();
    if (ctrl) ctrl.abort();
    if (urlActual) { URL.revokeObjectURL(urlActual); urlActual = null; }
    ultimoFoco = document.activeElement;
    $('vd-titulo').textContent = titulo;
    $('vd-sub').textContent = subtitulo;
    $('vd-descargar').disabled = $('vd-imprimir').disabled = true;
    estado('', 'Cargando documento…', 'Los archivos grandes pueden tardar unos segundos.', true);
    raiz.hidden = false;
    document.body.style.overflow = 'hidden';
    $('vd-cerrar').focus();

    const miCtrl = ctrl = new AbortController();
    let pct = 0, real = null;
    const pintar = () => {
      const b = raiz.querySelector('#vd-avance'), p = raiz.querySelector('#vd-pct');
      if (b) b.style.width = pct.toFixed(1) + '%';
      if (p) p.textContent = Math.floor(pct) + '%';
    };
    const tic = setInterval(() => { pct = real !== null ? Math.max(pct, real) : pct + (95 - pct) * 0.03; pct = Math.min(pct, 99); pintar(); }, 120);

    try {
      const url = await obtenerUrl();
      const r = await fetch(url, { signal: miCtrl.signal });
      if (!r.ok) throw new Error(r.status === 401 ? 'El enlace del documento caducó. Vuelve a abrirlo.' : 'No se pudo cargar el documento.');
      const tipo = (r.headers.get('Content-Type') || '').toLowerCase();
      const total = Number(r.headers.get('Content-Length')) || 0;
      let blob;
      if (r.body && total) {
        const lector = r.body.getReader(), partes = [];
        let recibido = 0;
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          partes.push(value); recibido += value.length;
          real = recibido / total * 100;
        }
        blob = new Blob(partes, { type: tipo });
      } else blob = await r.blob();
      if (miCtrl !== ctrl) return;

      tipoActual = tipo || blob.type;
      nombreActual = nombreDesde(r, tipoActual);
      urlActual = URL.createObjectURL(blob);
      $('vd-sub').textContent = [subtitulo, nombreActual].filter(Boolean).join(' · ');
      $('vd-descargar').disabled = false;

      const cuerpo = $('vd-cuerpo');
      if (/pdf/.test(tipoActual)) {
        cuerpo.innerHTML = '';
        const marco = document.createElement('iframe');
        marco.title = nombreActual;
        marco.src = urlActual;
        cuerpo.appendChild(marco);
        $('vd-imprimir').disabled = false;
      } else if (/^image\//.test(tipoActual)) {
        cuerpo.innerHTML = '<div class="vd-img-marco"></div>';
        const img = document.createElement('img');
        img.alt = nombreActual; img.src = urlActual;
        cuerpo.firstChild.appendChild(img);
        $('vd-imprimir').disabled = false;
      } else {
        estado('ti-file-download', 'Este tipo de archivo no se puede mostrar aquí',
          `«${nombreActual}» se abre con su programa (por ejemplo Word). Usa el botón Descargar.`);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      estado('ti-alert-circle', 'No se pudo abrir el documento', err.message || 'Intenta de nuevo en unos segundos.');
    } finally {
      clearInterval(tic);
    }
  }

  window.abrirVisorDocumento = abrirVisorDocumento;
  window.cerrarVisorDocumento = cerrar;
})();
