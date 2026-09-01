# Creador-Mensajes - MAVERIX

App web para generar CSV de mensajes masivos a partir de un "Informe de Cuentas" (`.csv` o `.xlsx`).
Al abrir la página pide el **usuario del ejecutivo** (autocompletado sobre una lista fija en `index.html`); ese nombre queda registrado en cada ingreso, cada descarga y en la calificación de la encuesta. Incluye una encuesta de opinión **obligatoria antes de la primera descarga**, y un panel `/admin` para ver quién usa la página y las respuestas.

**En vivo:** https://creador.fidelizador.online (panel en `/admin`) — dominio propio en Hostinger; el viejo `*.easypanel.host` fue borrado y da 404.

> ⚠️ Esta app **necesita el backend** (`server.js`) para guardar las opiniones. NO usar GitHub Pages (es estático y la encuesta no guarda). Pages quedó desactivado a propósito.

## Estructura

- `index.html` — la app (subir CSV, armar mensaje/s, exportar) + modal de encuesta + tutorial "¿Cómo funciona?" (links en tagline y footer).
- `admin.html` — panel `/admin` para ver las opiniones (protegido por clave).
- `server.js` — backend Node puro (sin dependencias): sirve las páginas y guarda/lee las opiniones. Rate limit y healthcheck incluidos.
- `Dockerfile` — para deploy en EasyPanel.

## Flujo de uso

1. **Al abrir la página**: modal "¿Qué ejecutivo sos?" con autocompletado sobre la lista fija (const `EJECUTIVOS` en `index.html`, 215 usuarios). Solo deja continuar con un nombre de la lista; queda en `localStorage` (`maverix_user`) y registra un evento `login`.
2. La persona procesa su CSV y aprieta **«Descargar CSV»**.
3. **Encuesta (una vez por ejecutivo)**: si ese ejecutivo nunca calificó, aparece el modal con estrellas (**obligatorias**) y comentario **opcional**. Se puede salir con "ahora no" (aborta esa descarga; la encuesta vuelve a aparecer en la próxima). Se guarda con el nombre del ejecutivo.
4. **Un solo modal antes de que baje**: pide el **nombre del archivo**, y arriba muestra el bloque de donación (alias `palta.camote.mp`, click = copiar) **una vez por semana** por ejecutivo (`maverix_don_<user>`), no en cada descarga. Viene precargado con **`Maverix - mensaje AAAA-MM-DD`** (fecha ISO para que ordenen cronológico) y el texto queda seleccionado, así se puede tipear encima. El `.csv` va fijo al costado del campo: no se edita ni se duplica si el usuario lo escribe. Los caracteres que Windows no acepta (`\ / : * ? " < > |`) se cambian por `-` en vez de rechazar el nombre. Enter descarga, Escape / click afuera / «Cancelar» cierran sin descargar. Se registra un evento `download` con la cantidad de filas.
5. En `/admin` (con clave): stats, tabla "quién usa la página" (click en una fila = detalle de cada ingreso/descarga con fecha-hora + sus calificaciones y comentarios) y lista completa de opiniones con `@usuario`.

## Los tres pasos de la pantalla

**1 Subí tu archivo · 2 Tu mensaje · 3 Descargá.** Las *columnas de teléfono* (dentro
del paso 1) y las *columnas extra* (dentro del paso 3) son bloques **plegados**: los dos
vienen resueltos de fábrica, y plegados muestran un resumen con exactamente lo que va a
salir (`2 columnas · 495 teléfonos` / `ninguna`). Hasta 2026-09-01 eran los pasos 2 y 4,
numerados: la pantalla mostraba cinco pasos para un trabajo de tres.

## El paso 1: qué archivo entra (y cuál no)

**`.csv`, `.txt` y `.xlsx`/`.xlsm`.** El Excel se abre en la página, sin convertir nada
(ver abajo). El `accept` del input **no filtra cuando se arrastra**, así que la
validación vive en el JS y toda carga —arrastrada o elegida— pasa por las mismas
tres puertas:

1. **Extensión.** `.xls` (OLE viejo), `.xlsb`, `.ods` y `.numbers` siguen rebotando con
   la instrucción de guardar como `.xlsx` o CSV.
2. **Contenido binario.** Un `.xlsx` renombrado a `.csv` arranca con `PK`: se detecta y
   **se abre como Excel** en vez de mandar a convertirlo. Un `.xls` viejo es OLE y rebota.
   La extensión miente; los primeros bytes no.
3. **CSV usable.** Sin filas, sin columnas separables o sin ninguna columna de
   teléfono → cartel rojo bajo el área de carga y la app queda **como estaba**,
   nunca "cargada" a medias con datos del archivo anterior.

### Excel (`.xlsx`) sin convertir

Un `.xlsx` es un ZIP con XML adentro, así que **no hace falta ninguna librería**: el
navegador descomprime con `DecompressionStream('deflate-raw')` y parsea con `DOMParser`
(`leerZip` / `inflar` / `hojaAFilas` en `index.html`). La hoja se convierte a CSV y entra
**por el mismo camino que un archivo subido** (`procesarTexto`) — una sola vía, imposible
de desincronizar. Detalles que importan:

- **Las fechas se convierten.** Sin mirar `xl/styles.xml`, una columna `Fecha alta`
  llegaría al cliente como `45678`. Se leen los `numFmtId` de fecha (de fábrica y
  personalizados) y el serial se pasa a `dd/mm/yyyy`.
- **Se lee la primera hoja del libro**, que no siempre es `sheet1.xml` (se resuelve por
  `xl/_rels/workbook.xml.rels`).
- **Las celdas traen su referencia** (`B4`), así que una columna vacía en el medio no
  corre a las de la derecha.
- Si algo falla, se cae al cartel de siempre: *guardalo como CSV*. Nunca queda a medias.

**El separador se detecta solo** (`;`, `,`, tab o `|`; gana el que parta el encabezado
en más columnas, con `;` ganando el empate). Si el CSV viene en ANSI de Excel se relee
con `windows-1252`, así "Panadería" no llega al cliente como "Panader?a".

### La columna de teléfono no tiene que llamarse `Telefono_1`

Se detecta por el **nombre normalizado** (sin tildes, sin mayúsculas y sin separadores),
no por igualdad literal: `TELEFONO 1`, `Teléfono1`, `Tel_2`, `Celular`, `Móvil` y
`WhatsApp` valen igual. Las que sólo *empiezan* con la palabra (`Telefono particular`)
entran únicamente si los datos traen un número real — así una columna `Telefonista`,
que tiene nombres de personas, no se cuela y sigue disponible como variable
`{Telefonista}` y como columna extra.

Regresión: `node test-carga-csv.js` (65 casos, sin dependencias). Acepta un `index.html`
por argumento para correrlo contra producción:

```bash
curl -s https://creador.fidelizador.online/ > /tmp/prod.html && node test-carga-csv.js /tmp/prod.html
```

## El paso 2: armar el mensaje

- **Variables**: `{NombreColumna}` se reemplaza por el dato real de cada fila. `{$ Asig.}` y `{$ Hist.}` salen formateados como pesos argentinos. El panel de la derecha las inserta en la caja que se esté usando.
- **Los saltos de línea se respetan** (desde 2026-08-21): lo que se escribe con Enter llega a WhatsApp con el mismo formato. Antes se aplastaban a un espacio y el mensaje salía como un chorizo de una sola línea. En el CSV el campo se entrecomilla **sólo** cuando tiene saltos; el de una línea sigue saliendo pelado para que ninguna herramienta le muestre comillas al cliente (ver `LECCIONES.md`).
- **Varios mensajes**: el botón «Agregar otro mensaje» suma otra caja, con **Duplicar** y **Borrar**. Se rotan uno por contacto para que los envíos no salgan todos iguales (es lo que dispara los filtros de spam de WhatsApp). Cada caja tiene su propia vista previa con datos reales.
  - *Antes* las variantes se separaban con una línea de `---` dentro de una sola caja. Se sigue aceptando: si se escribe o pega un texto con `---`, se parte solo en cajas.
- **No se puede descargar con el mensaje vacío**: antes el textarea vacío caía al texto del placeholder y se podía exportar el ejemplo como mensaje real.
- **El mensaje se recuerda** por ejecutivo en `localStorage` (`maverix_msg_<user>`), y se
  recupera al entrar. Antes no se guardaba nada y el que manda todos los días el mismo
  texto lo retipeaba entero cada vez.

### Usar el mensaje que ya trae el archivo

Si el archivo trae una columna de mensaje (`Mensaje`, `TEXTO`, `mensaje_1`… detectada por
nombre normalizado **y** con texto de verdad adentro), aparece una casilla para usarla en
vez de la plantilla. Prendida:

- las cajas de plantilla se **apagan, no se borran** (si la apaga, recupera lo escrito);
- se muestra el mensaje real de la primera fila, que es lo que va a salir;
- las filas **sin** mensaje no se exportan y se avisa cuántas son (HERMES abriría el chat
  para no escribir nada).

Y en el CSV final **nunca hay dos columnas con el mismo nombre** (`headersUnicos`): si el
informe ya traía una `Mensaje` y además se marcaba como columna extra, salían dos y el
`csv.DictReader` de HERMES se quedaba con **la última** — mandaba algo distinto de lo que
mostraba la vista previa, en silencio. La segunda pasa a llamarse `Mensaje_2`.

## Diseño (tema MONOLITH, igual que HERMES)

Desde 2026-08-20 la app usa el **mismo sistema de diseño que la app de escritorio HERMES** (tokens sacados de `hermes_theme.py`):

- **Claro por defecto** (fondo `#F1F0ED`, tarjetas blancas, texto `#15151A`) con **modo oscuro** (`#0A0A0C` / `#131316`) vía botón "tema" en la topbar. Se recuerda en `localStorage` (`maverix_theme`) y respeta `prefers-color-scheme` en la primera visita. El `/admin` comparte la misma clave.
- **Acento verde WhatsApp** (`#0F7A46` claro / `#1FA463` oscuro), radios 18/14/10/8 (card/section/control/chip), fuente **Inter** (+ IBM Plex Mono para datos).
- Foco visible por teclado en todo lo interactivo (`:focus-visible` verde), chips/estrellas/área de carga operables con Enter/Espacio, `prefers-reduced-motion` apaga todas las animaciones (incluidas las de JS).

## Endpoints

| Endpoint | Qué hace |
|----------|----------|
| `POST /api/feedback` | Guarda una opinión (`rating`, `text`, `user`). Rate limit: 5 cada 10 minutos por IP. Body máximo 10KB (413 si se pasa). |
| `GET /api/feedback?key=ADMIN_KEY` | Lee todas las opiniones (usado por `/admin`). |
| `POST /api/usage` | Registra un evento de uso: `{user, event: "login"\|"download", rows?}`. Se guarda en `DATA_DIR/usage.jsonl`. Rate limit: 120 cada 10 min por IP. |
| `GET /api/usage?key=ADMIN_KEY` | Lee todos los eventos de uso (usado por `/admin`). |
| `GET /healthz` | Healthcheck, responde `{"ok":true}`. |

## Variables de entorno

| Variable    | Default              | Para qué |
|-------------|----------------------|----------|
| `PORT`      | `3000`               | Puerto del servidor |
| `DATA_DIR`  | `/data`              | Carpeta donde se guardan las opiniones. **Montar un volumen acá.** |
| `ADMIN_KEY` | `cambiar-esta-clave` | Clave para entrar al `/admin`. **Cambiala sí o sí.** |

## Deploy en EasyPanel

1. Crear una app (tipo **App** / desde GitHub o Dockerfile) apuntando a este repo.
2. En **Environment**: setear `ADMIN_KEY` con una clave propia.
3. En **Mounts / Volumes**: montar un volumen en `/data` para que las opiniones **persistan** entre redeploys (si no, se borran al reiniciar el contenedor).
4. Exponer el puerto `3000`.
5. Deploy. La app queda en el dominio asignado; el panel en `/admin`.

## Correr local

```bash
DATA_DIR=./data ADMIN_KEY=miclave PORT=3000 node server.js
# App:   http://localhost:3000
# Admin: http://localhost:3000/admin  (clave: miclave)
```
