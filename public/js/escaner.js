/* ═══════════════════════════════════════════════════
   SBIS — Escáner de documentos (estilo CamScanner)
   ───────────────────────────────────────────────────
   Cámara en vivo que detecta la hoja y dibuja su contorno en tiempo real
   (OpenCV.js), se dispara sola cuando la hoja está quieta (o con el botón),
   y después deja ajustar las 4 esquinas antes de enderezar y recortar la
   hoja con corrección de perspectiva. Entrega un File (JPEG) que se sube
   por el mismo flujo de siempre.

   Si OpenCV no carga (sin red, navegador viejo) el escáner sigue
   funcionando: se toma la foto y las esquinas se ajustan a mano. Si la
   cámara en vivo no está disponible, la página conserva el botón de
   "cámara del teléfono" de siempre.

   Uso:  EscanerDoc.abrir({ onListo: (file) => ... })
   ═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CDN_OPENCV = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js/dist/opencv.js';
  const LADO_DETECCION = 360;      // los cuadros se reducen a este lado más largo para detectar rápido
  const INTERVALO_MS = 130;        // ~7 detecciones por segundo
  const CUADROS_ESTABLE = 7;       // ~1 s con la hoja quieta antes del disparo automático
  const MOVIMIENTO_MAX = 0.018;    // fracción de la diagonal: por debajo se considera "quieta"
  const AREA_MIN = 0.14;           // la hoja debe ocupar al menos esta parte del cuadro
  const LADO_MAX_SALIDA = 2200;    // px del lado más largo de la imagen final

  /* ───────── OpenCV (carga perezosa) ───────── */
  let cvPromesa = null;
  function cargarOpenCV() {
    if (cvPromesa) return cvPromesa;
    cvPromesa = new Promise((resolve, reject) => {
      const limite = setTimeout(() => reject(new Error('OpenCV tardó demasiado en cargar.')), 30000);
      const listo = (c) => { clearTimeout(limite); try { delete c.then; } catch { /* módulo ya sin then */ } resolve(c); };
      const esperar = () => {
        const iv = setInterval(() => {
          const c = window.cv;
          if (c && typeof c.Mat === 'function') { clearInterval(iv); listo(c); }
          else if (c && typeof c.then === 'function') { clearInterval(iv); c.then(listo, reject); }
        }, 150);
      };
      if (window.cv) { esperar(); return; }
      const s = document.createElement('script');
      s.async = true; s.src = CDN_OPENCV;
      s.onload = esperar;
      s.onerror = () => { clearTimeout(limite); reject(new Error('No se pudo descargar OpenCV.')); };
      document.head.appendChild(s);
    });
    cvPromesa.catch(() => { cvPromesa = null; }); // permite reintentar más tarde
    return cvPromesa;
  }

  /* ───────── Geometría ───────── */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // 4 puntos cualquiera -> [arribaIzq, arribaDer, abajoDer, abajoIzq]
  function ordenarEsquinas(p) {
    const suma = p.map(q => q.x + q.y);
    const dif = p.map(q => q.y - q.x);
    return [
      p[suma.indexOf(Math.min(...suma))],
      p[dif.indexOf(Math.min(...dif))],
      p[suma.indexOf(Math.max(...suma))],
      p[dif.indexOf(Math.max(...dif))],
    ];
  }

  function esquinasDeRectangulo(rect) {
    const { x: cx, y: cy } = rect.center;
    const { width: rw, height: rh } = rect.size;
    const a = rect.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[-rw / 2, -rh / 2], [rw / 2, -rh / 2], [rw / 2, rh / 2], [-rw / 2, rh / 2]]
      .map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
  }

  /* Cuánto más claro es el interior del cuadrilátero que el anillo que lo rodea (-1..1).
     Una hoja de papel suele ser más clara que lo que hay alrededor; se usa para no
     confundirla con un rectángulo más grande pero oscuro (mesa, carpeta, mantel). */
  function contrasteInterior(cv, gris, pts) {
    const mascara = cv.Mat.zeros(gris.rows, gris.cols, cv.CV_8UC1);
    const dilatada = new cv.Mat(), anillo = new cv.Mat();
    const k = cv.Mat.ones(9, 9, cv.CV_8U);
    const poli = cv.matFromArray(4, 1, cv.CV_32SC2, pts.flatMap(p => [Math.round(p.x), Math.round(p.y)]));
    try {
      cv.fillConvexPoly(mascara, poli, new cv.Scalar(255));
      cv.dilate(mascara, dilatada, k);
      cv.subtract(dilatada, mascara, anillo);
      const dentro = cv.mean(gris, mascara)[0], fuera = cv.mean(gris, anillo)[0];
      return Math.max(-1, Math.min(1, (dentro - fuera) / 128));
    } finally {
      [mascara, dilatada, anillo, k, poli].forEach(m => m.delete());
    }
  }

  /* Mejor cuadrilátero (la hoja) entre los contornos de una imagen binaria. */
  function buscarCuadrilatero(cv, binaria, areaTotal, gris) {
    const contornos = new cv.MatVector();
    const jerarquia = new cv.Mat();
    const candidatos = [];
    try {
      cv.findContours(binaria, contornos, jerarquia, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contornos.size(); i++) {
        const c = contornos.get(i);
        const area = cv.contourArea(c);
        // muy chico = ruido; casi todo el cuadro = el borde de la imagen, no la hoja
        if (area < areaTotal * AREA_MIN || area > areaTotal * 0.985) { c.delete(); continue; }

        let pts = null;
        const aprox = new cv.Mat();
        cv.approxPolyDP(c, aprox, 0.02 * cv.arcLength(c, true), true);
        if (aprox.rows === 4 && cv.isContourConvex(aprox)) {
          const d = aprox.data32S;
          pts = [0, 1, 2, 3].map(k => ({ x: d[k * 2], y: d[k * 2 + 1] }));
        } else {
          // Contorno picoteado (sombras, pliegues): envolvente convexa + rectángulo mínimo
          const hull = new cv.Mat();
          cv.convexHull(c, hull, false, true);
          const rect = cv.minAreaRect(hull);
          const areaRect = rect.size.width * rect.size.height;
          if (areaRect > 0 && cv.contourArea(hull) / areaRect > 0.82) pts = esquinasDeRectangulo(rect);
          hull.delete();
        }
        aprox.delete(); c.delete();
        if (pts) candidatos.push({ pts, area });
      }
    } finally {
      contornos.delete(); jerarquia.delete();
    }
    if (!candidatos.length) return null;
    // Se evalúan los 4 más grandes: gana el que parece hoja (más claro que su entorno), no solo el más grande
    candidatos.sort((a, b) => b.area - a.area);
    let mejor = null, mejorPuntaje = -Infinity;
    for (const cand of candidatos.slice(0, 4)) {
      const puntaje = cand.area * (1 + 3 * (gris ? contrasteInterior(cv, gris, cand.pts) : 0));
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = cand; }
    }
    return { esquinas: ordenarEsquinas(mejor.pts), area: mejor.area / areaTotal };
  }

  /* Detecta la hoja en un canvas (ya reducido). Devuelve {esquinas, area} o null. */
  function detectar(cv, canvas) {
    const src = cv.imread(canvas);
    const gris = new cv.Mat(), borroso = new cv.Mat(), bordes = new cv.Mat(), dil = new cv.Mat();
    const bin = new cv.Mat(), cerrado = new cv.Mat();
    const k3 = cv.Mat.ones(3, 3, cv.CV_8U), k7 = cv.Mat.ones(7, 7, cv.CV_8U);
    const total = canvas.width * canvas.height;
    try {
      cv.cvtColor(src, gris, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gris, borroso, new cv.Size(5, 5), 0);

      // Paso 1: contorno por bordes (hoja con borde definido)
      cv.Canny(borroso, bordes, 40, 120);
      cv.dilate(bordes, dil, k3, new cv.Point(-1, -1), 1);
      let r = buscarCuadrilatero(cv, dil, total, borroso);

      // Paso 2: hoja clara sobre fondo oscuro/lejano (umbral automático de Otsu)
      if (!r) {
        cv.threshold(borroso, bin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
        cv.morphologyEx(bin, cerrado, cv.MORPH_CLOSE, k7);
        r = buscarCuadrilatero(cv, cerrado, total, borroso);
      }

      // Paso 3: bordes tenues (hoja blanca sobre superficie clara): umbrales bajos y más engrosado
      if (!r) {
        cv.Canny(borroso, bordes, 12, 40);
        cv.dilate(bordes, dil, k3, new cv.Point(-1, -1), 2);
        r = buscarCuadrilatero(cv, dil, total, borroso);
      }
      return r;
    } finally {
      [src, gris, borroso, bordes, dil, bin, cerrado, k3, k7].forEach(m => m.delete());
    }
  }

  /* Endereza y recorta la hoja (corrección de perspectiva). */
  function enderezar(cv, canvasFuente, e) {
    const src = cv.imread(canvasFuente);
    let ancho = Math.round(Math.max(dist(e[0], e[1]), dist(e[3], e[2])));
    let alto = Math.round(Math.max(dist(e[0], e[3]), dist(e[1], e[2])));
    const escala = Math.min(1, LADO_MAX_SALIDA / Math.max(ancho, alto, 1));
    ancho = Math.max(50, Math.round(ancho * escala));
    alto = Math.max(50, Math.round(alto * escala));
    const origen = cv.matFromArray(4, 1, cv.CV_32FC2, [e[0].x, e[0].y, e[1].x, e[1].y, e[2].x, e[2].y, e[3].x, e[3].y]);
    const destino = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, ancho, 0, ancho, alto, 0, alto]);
    const M = cv.getPerspectiveTransform(origen, destino);
    const dst = new cv.Mat();
    try {
      cv.warpPerspective(src, dst, M, new cv.Size(ancho, alto), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      const salida = document.createElement('canvas');
      salida.width = ancho; salida.height = alto;
      cv.imshow(salida, dst);
      return salida;
    } finally {
      [src, origen, destino, M, dst].forEach(m => m.delete());
    }
  }

  /* Sin OpenCV: recorte por el rectángulo que contiene las esquinas (sin corregir perspectiva). */
  function recortarSimple(canvasFuente, e) {
    const xs = e.map(p => p.x), ys = e.map(p => p.y);
    const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
    const w = Math.min(canvasFuente.width, Math.max(...xs)) - x, h = Math.min(canvasFuente.height, Math.max(...ys)) - y;
    const salida = document.createElement('canvas');
    salida.width = Math.max(50, Math.round(w)); salida.height = Math.max(50, Math.round(h));
    salida.getContext('2d').drawImage(canvasFuente, x, y, w, h, 0, 0, salida.width, salida.height);
    return salida;
  }

  /* ───────── Filtros (sobre el canvas ya recortado) ───────── */
  function estirarNiveles(canvas, { gris }) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = datos.data, n = canvas.width * canvas.height;
    const canales = gris ? [0] : [0, 1, 2];
    if (gris) for (let i = 0, p = 0; i < n; i++, p += 4) px[p] = px[p + 1] = px[p + 2] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
    for (const c of canales) {
      const hist = new Uint32Array(256);
      for (let i = 0, p = c; i < n; i += 3, p += 12) hist[px[p] | 0]++;   // muestreo: 1 de cada 3 píxeles
      const total = hist.reduce((a, b) => a + b, 0);
      let acc = 0, lo = 0, hi = 255;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
      acc = 0;
      for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.10) { hi = v; break; } } // el papel: el 10% más claro queda blanco
      if (hi - lo < 30) continue; // imagen casi plana: no se toca
      const rango = hi - lo;
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = ((v - lo) / rango) * 255;
      if (gris) { for (let i = 0, p = 0; i < n; i++, p += 4) px[p] = px[p + 1] = px[p + 2] = lut[px[p]]; }
      else { for (let i = 0, p = c; i < n; i++, p += 4) px[p] = lut[px[p]]; }
    }
    ctx.putImageData(datos, 0, 0);
    return canvas;
  }

  function aplicarFiltro(canvas, filtro) {
    if (filtro === 'documento') return estirarNiveles(canvas, { gris: false });
    if (filtro === 'bn') return estirarNiveles(canvas, { gris: true });
    return canvas;
  }

  function girar(canvas, cuartos) {
    if (!cuartos) return canvas;
    const r = document.createElement('canvas');
    const vertical = cuartos % 2 === 1;
    r.width = vertical ? canvas.height : canvas.width;
    r.height = vertical ? canvas.width : canvas.height;
    const ctx = r.getContext('2d');
    ctx.translate(r.width / 2, r.height / 2);
    ctx.rotate(cuartos * Math.PI / 2);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return r;
  }

  /* ───────── Interfaz ───────── */
  let ui = null;
  let estado = null;   // { stream, cv, bucle, ... } mientras el escáner está abierto

  function construirUI() {
    const raiz = document.createElement('div');
    raiz.className = 'esc';
    raiz.hidden = true;
    raiz.innerHTML = `
      <section class="esc-vista" id="esc-camara">
        <div class="esc-top">
          <button type="button" class="esc-icono" id="esc-cerrar" aria-label="Cerrar"><i class="ti ti-x"></i></button>
          <span class="esc-estado" id="esc-estado" aria-live="polite">Abriendo cámara…</span>
          <button type="button" class="esc-icono" id="esc-linterna" aria-label="Linterna" hidden><i class="ti ti-bolt"></i></button>
        </div>
        <div class="esc-stage">
          <video id="esc-video" playsinline muted autoplay></video>
          <canvas id="esc-overlay"></canvas>
        </div>
        <div class="esc-bottom">
          <label class="esc-auto"><input type="checkbox" id="esc-auto"/> <span>Auto</span></label>
          <button type="button" class="esc-disparo" id="esc-disparo" aria-label="Tomar foto"><span></span></button>
          <span class="esc-relleno"></span>
        </div>
      </section>

      <section class="esc-vista" id="esc-editor" hidden>
        <div class="esc-top">
          <button type="button" class="esc-texto" id="esc-repetir"><i class="ti ti-arrow-back-up"></i> Repetir</button>
          <span class="esc-estado">Ajusta las esquinas</span>
          <button type="button" class="esc-texto" id="esc-todo"><i class="ti ti-maximize"></i> Toda la hoja</button>
        </div>
        <div class="esc-stage" id="esc-ed-stage"><canvas id="esc-ed-canvas"></canvas></div>
        <div class="esc-bottom esc-bottom-ed">
          <div class="esc-filtros" role="radiogroup" aria-label="Filtro">
            <button type="button" data-filtro="original" role="radio">Original</button>
            <button type="button" data-filtro="documento" role="radio" class="activo">Documento</button>
            <button type="button" data-filtro="bn" role="radio">B/N</button>
          </div>
          <button type="button" class="esc-icono" id="esc-girar" aria-label="Girar"><i class="ti ti-rotate-clockwise-2"></i></button>
          <button type="button" class="esc-listo" id="esc-listo"><i class="ti ti-check"></i> Listo</button>
        </div>
      </section>`;
    document.body.appendChild(raiz);
    const q = (id) => raiz.querySelector('#' + id);
    return {
      raiz, camara: q('esc-camara'), editor: q('esc-editor'),
      video: q('esc-video'), overlay: q('esc-overlay'), estado: q('esc-estado'),
      linterna: q('esc-linterna'), auto: q('esc-auto'), disparo: q('esc-disparo'),
      edStage: q('esc-ed-stage'), edCanvas: q('esc-ed-canvas'), listo: q('esc-listo'),
    };
  }

  function soportado() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext !== false);
  }

  function texto(msg) { if (ui) ui.estado.textContent = msg; }

  /* Rectángulo que ocupa el video dentro de su contenedor (object-fit: contain). */
  function rectVideo() {
    const v = ui.video, st = v.parentElement;
    const cw = st.clientWidth, ch = st.clientHeight, vw = v.videoWidth || 1, vh = v.videoHeight || 1;
    const e = Math.min(cw / vw, ch / vh);
    const w = vw * e, h = vh * e;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h, escala: e };
  }

  function dibujarOverlay(esquinasVideo, estable) {
    const c = ui.overlay, st = c.parentElement, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== st.clientWidth * dpr || c.height !== st.clientHeight * dpr) {
      c.width = st.clientWidth * dpr; c.height = st.clientHeight * dpr;
      c.style.width = st.clientWidth + 'px'; c.style.height = st.clientHeight + 'px';
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, st.clientWidth, st.clientHeight);
    if (!esquinasVideo) return;
    const r = rectVideo();
    const pts = esquinasVideo.map(p => ({ x: r.x + p.x * r.escala, y: r.y + p.y * r.escala }));
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = estable ? 'rgba(46,204,113,.28)' : 'rgba(255,200,60,.22)';
    ctx.strokeStyle = estable ? '#2ecc71' : '#ffc83c';
    ctx.lineWidth = 3;
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); });
  }

  /* ───────── Cámara en vivo ───────── */
  async function abrirCamara() {
    const intentos = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: true, audio: false },
    ];
    let ultimoError;
    for (const c of intentos) {
      try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) { ultimoError = e; }
    }
    throw ultimoError;
  }

  async function iniciarCamara() {
    texto('Abriendo cámara…');
    estado.stream = await abrirCamara();
    ui.video.srcObject = estado.stream;
    await ui.video.play().catch(() => {});
    // enfoque continuo y linterna, si el dispositivo los ofrece
    const pista = estado.stream.getVideoTracks()[0];
    const caps = (pista.getCapabilities && pista.getCapabilities()) || {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    if (caps.torch) {
      ui.linterna.hidden = false;
      let on = false;
      ui.linterna.onclick = () => { on = !on; pista.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); ui.linterna.classList.toggle('activo', on); };
    }
  }

  function detenerCamara() {
    if (estado && estado.stream) estado.stream.getTracks().forEach(t => t.stop());
    if (ui) ui.video.srcObject = null;
  }

  /* Bucle de detección en vivo. */
  function iniciarBucle() {
    const pequeno = document.createElement('canvas');
    let ultimo = 0, ocupado = false, estables = 0, suave = null, sinHoja = 0;

    const paso = (t) => {
      if (!estado || estado.vista !== 'camara') return;
      estado.raf = requestAnimationFrame(paso);
      if (ocupado || t - ultimo < INTERVALO_MS || !estado.cv || ui.video.readyState < 2 || !ui.video.videoWidth) return;
      ultimo = t; ocupado = true;
      try {
        const vw = ui.video.videoWidth, vh = ui.video.videoHeight;
        const k = LADO_DETECCION / Math.max(vw, vh);
        pequeno.width = Math.round(vw * k); pequeno.height = Math.round(vh * k);
        pequeno.getContext('2d', { willReadFrequently: true }).drawImage(ui.video, 0, 0, pequeno.width, pequeno.height);
        const r = detectar(estado.cv, pequeno);
        if (r) {
          sinHoja = 0;
          const nuevas = r.esquinas.map(p => ({ x: p.x / k, y: p.y / k }));
          const diag = Math.hypot(vw, vh);
          const mov = suave ? Math.max(...nuevas.map((p, i) => dist(p, suave[i]))) / diag : 1;
          // suavizado: evita que el contorno tiemble; si salta mucho, se reinicia
          suave = (suave && mov < 0.06) ? suave.map((p, i) => ({ x: p.x * 0.55 + nuevas[i].x * 0.45, y: p.y * 0.55 + nuevas[i].y * 0.45 })) : nuevas;
          estables = mov < MOVIMIENTO_MAX ? estables + 1 : 0;
          estado.quad = suave;
          const listo = estables >= CUADROS_ESTABLE;
          dibujarOverlay(suave, estables >= 3);
          texto(listo ? 'Hoja detectada' : estables >= 3 ? 'Mantén quieto…' : 'Enfoca la hoja completa');
          if (listo && ui.auto.checked) { capturar(); return; }
        } else if (++sinHoja >= 4) {
          suave = null; estables = 0; estado.quad = null;
          dibujarOverlay(null);
          texto('Busca la hoja: que se vean sus 4 esquinas');
        }
      } catch (err) {
        console.error('escáner: detección falló', err);
      } finally {
        ocupado = false;
      }
    };
    estado.raf = requestAnimationFrame(paso);
  }

  /* ───────── Captura y editor de esquinas ───────── */
  function capturar() {
    if (!estado || estado.vista !== 'camara') return;
    const v = ui.video;
    if (!v.videoWidth) return;
    const foto = document.createElement('canvas');
    foto.width = v.videoWidth; foto.height = v.videoHeight;
    foto.getContext('2d').drawImage(v, 0, 0);
    let esquinas = estado.quad;
    if (!esquinas) { // sin detección: se propone toda la imagen con un pequeño margen
      const mx = foto.width * 0.06, my = foto.height * 0.06;
      esquinas = [{ x: mx, y: my }, { x: foto.width - mx, y: my }, { x: foto.width - mx, y: foto.height - my }, { x: mx, y: foto.height - my }];
    }
    if (navigator.vibrate) navigator.vibrate(30);
    abrirEditor(foto, esquinas.map(p => ({ ...p })));
  }

  function abrirEditor(foto, esquinas) {
    estado.vista = 'editor';
    cancelAnimationFrame(estado.raf);
    ui.camara.hidden = true;
    ui.editor.hidden = false;
    estado.foto = foto; estado.esquinas = esquinas; estado.giro = 0;
    estado.filtro = estado.filtro || 'documento';
    ui.raiz.querySelectorAll('.esc-filtros button').forEach(b => b.classList.toggle('activo', b.dataset.filtro === estado.filtro));
    requestAnimationFrame(() => { ajustarCanvasEditor(); pintarEditor(); });
  }

  function ajustarCanvasEditor() {
    const st = ui.edStage, f = estado.foto, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const e = Math.min((st.clientWidth - 28) / f.width, (st.clientHeight - 28) / f.height);
    estado.ed = { escala: e, w: f.width * e, h: f.height * e, dpr };
    const c = ui.edCanvas;
    c.width = Math.round(estado.ed.w * dpr); c.height = Math.round(estado.ed.h * dpr);
    c.style.width = estado.ed.w + 'px'; c.style.height = estado.ed.h + 'px';
  }

  function pintarEditor() {
    const { escala, w, h, dpr } = estado.ed, c = ui.edCanvas, ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(estado.foto, 0, 0, w, h);
    const pts = estado.esquinas.map(p => ({ x: p.x * escala, y: p.y * escala }));
    // oscurece lo que queda fuera de la hoja
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h);
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill('evenodd');
    ctx.restore();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 2.5; ctx.stroke();
    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(46,204,113,.35)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    });
  }

  function enlazarArrastre() {
    const c = ui.edCanvas;
    let activo = -1;
    const punto = (ev) => { const r = c.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (ev) => {
      if (!estado || estado.vista !== 'editor') return;
      const p = punto(ev), e = estado.ed.escala;
      let mejor = -1, mejorD = 44; // radio táctil
      estado.esquinas.forEach((q, i) => { const d = Math.hypot(q.x * e - p.x, q.y * e - p.y); if (d < mejorD) { mejorD = d; mejor = i; } });
      activo = mejor;
      if (activo >= 0) { try { c.setPointerCapture(ev.pointerId); } catch { /* sin captura: el arrastre sigue funcionando dentro del canvas */ } }
    });
    c.addEventListener('pointermove', (ev) => {
      if (activo < 0 || !estado) return;
      const p = punto(ev), e = estado.ed.escala, f = estado.foto;
      estado.esquinas[activo] = { x: Math.min(f.width, Math.max(0, p.x / e)), y: Math.min(f.height, Math.max(0, p.y / e)) };
      pintarEditor();
    });
    const fin = () => { activo = -1; };
    c.addEventListener('pointerup', fin);
    c.addEventListener('pointercancel', fin);
  }

  async function confirmar() {
    if (!estado) return;
    ui.listo.disabled = true;
    ui.listo.innerHTML = '<i class="ti ti-loader-2 esc-gira"></i> Procesando…';
    await new Promise(r => setTimeout(r, 30)); // deja pintar el estado
    try {
      const e = ordenarEsquinas(estado.esquinas);
      let hoja = estado.cv ? enderezar(estado.cv, estado.foto, e) : recortarSimple(estado.foto, e);
      hoja = aplicarFiltro(hoja, estado.filtro);
      hoja = girar(hoja, estado.giro);
      const blob = await new Promise(res => hoja.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) throw new Error('No se pudo generar la imagen.');
      const archivo = new File([blob], 'escaneo.jpg', { type: 'image/jpeg' });
      const cb = estado.onListo;
      cerrar();
      if (cb) cb(archivo);
    } catch (err) {
      console.error('escáner: no se pudo procesar', err);
      texto('No se pudo procesar. Ajusta las esquinas e inténtalo de nuevo.');
      ui.listo.disabled = false;
      ui.listo.innerHTML = '<i class="ti ti-check"></i> Listo';
    }
  }

  function volverACamara() {
    estado.vista = 'camara';
    estado.quad = null;
    ui.editor.hidden = true;
    ui.camara.hidden = false;
    ui.listo.disabled = false;
    ui.listo.innerHTML = '<i class="ti ti-check"></i> Listo';
    dibujarOverlay(null);
    texto('Enfoca la hoja completa');
    iniciarBucle();
  }

  /* ───────── Abrir / cerrar ───────── */
  async function abrir({ onListo } = {}) {
    if (!ui) {
      ui = construirUI();
      ui.raiz.querySelector('#esc-cerrar').addEventListener('click', cerrar);
      ui.disparo.addEventListener('click', capturar);
      ui.raiz.querySelector('#esc-repetir').addEventListener('click', volverACamara);
      ui.raiz.querySelector('#esc-todo').addEventListener('click', () => {
        const f = estado.foto, m = Math.min(f.width, f.height) * 0.02;
        estado.esquinas = [{ x: m, y: m }, { x: f.width - m, y: m }, { x: f.width - m, y: f.height - m }, { x: m, y: f.height - m }];
        pintarEditor();
      });
      ui.raiz.querySelector('#esc-girar').addEventListener('click', () => { estado.giro = (estado.giro + 1) % 4; });
      ui.raiz.querySelectorAll('.esc-filtros button').forEach(b => b.addEventListener('click', () => {
        estado.filtro = b.dataset.filtro;
        ui.raiz.querySelectorAll('.esc-filtros button').forEach(x => x.classList.toggle('activo', x === b));
      }));
      ui.listo.addEventListener('click', confirmar);
      ui.auto.addEventListener('change', () => { try { localStorage.setItem('sbis_escaner_auto', ui.auto.checked ? '1' : '0'); } catch { /* sin storage */ } });
      window.addEventListener('resize', () => { if (estado && estado.vista === 'editor') { ajustarCanvasEditor(); pintarEditor(); } });
      enlazarArrastre();
    }
    let auto = true;
    try { auto = localStorage.getItem('sbis_escaner_auto') !== '0'; } catch { /* sin storage */ }
    ui.auto.checked = auto;

    estado = { vista: 'camara', onListo, cv: null, quad: null, filtro: 'documento', giro: 0 };
    ui.raiz.hidden = false;
    ui.camara.hidden = false; ui.editor.hidden = true;
    document.documentElement.classList.add('esc-abierto');

    try {
      await iniciarCamara();
    } catch (err) {
      console.error('escáner: sin cámara', err);
      cerrar();
      alert('No se pudo abrir la cámara. Revisa el permiso del navegador, o usa el botón "Cámara del teléfono".');
      return;
    }
    texto('Preparando detección…');
    iniciarBucle();
    cargarOpenCV().then(c => {
      if (!estado) return;
      estado.cv = c;
      if (estado.vista === 'camara') texto('Enfoca la hoja completa');
    }).catch(err => {
      console.warn('escáner: sin OpenCV, modo manual', err);
      if (estado && estado.vista === 'camara') texto('Sin detección automática: toma la foto y ajusta las esquinas');
    });
  }

  function cerrar() {
    if (estado) { cancelAnimationFrame(estado.raf); detenerCamara(); }
    if (ui) ui.raiz.hidden = true;
    document.documentElement.classList.remove('esc-abierto');
    estado = null;
  }

  window.EscanerDoc = {
    soportado, abrir, cerrar,
    // expuesto para pruebas
    _interno: { cargarOpenCV, detectar, enderezar, aplicarFiltro, ordenarEsquinas },
  };
})();
