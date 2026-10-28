import { Client } from 'pg';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

if (!process.env.DB_PASSWORD) {
  console.error('Falta DB_PASSWORD en backend/.env. Es la contraseña del usuario de PostgreSQL (DB_USER), no la contraseña del administrador de Urba.');
  process.exit(1);
}

const input = createInterface({input:process.stdin,output:process.stdout});
const email = (await input.question('Email del primer administrador: ')).trim().toLowerCase();
const fullName = (await input.question('Nombre completo: ')).trim();
input.close();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 160) throw new Error('Email o nombre inválido');

process.stdout.write('Contraseña (mínimo 12 caracteres): ');
const adminPassword = await new Promise((resolve,reject) => {
  if (!process.stdin.isTTY) return reject(new Error('Se requiere una terminal interactiva'));
  let value='';
  process.stdin.setRawMode(true); process.stdin.resume();
  const onData = chunk => {
    for (const char of chunk.toString()) {
      if (char === '\r' || char === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data',onData); process.stdout.write('\n'); resolve(value); return; }
      if (char === '\u0003') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data',onData); process.stdout.write('\n'); reject(new Error('Cancelado')); return; }
      if (char === '\u007f' || char === '\b') value=value.slice(0,-1);
      else if (char >= ' ') value+=char;
    }
  };
  process.stdin.on('data',onData);
});
if (adminPassword.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres');

const client = new Client({host:process.env.DB_HOST ?? 'localhost',port:Number(process.env.DB_PORT ?? 5432),user:process.env.DB_USER ?? 'postgres',password:process.env.DB_PASSWORD,database:process.env.DB_NAME ?? 'urba',ssl:process.env.DB_SSL === 'true' ? {rejectUnauthorized:true} : false});
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('LOCK TABLE administrators IN EXCLUSIVE MODE');
  const {rows} = await client.query('SELECT count(*)::integer AS count FROM administrators');
  if (rows[0].count !== 0) throw new Error('Ya existe un administrador; la inicialización sólo puede ejecutarse una vez');
  await client.query('INSERT INTO administrators(id,email,password_hash,full_name) VALUES($1,$2,$3,$4)',[randomUUID(),email,await hash(adminPassword,12),fullName]);
  await client.query('COMMIT');
  process.stdout.write('Administrador creado correctamente.\n');
} catch(error) {
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
} finally { await client.end(); }
