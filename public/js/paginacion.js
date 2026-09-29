/* ════════════════════════════════════════════════════
   LISTAS POR PARTES (compartido)
   Para no descargar ni dibujar cientos de registros de golpe: se piden
   15 al servidor y los siguientes llegan solos al acercarse al final de
   la lista (o con el botón «Cargar más»). La búsqueda y los filtros los
   resuelve el servidor, así que cada cambio vuelve a pedir desde el inicio.

   Lo usan: Bandeja de oficios (area.js), bandeja del usuario (usuario.js),
   No. de Oficio, No. Circular, No. Tarjeta Informativa y Minutario.

   crearPaginador({
     contenedor: 'lista' | 'tabla-body',  // id del elemento donde van los registros
     url: (desde, limite) => '…',          // URL con los filtros actuales
     pedir: (url) => Promise<Response>,    // fetch con la sesión (apiFetch, etc.)
     pintar: (item, indice) => '<…>',      // HTML de un registro
     columnas: 8,                          // solo tablas: colspan de la fila «Cargar más»
     vacio: () => '<…>',                   // HTML cuando no hay nada
     alRecibir: (data, esPrimera) => {},   // contadores, badges, etc.
   })
   Devuelve { reiniciar, cargarMas, refrescar, items, total }.
   El servidor responde { items, total, siguiente, ... }.
   ════════════════════════════════════════════════════ */
function crearPaginador(cfg) {
  const porPagina = cfg.porPagina || 15;
  const esTabla = !!cfg.columnas;
  const p = { items: [], total: 0 };
  let siguiente = 0, peticion = 0, cargando = false;

  const obs = 'IntersectionObserver' in window
    ? new IntersectionObserver(e => { if (e.some(x => x.isIntersecting)) p.cargarMas(); }, { rootMargin: '400px 0px' })
    : null;

  function cont() { return document.getElementById(cfg.contenedor); }

  function pintarFin() {
    cont().querySelector('[data-fin-lista]')?.remove();
    if (!p.items.length || siguiente === null) return;
    const faltan = Math.min(porPagina, p.total - p.items.length);
    const boton = `<button type="button" class="btn-cargar-mas" data-btn-mas><i class="ti ti-chevrons-down"></i> Cargar ${faltan} más</button>`;
    cont().insertAdjacentHTML('beforeend', esTabla
      ? `<tr data-fin-lista class="fila-cargar-mas"><td colspan="${cfg.columnas}"><div class="cargar-mas-wrap">${boton}</div></td></tr>`
      : `<div data-fin-lista class="cargar-mas-wrap">${boton}</div>`);
    const fin = cont().querySelector('[data-fin-lista]');
    fin.querySelector('[data-btn-mas]').onclick = () => p.cargarMas();
    obs?.observe(fin);
  }

  function pintar(desde) {
    const el = cont();
    el.querySelector('[data-fin-lista]')?.remove();
    if (!p.items.length) { el.innerHTML = cfg.vacio(); return; }
    const html = p.items.slice(desde).map((r, k) => cfg.pintar(r, desde + k)).join('');
    if (desde > 0) el.insertAdjacentHTML('beforeend', html); else el.innerHTML = html;
    pintarFin();
  }

  /* Vuelve a pedir desde el principio (al abrir o al cambiar filtro/búsqueda) */
  p.reiniciar = function (mensajeCarga = true) {
    p.items = []; p.total = 0; siguiente = 0; cargando = false;
    const mia = ++peticion;
    if (mensajeCarga) {
      cont().innerHTML = esTabla
        ? `<tr class="fila-vacia"><td colspan="${cfg.columnas}"><i class="ti ti-loader-2 spin"></i> Cargando registros...</td></tr>`
        : `<div class="cargando-msg"><i class="ti ti-loader-2 spin"></i> Cargando registros...</div>`;
    }
    return p.cargarMas(mia);
  };

  /* Pide la siguiente parte y la agrega al final */
  p.cargarMas = async function (mia = peticion) {
    if (cargando || siguiente === null) return;
    cargando = true;
    const boton = cont().querySelector('[data-btn-mas]');
    if (boton) { boton.disabled = true; boton.innerHTML = '<i class="ti ti-loader-2 spin"></i> Cargando…'; }
    try {
      const res = await cfg.pedir(cfg.url(siguiente, porPagina));
      const data = await res.json();
      if (!res.ok) throw new Error(data?.mensaje || 'No se pudieron cargar los registros.');
      if (mia !== peticion) return;           // cambió el filtro mientras llegaba
      const desde = p.items.length;
      const esPrimera = desde === 0;
      p.items = p.items.concat(data.items);
      p.total = data.total;
      siguiente = data.siguiente;
      cfg.alRecibir?.(data, esPrimera);
      pintar(desde);
    } catch (err) {
      if (mia !== peticion) return;
      if (!p.items.length) {
        cont().innerHTML = esTabla
          ? `<tr class="fila-vacia"><td colspan="${cfg.columnas}">No se pudo conectar con el servidor.</td></tr>`
          : `<div class="cargando-msg error"><i class="ti ti-alert-circle"></i> No se pudo conectar con el servidor.</div>`;
      } else if (boton) {
        boton.disabled = false; boton.textContent = 'No se pudo cargar. Intentar de nuevo';
      }
    } finally {
      if (mia === peticion) cargando = false;
    }
  };

  /* Vuelve a pedir lo que ya se ve (hasta 50) y actualiza esos registros
     sin perder la posición — para refrescos silenciosos. */
  p.refrescar = async function () {
    const n = Math.min(50, Math.max(p.items.length, porPagina));
    try {
      const res = await cfg.pedir(cfg.url(0, n));
      if (!res.ok) return false;
      const data = await res.json();
      const porId = new Map(data.items.map(o => [o.id, o]));
      p.items = p.items.map(o => porId.get(o.id) || o);
      cfg.alRecibir?.(data, false);
      pintar(0);
      return true;
    } catch { return false; }
  };

  return p;
}
