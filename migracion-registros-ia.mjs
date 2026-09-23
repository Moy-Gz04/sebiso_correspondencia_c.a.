import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS oficios_pendientes_ia (
      id           SERIAL PRIMARY KEY,
      imagen       BYTEA NOT NULL,
      imagen_mime  VARCHAR(50) NOT NULL,
      estado       VARCHAR(20) NOT NULL DEFAULT 'procesando'
                     CHECK (estado IN ('procesando','listo','error')),
      datos_json   JSONB,
      error_mensaje TEXT,
      usado        BOOLEAN NOT NULL DEFAULT FALSE,
      creado_por   VARCHAR(150) NOT NULL,
      creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pendientes_ia_estado ON oficios_pendientes_ia (usado, creado_en DESC)`;

  console.log('Migración OK: tabla oficios_pendientes_ia creada.');
}

main().catch(err => { console.error(err); process.exit(1); });
