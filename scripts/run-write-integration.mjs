import { spawnSync } from 'node:child_process';

const required = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET',
  'PERSON_CODE_HMAC_SECRET',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Faltan variables requeridas: ${missing.join(', ')}`);
  process.exit(2);
}

const database = process.env.DB_NAME;
const port = Number(process.env.DB_PORT);
if (database !== 'Urba') {
  console.error(
    'DB_NAME debe ser exactamente Urba para esta suite de desarrollo.',
  );
  process.exit(2);
}
if (process.env.ALLOW_DEV_DB_WRITES !== 'true') {
  console.error('Falta la habilitación explícita ALLOW_DEV_DB_WRITES=true.');
  process.exit(2);
}
if (process.env.CONFIRM_RECENT_BACKUP !== 'true') {
  console.error(
    'Confirmá un backup reciente mediante CONFIRM_RECENT_BACKUP=true.',
  );
  process.exit(2);
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error('DB_PORT no es válido.');
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

console.log(
  `Integración de escritura habilitada: ${process.env.DB_USER}@${process.env.DB_HOST}:${port}/${database}`,
);
const testExitCode = run(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--config',
    './vitest.config.e2e.ts',
    'src/postgres-write.e2e-spec.ts',
  ],
  {
    env: { ...process.env, RUN_PG_WRITE_INTEGRATION: 'true' },
  },
);
process.exitCode = testExitCode;
