// ============================================================
// SBIS — Seed de Usuarios
// Uso: node seed-users.js
// Requiere: npm install bcryptjs @neondatabase/serverless dotenv
// ============================================================

import bcrypt from 'bcryptjs';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config();

const sql = neon(process.env.DATABASE_URL);
const SALT_ROUNDS = 12;

// ------------------------------------------------------------
// Definición de usuarios
// Cambia las contraseñas ANTES de ejecutar en producción
// ------------------------------------------------------------
const usuarios = [
  {
    username: 'admin',
    password: 'Admin2026!',
    area: null,
    rol: 'admin',
  },
  {
    username: 'coord',
    password: 'Coord2026!',
    area: 'Coordinación Administrativa',
    rol: 'area',
  },
  {
    username: 'rhumanos',
    password: 'RH2026!',
    area: 'R. Humanos',
    rol: 'area',
  },
  {
    username: 'rfinanzas',
    password: 'RF2026!',
    area: 'R. Financieros',
    rol: 'area',
  },
  {
    username: 'auditorias',
    password: 'Aud2026!',
    area: 'Seguimiento de Auditorías',
    rol: 'area',
  },
  {
    username: 'informatica',
    password: 'Info2026!',
    area: 'Informática',
    rol: 'area',
  },
  {
    username: 'rmateriales',
    password: 'RM2026!',
    area: 'R. Materiales',
    rol: 'area',
  },
  {
    username: 'archivo',
    password: 'Arch2026!',
    area: 'Archivo',
    rol: 'area',
  },
  {
    username: 'transparen',
    password: 'Trans2026!',
    area: 'Transparencia',
    rol: 'area',
  },
];

// ------------------------------------------------------------
// Función principal
// ------------------------------------------------------------
async function seedUsuarios() {
  console.log('🌱 Iniciando seed de usuarios SBIS...\n');

  let insertados = 0;
  let omitidos = 0;

  for (const u of usuarios) {
    try {
      // Verificar si ya existe
      const existe = await sql`
        SELECT id FROM usuarios WHERE username = ${u.username}
      `;

      if (existe.length > 0) {
        console.log(`⚠️  Usuario "${u.username}" ya existe — omitido`);
        omitidos++;
        continue;
      }

      // Hashear contraseña
      const hash = await bcrypt.hash(u.password, SALT_ROUNDS);

      // Insertar
      await sql`
        INSERT INTO usuarios (username, password, area, rol)
        VALUES (${u.username}, ${hash}, ${u.area}, ${u.rol})
      `;

      const areaLabel = u.area ?? '(admin global)';
      console.log(`✅ Insertado: ${u.username.padEnd(12)} | ${areaLabel}`);
      insertados++;

    } catch (err) {
      console.error(`❌ Error con usuario "${u.username}":`, err.message);
    }
  }

  console.log(`\n📊 Resultado: ${insertados} insertados, ${omitidos} omitidos`);
  console.log('\n🔐 Contraseñas iniciales (cámbialas en producción):');
  usuarios.forEach(u => {
    console.log(`   ${u.username.padEnd(12)} → ${u.password}`);
  });
  console.log('\n✨ Seed completado.\n');
  process.exit(0);
}

seedUsuarios().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});