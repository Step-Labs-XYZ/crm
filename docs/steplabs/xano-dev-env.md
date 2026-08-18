# El entorno dev de Xano, y cómo conectarse desde cualquier máquina

Runbook de Step Labs. FundReporting corre sobre **Xano**, y hasta el 2026-08-18 existía
**una sola** base: producción. Este documento describe el entorno `dev` que se creó para
poder desarrollar sin tocar datos reales, y todo lo que hace falta para conectarse desde
otra computadora.

> Aplica a los dos proyectos: este CRM (el handoff de `apps/api/src/fundreporting/`) y
> `fundreporting-v2` (el Next.js que consume Xano).

---

## 1. Qué existe hoy en Xano

Instancia (cuenta **del cliente**): `xjcl-a4qe-ykfx.f2.xano.io`
Workspace: **`fundreporting-nextjs`** (id `4`) — 44 tablas.

| Data source | Uso | Estado |
| --- | --- | --- |
| `live` | **producción** — cartera real, cap tables, KYC | intocable |
| `dev` | desarrollo | creado 2026-08-18 |

Branches de lógica: solo **`v1`** (live). **No se creó branch dev todavía** — ver §6.

**Qué significa un data source.** En Xano el *schema* (las 44 tablas) y la *lógica*
(endpoints, funciones) viven a nivel workspace/branch y se **comparten**; el data source
solo separa **los datos**. Verificado al crearlo:

```
              live    dev
tablas          44     44     <- mismo schema
asset_manager   10      0
currency        47      0
fund            36      0     <- datos aislados
```

### Consecuencia importante (leer antes de tocar nada)

Como la **lógica y las API keys externas son compartidas con `live`**, el data source `dev`
aísla los datos pero **no** aísla:

- **Resend** (emails). Un flujo de envío masivo en dev mandaría correos **reales** a
  inversionistas reales. Un OTP a tu propia casilla es inofensivo; los envíos masivos no.
- **EODHD**, Google Maps, Anthropic, y cualquier webhook configurado.
- Cambiar un endpoint en la branch `v1` **cambia producción**.

**Reglas de oro:** trabajar siempre apuntando a `dev`; no disparar flujos de email masivo;
no editar endpoints/funciones de la branch `v1` sin branch dev (§6).

---

## 2. Credenciales, y dónde viven

Nada de esto se commitea. En cada máquina va en el store del harness,
`~/.config/step-labs-harness/secrets.env` (modo `600`):

| Clave | Para qué |
| --- | --- |
| `SL_SECRET_STEP_LABS_XANO_FUNDREPORTING_META` | **Metadata API token** — inspeccionar/administrar Xano (schema, data sources, seeding). No lo usan las apps. |

Para poner el token en otra máquina, sin que quede en el historial del shell:

```bash
read -rs XANO && \
  echo "SL_SECRET_STEP_LABS_XANO_FUNDREPORTING_META=$XANO" >> ~/.config/step-labs-harness/secrets.env && \
  unset XANO && echo ok
```

Verificar que funciona (solo lectura):

```bash
TOKEN=$(grep -E '^SL_SECRET_STEP_LABS_XANO_FUNDREPORTING_META=' \
  ~/.config/step-labs-harness/secrets.env | cut -d= -f2-)
curl -sS -H "Authorization: Bearer $TOKEN" \
  https://xjcl-a4qe-ykfx.f2.xano.io/api:meta/workspace/4/datasource
# esperado: [{"label":"live",...},{"label":"dev",...}]
```

**Todavía falta** (hay que pedírselo al cliente, ver `fundreporting-handoff.md`):

- `PLATFORM_SERVICE_TOKEN` con permiso de **escritura** sobre `investor_lead` — sin él el
  handoff del CRM no puede filar. El `XANO_PROXY_SECRET` **no sirve**: es el secreto del
  proxy de login, y lo que emite es la sesión de *una persona*.
- El **UUID de asset manager** por workspace (`organization.assetManagerId`).

---

## 3. Cómo se apunta una app a `dev`

Las llamadas a la API de Xano seleccionan la base con el header:

```
X-Data-Source: dev
```

Sin ese header, Xano usa `live`. Es decir: **omitirlo es pegarle a producción.**

Estado del cableado (a 2026-08-18): **pendiente en ambos repos.**

- **fundreporting-v2** — hoy cada `fetch()` a Xano arma sus headers inline (≈235
  referencias, sin cliente compartido). Para apuntar a dev hay que introducir un helper
  único (p. ej. `lib/xano.ts`) que agregue `X-Data-Source` desde una env var y que todas
  las rutas usen. Recomendado hacerlo junto con el **kill-switch read-only** que hoy no
  existe. Env sugerida: `XANO_DATA_SOURCE=dev`.
- **CRM** — un solo cliente (`apps/api/src/fundreporting/platform.client.ts`), así que es
  un cambio de una línea en `call()`: agregar el header cuando la env esté seteada.
  Env sugerida: `PLATFORM_DATA_SOURCE=dev`.

Hasta que eso exista, **ninguna app está apuntando a `dev`** — fundreporting-v2 sigue
hablando con `live`. No correr mutaciones desde la app mientras tanto.

---

## 4. Sembrar datos en `dev`

`dev` nace **vacío**, así que la app no tiene ni con qué loguear. La política acordada:

- ✅ **Copiar las tablas catálogo** desde `live` (`currency`, `country`, `asset_class`,
  `transaction_type`): datos de referencia, sin PII, y sin ellos casi nada funciona.
  Se preservan los `id` para no romper foreign keys.
- ✅ **Crear a mano** 1 `asset_manager`, 1 `fund` y 1 `user` de prueba, **ficticios**.
- ❌ **Nunca** copiar la cartera real: inversionistas, `cap_table_*`, `compliance_*`,
  documentos.

El script `xano-seed-dev.mjs` (en `steplabs/preview-demo/`, junto al runbook local) hace
la parte de catálogos. Escribe siempre con `X-Data-Source: dev` — la constante está
fijada en el código — y es idempotente: si la tabla ya tiene filas en dev, la omite.

```bash
node xano-seed-dev.mjs --dry-run   # muestra qué haría
node xano-seed-dev.mjs             # siembra
```

> Nota: el auto-mode de Claude Code bloquea los POST a APIs externas, así que este
> script lo corre una persona (o se habilita una regla de permisos en `settings.json`).

---

## 5. Levantar los dos proyectos en otra máquina

Recetas completas en `steplabs/preview-demo/README.md`. Resumen:

| Proyecto | URL local | Datos |
| --- | --- | --- |
| **CRM** (este repo) | `:3200` app · `:3001` API · `:2000` agent | Postgres **local** (`crm`) |
| **fundreporting-v2** | `:3000` | Xano (remoto) |

Puntos que muerden en una máquina nueva (verificados en WSL):

- **Bun** es el gestor del CRM (`packageManager: bun@1.3.12`). Si el instalador oficial
  falla por falta de `unzip`: `npm i -g bun@1.3.12`.
- **`turbo run dev` exige TTY** ("Cannot run interactive task without Terminal UI"), así
  que los scripts levantan cada app por separado en vez de `turbo run dev`.
- **DB del CRM**: no hace falta Docker. Sirve un Postgres local: crear la base `crm`,
  `bunx prisma db push` y `bunx prisma db seed` dentro de `packages/db`.
- El CRM app corre en **`:3200`** para no chocar con fundreporting-v2 en `:3000`. Como el
  app proxya `/api/*` al API server-to-server, no hay problema de CORS; solo hay que
  declarar `APP_URL` para los `trustedOrigins` de better-auth.
- `fundreporting-v2` necesita su `.env.local` (no está en git): pedírselo a un compañero
  o regenerarlo desde el gestor de secretos.

---

## 6. Pendientes / decisiones abiertas

1. **Branch `dev` de lógica.** Hoy solo existe `v1` (live). Mientras no exista, cualquier
   cambio a endpoints/funciones de Xano toca producción. Hace falta apenas queramos
   modificar el backend (no para desarrollar solo las apps).
2. **Cablear `X-Data-Source`** en ambos repos (§3) + kill-switch read-only en
   fundreporting-v2.
3. **`PLATFORM_SERVICE_TOKEN` de escritura + UUIDs de asset manager** (§2).
4. **Aislamiento de keys externas.** Si se necesita que dev no pueda tocar Resend/EODHD
   reales, la salida es un **workspace dev separado** (misma instancia), no solo un data
   source. Decisión pendiente.
5. **Despliegue.** Esquema propuesto: Vercel Preview (PRs) → Xano `dev`; Production →
   Xano `live`. En Xano, promover con merge/publish de branch.

---

## Referencias

- `data-model.md` — el modelo del CRM vs. FundReporting y por qué la costura es shape C.
- `fundreporting-handoff.md` — el handoff campo por campo; qué está confirmado contra el
  Xano real y qué falta.
- `tenancy.md` — multi-tenancy del fork (`organization.assetManagerId`).
- `steplabs/preview-demo/ANALISIS-XANO-CRM-FUNDREPORTING.md` (fuera de git) — el análisis
  largo: superficie de escritura de fundreporting-v2, opciones de arquitectura y plan de
  despliegue.
