/* =========================================================
   carga-documento.js
   Pantalla de carga al abrir un documento en otra pestaña (la misma que
   Contratos): "Cargando documento…" con barra y porcentaje. El archivo se
   descarga aquí (avance real si el servidor da el tamaño; si no, uno
   aproximado que se acerca al 95 %) y al terminar se muestra en esa misma
   pestaña. Si algo falla, la pestaña abre el enlace directo como antes.
   Uso:  const carga = iniciarCargaDocumento(ventana);
         await carga.abrir(url);      // o carga.cancelar() si hubo error
   ========================================================= */

function iniciarCargaDocumento(ventana) {
  let avance = null, pct = 0, real = null;
  const pintar = (v) => {
    try {
      ventana.document.getElementById('barra').style.width = v.toFixed(1) + '%';
      ventana.document.getElementById('pct').textContent = Math.floor(v) + '%';
    } catch (e) { clearInterval(avance); }
  };
  if (ventana) {
    try {
      ventana.document.title = 'Cargando…';
      ventana.document.body.style.margin = '0';
      ventana.document.body.innerHTML = `
        <div style="font:16px Segoe UI,Arial,sans-serif;color:#5F2132;display:flex;align-items:center;justify-content:center;height:96vh;flex-direction:column;gap:14px;background:#F7F5F2">
          <b style="font-size:18px">Cargando documento…</b>
          <div style="width:min(360px,80vw);height:10px;border-radius:999px;background:#EAE3D9;overflow:hidden">
            <div id="barra" style="height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#5F2132,#BC955C);transition:width .25s ease"></div>
          </div>
          <span id="pct" style="font-weight:700;font-variant-numeric:tabular-nums">0%</span>
          <span style="color:#777;font-size:13px">Los archivos grandes pueden tardar unos segundos.</span>
        </div>`;
      avance = setInterval(() => {
        pct = real !== null ? Math.max(pct, real) : pct + (95 - pct) * 0.03;
        pintar(Math.min(pct, 99));
      }, 120);
      setTimeout(() => clearInterval(avance), 180000);
    } catch (e) { /* la pestaña no permite escribir: se abrirá directo */ }
  }
  return {
    async abrir(url) {
      if (!ventana) { window.open(url, '_blank', 'noopener'); return; }
      try {
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok || !r.body) throw new Error('descarga');
        const tipo = r.headers.get('Content-Type') || 'application/pdf';
        if (/text\/html/i.test(tipo)) throw new Error('no es archivo');
        const total = Number(r.headers.get('Content-Length')) || 0;
        const lector = r.body.getReader();
        const partes = []; let recibido = 0;
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          partes.push(value); recibido += value.length;
          if (total) real = recibido / total * 100;
        }
        clearInterval(avance); pintar(100);
        const enlace = URL.createObjectURL(new Blob(partes, { type: tipo }));
        ventana.document.title = 'Documento';
        ventana.document.body.innerHTML = '';
        const marco = ventana.document.createElement('iframe');
        marco.src = enlace;
        marco.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
        ventana.document.body.appendChild(marco);
      } catch (e) {
        clearInterval(avance);
        ventana.location.href = url;
      }
    },
    cancelar() {
      clearInterval(avance);
      if (ventana) ventana.close();
    }
  };
}
