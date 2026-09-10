# CLAUDE.md — Creador-Mensajes (MAVERIX)

Se carga solo al trabajar en este repo. Info general y accesos: `proyectos/Creador-Mensajes.md` en el vault de Obsidian. Log de cambios: `proyectos/Creador-Mensajes-historial.md`.

📚 Detalle técnico en [`LECCIONES.md`](LECCIONES.md) (cuándo va entre comillas la columna Mensaje, las cajas de mensaje, el `+` que Excel se come, GitHub Pages). Creado el 2026-08-20 desde el `_lecciones.md` del vault.

## Qué es

Herramienta web para los ejecutivos de MAVERIX: suben un CSV **o un Excel** y les devuelve teléfonos `+549` con mensajes personalizados, listos para cargar en HERMES. Gate por ejecutivo (215 usuarios), cartel de la rifa solidaria (7 segundos, **sin saltearse**) antes de cada descarga, pestaña lateral de sugerencias y panel de uso en `/admin`.

La pantalla son **tres pasos** (archivo → mensaje → descargar). Las columnas de teléfono y las extra son bloques **plegados** dentro del paso 1 y del 3: hasta el 2026-09-01 eran los pasos 2 y 4 numerados.

En producción: **https://creador.fidelizador.online**

Node puro (`http`/`fs`), sin dependencias npm. Imagen `node:20-alpine`, build de segundos.

## 🔴 Reglas duras

1. **La rama de deploy es `master`**, no `main`.

2. **En EasyPanel el proyecto es `berna_toca_esto_y_te_rompo_la_chota`, NO `redhawk`.**
   Servicio `creador-mensajes`, volumen en `/data`. Si `inspectService` o `deployService` devuelve `NOT_FOUND` con el proyecto "obvio", iterar sobre todos los proyectos de `listProjects` antes de asumir que el servicio no existe.

3. **NO reactivar GitHub Pages.** Se desactivó el 2026-06-03: el doble hosting rompía la encuesta — el `github.io` servía el HTML pero los endpoints daban 405 y los datos se perdían, mientras la app real andaba bien. **Se ve idéntico**, por eso costó encontrarlo. Si reaparece, volver a desactivarlo.

4. **El dominio propio es el bueno; el `*.easypanel.host` se borró.**
   Su DNS lo maneja EasyPanel y **no resolvía en los celulares de los ejecutivos**: a Berna le abría (lo tenía cacheado) y a nadie más. Diagnóstico-regla: *si al dueño le abre y a todos los demás no, en redes distintas, es el DNS del dominio que no controlás.*

5. **No tocar `csvMessage()` sin leer `LECCIONES.md`.**
   La columna Mensaje sale **sin comillas si es de una línea** (o el cliente las
   recibe puestas) y **entre comillas si tiene saltos** (única forma de que el
   salto sobreviva). Siempre LF, nunca CRLF. Las columnas extra usan otro
   serializador (`csvField()`, RFC 4180): esa asimetría es a propósito.

6. **El teléfono se normaliza ANTES de anteponerle el `+549`.**
   `exportCSV()` hace `'="+549' + c.number + ',"'`, y `c.number` tiene que venir
   ya en 10 dígitos pelados desde `buildContactRows()` → `separarNumeros()`.
   Hasta el 2026-08-21 se concatenaba sobre el valor **crudo** de la planilla:
   si la columna Telefono ya venía en internacional salía `+5495492616414595`,
   y HERMES no podía enviar. **Idempotencia o no es normalizar.**
   - ⚠️ **Para cortar varios teléfonos de una celda, el criterio es el LARGO,
     no el guion.** Un solo número se escribe `261 641-4595`: cortarlo por el
     guion da `261641` y `4595`. Si al cortar queda algún pedazo de menos de 10
     dígitos, el separador era parte del número. También se parten los pegados
     sin separador (20/30/40 dígitos).
   - ⚠️ **Los tres lugares que cuentan teléfonos usan la MISMA función**: el
     cartel de "N teléfonos" al cargar, el numerito de cada chip `Telefono_N` y
     la exportación. Antes los dos primeros contaban con la lógica vieja (solo
     `Telefono_1`) y mostraban menos de los que después salían en el CSV.
   - Prueba rápida sin abrir el navegador: extraer `normalizarNumero` y
     `separarNumeros` del `index.html` con un balanceo de llaves y correrlas con
     `node`. Así el test no se desincroniza del código que corre de verdad.

7. **Un backend caído no debe inutilizar la herramienta.**
   Las sugerencias y la telemetría usan `AbortController` con timeout: si el backend no responde, se avisa y nada se bloquea. El patrón completo de resiliencia (uncaughtException que no mata, clientError, fallback de GET a `index.html`, graceful SIGTERM, HEALTHCHECK) está en el commit `eda083e`.

8. **Todo archivo que entra pasa por las tres puertas de la carga.**
   El `accept=".csv"` del input **no se aplica al arrastrar**: por ahí entra cualquier
   cosa. `handleFile()` valida **extensión** → **contenido binario** (`PK` de un xlsx,
   `ÐÏ` de un xls) → **CSV usable** (`parseCSV` devuelve `{ok, motivo}`). Si algo falla,
   `fallarCarga()` resetea y muestra el cartel: nunca queda "cargado" a medias.

9. **El `.xlsx` lo abre la propia página, sin librerías.**
   `leerZip` (directorio central del ZIP) → `inflar` (`DecompressionStream('deflate-raw')`)
   → `hojaAFilas` (DOMParser) → CSV → **`procesarTexto`, el mismo camino que un archivo
   subido**. No agregar un segundo parser: se desincroniza.
   - ⚠️ **Sin `xl/styles.xml` las fechas salen como número de serie** (`45678`) y eso le
     llega al cliente. `estilosFecha()` mira los `numFmtId`; la señal confiable de que un
     formato es fecha es la `y` o la `d`, no la `m` (`mm:ss` son minutos).
   - Se lee la **primera hoja del libro** vía `xl/_rels/workbook.xml.rels`, no `sheet1.xml`
     a ciegas. Las celdas se ubican por su referencia (`B4`), así una columna vacía en el
     medio no corre a las de la derecha.
   - Cualquier fallo cae a `fallarCarga` con el cartel de "guardalo como CSV". Un `.xlsx`
     renombrado a `.csv` (arranca con `PK`) **se abre**, no se rechaza.
   - `.xls`/`.xlsb`/`.ods` siguen rebotando: no son ZIP.

10. **Si el archivo ya trae el mensaje escrito, se puede usar** (`useFileMsg`).
   `detectarColumnaMensaje()` pide match fuerte de nombre **y** texto de verdad en los
   datos. Con la casilla prendida `buildMessage()` toma `row[msgColName]`, las filas sin
   mensaje **no se exportan**, y las cajas de plantilla se apagan sin borrarse.
   - 🔴 **El CSV final nunca puede llevar dos columnas con el mismo nombre**
     (`headersUnicos`). El `csv.DictReader` de HERMES se queda con la **última**: una
     columna `Mensaje` marcada además como extra hacía que se enviara algo distinto de lo
     que mostraba la vista previa, sin un solo aviso.

11. **Las columnas de teléfono se detectan, no se comparan literal.**
   `phoneColNames` arranca en `Telefono_1..9` pero lo **reemplaza** lo que devuelve
   `detectarColumnasTelefono()` al leer el archivo: `TELEFONO 1`, `Teléfono1`, `Cel_2`
   y `Celular principal` valen igual. Las de match débil (empiezan con la palabra pero
   siguen con letras) entran **solo si los datos traen un número real**, para que
   `Telefonista` no se cuele. En `PALABRAS_TEL` las palabras largas van primero.
   - Regresión: `node test-carga-csv.js` (sin dependencias; acepta un `index.html`
     por argumento para probar contra producción).

## Cosas que se preguntan seguido

- *"Salió un cartel de una rifa al descargar y no se puede cerrar"* → es a propósito: el afiche de la rifa solidaria (`rifa.jpeg`, Jockey Club Mendoza) se muestra 7 segundos con cuenta regresiva antes de pedir el nombre del archivo y **no tiene botón de salto** (2026-09-10: Berna pidió que la publicidad se vea sí o sí). Para cambiar el afiche: reemplazar `rifa.jpeg` y redeploy (está en el `COPY` del Dockerfile y lo sirve `server.js` en `/rifa.jpeg`).
- *"¿Dónde quedó la encuesta?"* → se eliminó el 2026-09-10 junto con el pedido de donación. Ahora hay una pestaña fija al costado derecho («✎ Sugerencias») que abre un modal chico (voluntario, solo texto, mismo `/api/feedback`; las entradas nuevas llegan **sin estrellas**, y el `/admin` las muestra como "sugerencia").
- *"Se acordó de mi mensaje"* → sí: `maverix_msg_<user>` en `localStorage`. No viaja al servidor.
- Agregar o sacar ejecutivos → editar `EJECUTIVOS` en `index.html` + redeploy.
- El `ADMIN_KEY` se deja sin rotar a propósito: solo mide uso, no protege datos sensibles.

## Deploy

**El push a `master` NO deploya solo** (`autoDeploy:false`). Hay que dispararlo a mano, por cualquiera de estas dos vías:

```bash
# 1) Token webhook del servicio (no necesita la API key; tokens en el vault: credenciales/easypanel)
curl -s -X POST "http://84.46.252.202:3000/api/deploy/<token de creador-mensajes>"

# 2) tRPC con la API key de EasyPanel
curl -s -X POST "https://bm6z1s.easypanel.host/api/trpc/services.app.deployService" \
  -H "Authorization: Bearer <API key EasyPanel>" -H "Content-Type: application/json" \
  -d '{"json":{"projectName":"berna_toca_esto_y_te_rompo_la_chota","serviceName":"creador-mensajes"}}'
```

Verificar que entró (smoke test): `curl -s https://creador.fidelizador.online/ | grep <string de la versión nueva>`.
