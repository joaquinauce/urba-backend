# Scripts SQL de BeUrba

Los cambios estructurales de PostgreSQL se versionan en esta carpeta y se
ejecutan manualmente. TypeORM no ejecuta migraciones ni sincroniza el esquema.

## Orden de ejecución

1. Obtener un backup verificable de la base objetivo.
2. Confirmar que se está conectado a la base y al esquema `public` correctos.
3. Revisar el script completo.
4. Elegir exactamente un camino:
   - Si no existe `public.roles`, ejecutar
     `20261103_001_roles_y_asignaciones_multiples.sql` una sola vez.
   - Si existen `roles`, `administrator_roles`, `foreman_roles` y
     `work_foreman_assignments` del borrador anterior, ejecutar solamente
     `20261103_002_convertir_borrador_roles_al_esquema_final.sql`.
5. Una vez disponible el esquema final de personas, ejecutar
   `20261103_003_trazabilidad_responsable_informes.sql` para agregar la
   identificación personal de quien presenta cada informe.
6. Comprobar la fila de conteos que devuelve cada script al final.
7. Para la versión con login de jefes de obra y administradores adicionales,
   ejecutar `database/003_people_credentials.sql` después de preparar `people`.
8. Para rendición de gastos, revisar y ejecutar manualmente
   `20261109_001_expense_reports.sql` después de instalar el esquema de personas.
   Crea tipos y rendiciones y precarga cuatro tipos por administrador. La API
   precarga esos tipos al primer acceso de administradores creados después.
   No modifica rendiciones existentes.

No debe continuarse con otro script si PostgreSQL informa una excepción. El
script usa una única transacción; cualquier precondición o control posterior
fallido revierte todos sus cambios.

## Resultado esperado de la versión 001

- Exactamente tres roles: `ADMINISTRATOR`, `SITE_MANAGER` y `FOREMAN`.
- Una persona y un rol por cada administrador o capataz existente.
- Una asignación `FOREMAN` primaria por cada obra, idéntica a
  `works.foreman_id`.
- Estructura preparada para múltiples jefes y capataces por obra, y múltiples
  obras por persona, conservando ciclos históricos de asignación.
- Un UUID independiente por asignación y unicidad parcial solo mientras la
  asignación permanece activa.
- Campos de autenticación personal preparados en `people`; los registros
  heredados quedan sin PIN, sin bloqueo, sin intentos fallidos y con versión de
  sesión cero.
- Ninguna modificación en las tablas ni filas heredadas.

La aplicación continuará usando `works.foreman_id` hasta que una fase posterior
sea autorizada para consumir `work_assignments`. Los jefes de obra todavía no
se precargan porque no existe una fuente heredada que permita identificarlos.

La versión 002 copia y verifica todos los datos del borrador antes de retirar
sus tres tablas de asociación. Una excepción revierte también esos retiros.

## Resultado esperado de la versión 003

- `daily_reports.submitted_by_person_id` existe como UUID nullable.
- La FK compuesta hacia `people(administrator_id, id)` impide referencias
  huérfanas y referencias cruzadas entre administradores.
- `foreman_id` y `foreman_name_snapshot` permanecen intactos.
- Todos los informes preexistentes conservan `submitted_by_person_id = NULL`;
  el script no intenta inferir identidades.
- El índice parcial `daily_reports_submitted_by_person_idx` cubre únicamente
  informes con una identidad personal registrada.

La fila final debe informar el mismo valor en `total_informes_preservados` e
`informes_historicos_sin_identidad`, y cero en
`informes_con_responsable_personal`. Las nuevas presentaciones hechas con un
código personal comenzarán a completar la columna después de desplegar el
backend actualizado. El acceso legado seguirá dejando la columna en `NULL` y
conservará el nombre histórico en `foreman_name_snapshot`.

## Integración de escritura durante el desarrollo

La suite utiliza la conexión `DB_*` existente y no ejecuta ninguno de estos
scripts SQL. Antes de habilitarla se debe verificar un backup reciente y
configurar explícitamente en `.env`:

```dotenv
DB_NAME=Urba
ALLOW_DEV_DB_WRITES=true
CONFIRM_RECENT_BACKUP=true
```

Después puede ejecutarse:

```bash
npm run test:integration:write
```

El runner aborta antes de conectarse si falta cualquiera de esas condiciones.
No ejecuta DDL, migraciones TypeORM ni `synchronize`. Cada ejecución crea dos
administradores claramente identificados como `[E2E <id>]`, con UUID
aleatorios y todos sus datos relacionados. Al finalizar elimina exclusivamente
las filas pertenecientes a esos UUID y verifica que no queden administradores
de la corrida.
