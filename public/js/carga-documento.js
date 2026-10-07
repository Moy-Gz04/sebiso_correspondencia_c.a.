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
      // La pestaña abre el archivo directo para que Chrome lo muestre en su visor
      // (descargar, imprimir, zoom). Mientras el servidor responde, Chrome sigue
      // mostrando esta pantalla con la barra avanzando.
      await abrirEnVisor(ventana, url, () => clearInterval(avance));
    },
    cancelar() {
      clearInterval(avance);
      if (ventana) ventana.close();
    }
  };
}

// Abre un documento en la pestaña `ventana`: los PDF y demás archivos en el visor
// de Chrome (navegando a la URL); las imágenes en un visor propio con botón
// "Descargar", porque Chrome no ofrece descarga al mostrar una imagen.
async function abrirEnVisor(ventana, url, alTerminar) {
  const ctrl = new AbortController();
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const tipo = r.headers.get('Content-Type') || '';
    if (!r.ok || !/^image\//i.test(tipo)) { ctrl.abort(); if (alTerminar) alTerminar(); ventana.location.href = url; return; }
    const cd = r.headers.get('Content-Disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
    let nombre = m ? decodeURIComponent(m[1]) : 'documento';
    if (!/\.\w{2,4}$/.test(nombre)) nombre += '.' + (tipo.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const blob = await r.blob();
    if (alTerminar) alTerminar();
    const enlace = URL.createObjectURL(blob);
    const d = ventana.document;
    d.title = nombre;
    d.body.style.cssText = 'margin:0;background:#2b2b2e;font-family:Segoe UI,Arial,sans-serif';
    d.body.innerHTML = '';
    const barra = d.createElement('div');
    barra.style.cssText = 'position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px;background:#3A0818;color:#F3E2D9;font-size:14px;z-index:2';
    const titulo = d.createElement('span'); titulo.textContent = nombre;
    titulo.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const btn = d.createElement('a'); btn.href = enlace; btn.download = nombre; btn.textContent = '⬇ Descargar';
    btn.style.cssText = 'flex-shrink:0;padding:8px 18px;border-radius:999px;background:linear-gradient(135deg,#D8B866,#9C7A2E);color:#3A0818;font-weight:700;text-decoration:none';
    const imp = d.createElement('button'); imp.textContent = '🖨 Imprimir';
    imp.style.cssText = 'flex-shrink:0;padding:8px 18px;border-radius:999px;border:1px solid #D8B866;background:none;color:#F3E2D9;font-weight:700;cursor:pointer;font-size:14px';
    imp.onclick = () => ventana.print();
    const acciones = d.createElement('div'); acciones.style.cssText = 'display:flex;gap:8px'; acciones.append(imp, btn);
    barra.append(titulo, acciones);
    const img = d.createElement('img'); img.src = enlace; img.alt = nombre;
    img.style.cssText = 'display:block;max-width:100%;margin:16px auto;box-shadow:0 6px 24px rgba(0,0,0,.5);background:#fff';
    const st = d.createElement('style'); st.textContent = '@media print { body { background:#fff !important } div { display:none !important } img { box-shadow:none !important; margin:0 auto !important } }';
    d.head.appendChild(st);
    d.body.append(barra, img);
  } catch (e) {
    if (alTerminar) alTerminar();
    ventana.location.href = url;
  }
}
