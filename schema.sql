-- ═══════════════════════════════════════════════════
--  SBIS — Esquema de base de datos
--  Ejecutar en NeonDB (SQL Editor)
-- ═══════════════════════════════════════════════════

-- Tabla principal de oficios
CREATE TABLE IF NOT EXISTS oficios (
  id              SERIAL PRIMARY KEY,
  n_control       VARCHAR(20)  NOT NULL UNIQUE,
  f_sello         DATE,
  f_oficio        DATE,
  dias_entrega    INTEGER      DEFAULT 0,
  numero          VARCHAR(60),
  n_referencia    VARCHAR(80),
  remitente       VARCHAR(120) NOT NULL,
  dependencia     VARCHAR(120) NOT NULL,
  instruccion     TEXT,
  descripcion     TEXT,
  f_registro      DATE         DEFAULT CURRENT_DATE,
  hora_recibido   TIME,
  folio_despacho  VARCHAR(40),
  turnado_a       VARCHAR(120),
  estatus         VARCHAR(20)  NOT NULL DEFAULT 'recibido'
                  CHECK (estatus IN ('recibido','proceso','turnado','atendido')),
  obs_area        TEXT,
  obs_admin       TEXT,
  ruta_doc1       VARCHAR(255),
  ruta_doc2       VARCHAR(255),
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_oficios_estatus    ON oficios (estatus);
CREATE INDEX IF NOT EXISTS idx_oficios_f_sello    ON oficios (f_sello DESC);
CREATE INDEX IF NOT EXISTS idx_oficios_remitente  ON oficios (remitente);
CREATE INDEX IF NOT EXISTS idx_oficios_created_at ON oficios (created_at DESC);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_oficios_updated_at
BEFORE UPDATE ON oficios
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Vista útil para reportes
CREATE OR REPLACE VIEW v_oficios_resumen AS
SELECT
  id,
  n_control,
  remitente,
  dependencia,
  f_sello,
  f_oficio,
  dias_entrega,
  estatus,
  turnado_a,
  created_at
FROM oficios
ORDER BY created_at DESC;

-- ══════════════════════════════════════════════════════
-- Módulo: Salas (dentro de Coordinación)
-- Catálogo de salas + apartados por fecha/hora. Cada
-- apartado es un bloque fijo de 1 hora; la restricción
-- UNIQUE (sala_id, fecha, hora) impide traslapes: no se
-- puede apartar la misma sala en el mismo horario dos veces.
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS salas (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(150) NOT NULL UNIQUE,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salas_apartados (
  id          SERIAL PRIMARY KEY,
  sala_id     INTEGER NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  hora        TIME NOT NULL,
  personas    INTEGER NOT NULL DEFAULT 1,
  descripcion TEXT,
  no_oficio   VARCHAR(60),
  creado_por  VARCHAR(150),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sala_id, fecha, hora)
);

CREATE INDEX IF NOT EXISTS idx_salas_apartados_fecha ON salas_apartados (fecha);

-- Historial de apartados eliminados (por vencimiento o cancelación manual),
-- para dejar rastro de quién ocupó cada sala y cuándo se quitó la tarjeta.
CREATE TABLE IF NOT EXISTS salas_historial (
  id                  SERIAL PRIMARY KEY,
  sala_id             INTEGER,
  sala_nombre         VARCHAR(150) NOT NULL,
  fecha               DATE NOT NULL,
  hora                TIME NOT NULL,
  personas            INTEGER,
  descripcion         TEXT,
  no_oficio           VARCHAR(60),
  creado_por          VARCHAR(150),
  motivo_eliminacion  VARCHAR(20) NOT NULL CHECK (motivo_eliminacion IN ('vencido','cancelado','sala_eliminada')),
  eliminado_por       VARCHAR(150),
  eliminado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);