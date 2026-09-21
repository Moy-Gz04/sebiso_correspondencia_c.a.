import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function main() {
  // La última Nota real (en papel) fue la 0076 -> la secuencia arranca en 77
  // para que la primera generada por el sistema sea 0077.
  await sql`CREATE SEQUENCE IF NOT EXISTS nota_seq START 77`;

  await sql`ALTER TABLE salas_apartados ADD COLUMN IF NOT EXISTS prestamo TEXT`;
  await sql`ALTER TABLE salas_apartados ADD COLUMN IF NOT EXISTS folio_nota VARCHAR(10)`;
  await sql`ALTER TABLE salas_apartados ADD COLUMN IF NOT EXISTS nota_pdf_url TEXT`;

  await sql`ALTER TABLE salas_historial ADD COLUMN IF NOT EXISTS prestamo TEXT`;
  await sql`ALTER TABLE salas_historial ADD COLUMN IF NOT EXISTS folio_nota VARCHAR(10)`;
  await sql`ALTER TABLE salas_historial ADD COLUMN IF NOT EXISTS nota_pdf_url TEXT`;

  console.log('Migración OK: nota_seq creada, columnas prestamo/folio_nota/nota_pdf_url agregadas.');
}

main().catch(err => { console.error(err); process.exit(1); });
