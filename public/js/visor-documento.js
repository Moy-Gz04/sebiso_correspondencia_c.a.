/* =========================================================
   visor-documento.js
   Visor de documentos dentro de la misma página (como el de Salas, pero en
   grande): se abre al centro de la pantalla, sin otra pestaña, con botones
   para Descargar e Imprimir. La ventana se ajusta al tamaño del documento
   (no queda un marco vacío alrededor). El archivo se baja aquí con barra de
   avance y se muestra según su tipo:
     · PDF     -> visor de PDF del navegador, ventana con proporción de hoja
     · imagen  -> la imagen a su medida, con acercar / alejar
     · otros (Word, etc.) -> aviso + botón Descargar (el navegador no los muestra)
   Uso:  abrirVisorDocumento({ titulo: 'Turno', subtitulo: 'N. Control 123', obtenerUrl: async () => url });
   obtenerUrl devuelve la URL de un solo uso (/api/docs/:token); si lanza un
   error, el visor muestra el mensaje en lugar del documento.
   ========================================================= */

(() => {
  let raiz = null, urlActual = null, nombreActual = 'documento', tipoActual = '', ctrl = null, ultimoFoco = null;
  let medida = null;   // { tipo: 'imagen'|'pdf'|'aviso', w, h } del documento abierto, para reajustar al cambiar la ventana

  const BARRA = 64, PIE = 46, PAD = 20;   // alturas fijas de la ventana (px) y margen alrededor de la hoja

  function inyectar() {
    if (raiz) return;
    const st = document.createElement('style');
    st.textContent = `
      .vd-fondo { position: fixed; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center;
        padding: 3vh 2vw; background: radial-gradient(ellipse at center, rgba(61,20,32,.55), rgba(20,6,12,.78));
        backdrop-filter: blur(4px); animation: vdAparece .18s ease-out; }
      .vd-fondo[hidden] { display: none; }
      @keyframes vdAparece { from { opacity: 0; } to { opacity: 1; } }

      .vd-ventana { width: 560px; max-width: 100%; max-height: 94vh; display: flex; flex-direction: column;
        background: #F7F3EE; border-radius: 16px; overflow: hidden;
        box-shadow: 0 30px 80px rgba(0,0,0,.5), 0 0 0 1px rgba(216,184,102,.35);
        font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif; animation: vdSube .24s cubic-bezier(.22,1,.36,1);
        transition: width .25s cubic-bezier(.22,1,.36,1); }
      @keyframes vdSube { from { transform: translateY(16px) scale(.98); opacity: .6; } to { transform: none; opacity: 1; } }

      .vd-barra { position: relative; height: ${BARRA}px; box-sizing: border-box; display: flex; align-items: center; gap: 12px;
        padding: 0 12px 0 14px; flex-shrink: 0; color: #F6EEDD;
        background: linear-gradient(120deg, #6B2539 0%, #4A1626 55%, #3A0F1D 100%); }
      .vd-barra::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
        background: linear-gradient(90deg, #9C7A2E, #E7CD86 45%, #9C7A2E); }
      .vd-icono { width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center;
        background: rgba(216,184,102,.16); border: 1px solid rgba(216,184,102,.55); color: #E7CD86; font-size: 19px; }
      .vd-titulos { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
      .vd-fila { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .vd-titulo { font-size: 15px; font-weight: 700; letter-spacing: .01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vd-chip { flex-shrink: 0; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: .04em;
        text-transform: uppercase; color: #3A0818; background: linear-gradient(135deg, #E7CD86, #C9A24E); }
      .vd-chip:empty { display: none; }
      .vd-sub { font-size: 11.5px; color: rgba(246,238,221,.7); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .vd-acciones { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
      .vd-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 999px;
        font: 600 13px 'Montserrat', 'Segoe UI', Arial, sans-serif; cursor: pointer; border: 1px solid rgba(216,184,102,.6);
        background: rgba(255,255,255,.04); color: #F6EEDD; transition: background .15s, transform .1s, opacity .15s; }
      .vd-btn:hover { background: rgba(255,255,255,.12); }
      .vd-btn:active { transform: scale(.97); }
      .vd-btn i { font-size: 17px; }
      .vd-btn-dorado { background: linear-gradient(135deg, #E7CD86, #B08A3A); border-color: transparent; color: #3A0818;
        box-shadow: 0 4px 14px rgba(176,138,58,.35); }
      .vd-btn-dorado:hover { background: linear-gradient(135deg, #F0D995, #BC9545); }
      .vd-btn:disabled { opacity: .4; pointer-events: none; }
      .vd-cerrar { width: 36px; padding: 0; justify-content: center; border-color: rgba(246,238,221,.3); margin-left: 2px; }
      .vd-btn:focus-visible { outline: 2px solid #E7CD86; outline-offset: 2px; }

      .vd-cuerpo { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: ${PAD}px;
        background-color: #E8E0D5;
        background-image: radial-gradient(rgba(95,33,50,.09) 1px, transparent 1.2px);
        background-size: 14px 14px; }
      .vd-hoja { background: #fff; border-radius: 4px; overflow: hidden;
        box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 10px 30px rgba(61,20,32,.22); outline: 1px solid rgba(95,33,50,.08); }
      .vd-hoja iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
      .vd-img-marco { overflow: auto; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 10px 30px rgba(61,20,32,.22); background: #fff; }
      .vd-img-marco img { display: block; transform-origin: 0 0; }

      .vd-pie { height: ${PIE}px; box-sizing: border-box; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; gap: 10px;
        padding: 0 14px; background: #F7F3EE; border-top: 1px solid #E4D9CC; font-size: 11.5px; color: #7A6470; }
      .vd-tecla { display: inline-flex; align-items: center; gap: 6px; }
      .vd-tecla kbd { font: 700 10px 'Montserrat', sans-serif; padding: 2px 6px; border-radius: 5px; border: 1px solid #DCCFC0;
        border-bottom-width: 2px; background: #fff; color: #5F2132; }

      .vd-estado { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 34px 26px; text-align: center; color: #5F2132; max-width: 420px;
        background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(61,20,32,.15); }
      .vd-estado b { font-size: 15.5px; }
      .vd-estado span { font-size: 12.5px; color: #6B5563; line-height: 1.5; }
      .vd-estado > i { font-size: 38px; color: #BC955C; }
      .vd-pista { width: min(300px, 64vw); height: 8px; border-radius: 999px; background: #EDE3D6; overflow: hidden; }
      .vd-avance { height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg, #5F2132, #BC955C); transition: width .2s ease; }
      .vd-pct { font-weight: 700; font-variant-numeric: tabular-nums; }

      @media (max-width: 640px) {
        .vd-fondo { padding: 0; }
        .vd-ventana { width: 100% !important; height: 100%; max-height: none; border-radius: 0; }
        .vd-btn span { display: none; }
        .vd-btn { width: 38px; padding: 0; justify-content: center; }
        .vd-sub, .vd-tecla { display: none; }
        .vd-cuerpo { padding: 10px; }
      }
      @media (prefers-reduced-motion: reduce) { .vd-fondo, .vd-ventana { animation: none; transition: none; } }
    `;
    document.head.appendChild(st);
    raiz = document.createElement('div');
    raiz.className = 'vd-fondo';
    raiz.hidden = true;
    raiz.innerHTML = `
      <div class="vd-ventana" role="dialog" aria-modal="true" aria-labelledby="vd-titulo">
        <div class="vd-barra">
          <span class="vd-icono" aria-hidden="true"><i class="ti ti-file-text" id="vd-icono"></i></span>
          <div class="vd-titulos">
            <div class="vd-fila"><span class="vd-titulo" id="vd-titulo">Documento</span><span class="vd-chip" id="vd-chip"></span></div>
            <span class="vd-sub" id="vd-sub"></span>
          </div>
          <div class="vd-acciones">
            <button type="button" class="vd-btn" id="vd-imprimir" disabled><i class="ti ti-printer"></i><span>Imprimir</span></button>
            <button type="button" class="vd-btn vd-btn-dorado" id="vd-descargar" disabled><i class="ti ti-download"></i><span>Descargar</span></button>
            <button type="button" class="vd-btn vd-cerrar" id="vd-cerrar" aria-label="Cerrar visor"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <div class="vd-cuerpo" id="vd-cuerpo"></div>
        <div class="vd-pie">
          <span class="vd-tecla"><kbd>Esc</kbd> para cerrar</span>
        </div>
      </div>`;
    document.body.appendChild(raiz);
    raiz.querySelector('#vd-cerrar').addEventListener('click', cerrar);
    raiz.addEventListener('click', (e) => { if (e.target === raiz) cerrar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !raiz.hidden) cerrar(); });
    raiz.querySelector('#vd-descargar').addEventListener('click', descargar);
    raiz.querySelector('#vd-imprimir').addEventListener('click', imprimir);
    window.addEventListener('resize', () => { if (!raiz.hidden && medida) ajustar(); });
  }

  const $ = (id) => raiz.querySelector('#' + id);

  /* Espacio máximo disponible para la hoja (descontando barra, pie y márgenes) */
  function espacio() {
    const movil = window.innerWidth <= 640;
    const pad = movil ? 10 : PAD;
    const altoVentana = movil ? window.innerHeight : window.innerHeight * 0.94;
    const anchoVentana = movil ? window.innerWidth : Math.min(window.innerWidth * 0.96, 1400);
    return { w: anchoVentana - pad * 2, h: altoVentana - BARRA - PIE - pad * 2, pad, movil };
  }

  /* Ajusta la ventana justo al tamaño del documento */
  function ajustar() {
    const ventana = raiz.querySelector('.vd-ventana');
    const { w: maxW, h: maxH, pad, movil } = espacio();
    if (medida.tipo === 'imagen') {
      const k = Math.min(1, maxW / medida.w, maxH / medida.h);
      const w = Math.round(medida.w * k), h = Math.round(medida.h * k);
      medida.ajuste = { w, h };
      const marco = raiz.querySelector('.vd-img-marco');
      if (marco) { marco.style.width = w + 'px'; marco.style.height = h + 'px'; }
      const img = marco && marco.querySelector('img');
      if (img) { img.style.width = w + 'px'; img.style.height = h + 'px'; }
      if (!movil) ventana.style.width = Math.max(w + pad * 2, 560) + 'px';
    } else if (medida.tipo === 'pdf') {
      // Sin la barra del visor del navegador. Más ancho que una hoja carta a la altura de la
      // pantalla (×1.3, mín. 900 px): la hoja se ajusta al ancho y la letra chica se lee mejor;
      // lo que sobra hacia abajo se recorre con la rueda.
      const h = maxH, w = Math.min(maxW, Math.max(900, Math.round(h * (8.5 / 11) * 1.3)));
      const hoja = raiz.querySelector('.vd-hoja');
      if (hoja) { hoja.style.width = w + 'px'; hoja.style.height = h + 'px'; }
      if (!movil) ventana.style.width = Math.max(w + pad * 2, 560) + 'px';
    } else if (!movil) ventana.style.width = '560px';
  }

  function estado(icono, titulo, texto, conBarra) {
    medida = { tipo: 'aviso' };
    $('vd-cuerpo').innerHTML = `
      <div class="vd-estado">
        ${icono ? `<i class="ti ${icono}" aria-hidden="true"></i>` : ''}
        <b>${titulo}</b>
        ${conBarra ? '<div class="vd-pista"><div class="vd-avance" id="vd-avance"></div></div><span class="vd-pct" id="vd-pct">0%</span>' : ''}
        ${texto ? `<span>${texto}</span>` : ''}
      </div>`;
    ajustar();
  }

  function cerrar() {
    if (!raiz || raiz.hidden) return;
    if (ctrl) ctrl.abort();
    raiz.hidden = true;
    $('vd-cuerpo').innerHTML = '';
    medida = null;
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


  async function abrirVisorDocumento({ titulo = 'Documento', subtitulo = '', etiqueta = '', obtenerUrl }) {
    inyectar();
    if (ctrl) ctrl.abort();
    if (urlActual) { URL.revokeObjectURL(urlActual); urlActual = null; }
    ultimoFoco = document.activeElement;
    $('vd-titulo').textContent = titulo;
    $('vd-chip').textContent = etiqueta;
    $('vd-sub').textContent = subtitulo;
    $('vd-icono').className = 'ti ti-file-text';
    $('vd-descargar').disabled = $('vd-imprimir').disabled = true;
    raiz.hidden = false;
    document.body.style.overflow = 'hidden';
    estado('', 'Cargando documento…', 'Los archivos grandes pueden tardar unos segundos.', true);
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
        $('vd-icono').className = 'ti ti-file-type-pdf';
        cuerpo.innerHTML = '<div class="vd-hoja"></div>';
        const marco = document.createElement('iframe');
        marco.title = nombreActual;
        marco.src = urlActual + '#toolbar=0&navpanes=0&view=FitH';   // sin las opciones del visor de Chrome
        cuerpo.firstChild.appendChild(marco);
        medida = { tipo: 'pdf' };
        ajustar();
        $('vd-imprimir').disabled = false;
      } else if (/^image\//.test(tipoActual)) {
        const img = new Image();
        img.alt = nombreActual;
        img.src = urlActual;
        await img.decode().catch(() => {});
        if (miCtrl !== ctrl) return;
        $('vd-icono').className = 'ti ti-photo';
        cuerpo.innerHTML = '<div class="vd-img-marco"></div>';
        cuerpo.firstChild.appendChild(img);
        medida = { tipo: 'imagen', w: img.naturalWidth || 800, h: img.naturalHeight || 1000 };
        ajustar();
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
