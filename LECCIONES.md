# Creador-Mensajes — Lecciones aprendidas

> Movidas desde `_lecciones.md` del vault de Obsidian el 2026-08-20: ese archivo se carga entero
> al inicio de cada sesión y había crecido demasiado. Lo específico de cada proyecto vive ahora
> al lado de su código. Las lecciones **generales** (deploy/EasyPanel, diseño, Claude Code)
> siguen en el vault: `Obsidian/Berna Notebook/_lecciones.md`.

---


### Lo que dice el buzón no es lo que dice el promedio (2026-09-01)

127 opiniones, **4,92 estrellas**. Mirando de cerca: el comentario era **obligatorio**
(mínimo 3 caracteres) *y* bloqueaba la descarga, así que 40 de los 95 comentarios son
`...`, `asd`, `ñññññ` o chistes. El promedio no medía la herramienta, medía las ganas de
que se cierre la ventana.

- 📌 **Los 8 pedidos reales estaban en las notas más bajas y en los comentarios largos.**
  Los dos únicos 3★ (amartin) eran un bug: no había forma de usar una columna `Mensaje`
  que el ejecutivo ya traía armada. Un 5★ en mayúsculas ("DEMASIADOS PASOOOS BROO") vale
  más que noventa "excelente".
- 📌 **Obligar el comentario compra ruido, no señal.** Ahora las estrellas son
  obligatorias y el texto no. Se pierde volumen y se gana que lo escrito sea de verdad.
- La entrada permanente del footer ("Mejoras o sugerencias") es por donde llegaron los
  pedidos buenos: la encuesta que bloquea la descarga se contesta una sola vez por
  ejecutivo y después se apaga sola.

### Dos columnas con el mismo nombre es peor que un error (2026-09-01)

`exportCSV()` armaba el encabezado como `['Telefono','Mensaje', ...extras]`. Si el informe
ya traía una columna llamada `Mensaje` y el ejecutivo la marcaba como extra, el CSV salía
con **`Telefono;Mensaje;Mensaje`**. No falla nada: el `csv.DictReader` de HERMES se queda
con la **última** y manda esa. La vista previa mostraba una cosa y el cliente recibía otra.

- 📌 **Un duplicado no rompe: elige.** Y elige distinto en cada parser. `headersUnicos()`
  renombra la segunda a `Mensaje_2` antes de escribir nada.
- Lo mismo aplica a cualquier salida con encabezados: si el nombre lo pone el usuario,
  la unicidad se garantiza en el serializador, no en la UI.

### Un `.xlsx` es un ZIP: no hace falta una librería (2026-09-01)

Pedido de fsevilla. Hasta hoy el Excel se rechazaba y **todos** los ejecutivos hacían
"Guardar como CSV" a mano. El navegador ya trae todo: `DecompressionStream('deflate-raw')`
para inflar y `DOMParser` para el XML. Unas 180 líneas, cero dependencias.

- 🔴 **Sin leer `xl/styles.xml`, las fechas salen como número de serie.** Una columna
  `Fecha alta` llegaba al cliente como `45678`. Hay que mirar el `numFmtId` de cada
  estilo. La señal confiable de que un formato es fecha es la **`y`** o la **`d`**:
  `mm:ss` son minutos, no una fecha.
- **La primera hoja del libro no siempre es `sheet1.xml`.** Se resuelve por
  `xl/_rels/workbook.xml.rels`; `sheet1.xml` queda de respaldo.
- **El encabezado local del ZIP tiene su propio campo `extra`**, que casi nunca mide lo
  mismo que el del directorio central. Usar el largo del directorio para saltear el
  encabezado local da datos corridos y basura al inflar.
- 📌 **Una sola vía de entrada.** La hoja se convierte a CSV y entra por `procesarTexto`,
  el mismo camino que un archivo subido: las mismas validaciones, la misma detección de
  columnas. Un segundo parser se desincroniza del primero apenas cambia una regla.
- Se verificó con **Excel de verdad** (openpyxl) en el navegador, mirando el CSV que sale:
  acentos, fechas `dd/mm/yyyy`, `261 641-4595` sin partirse por el guion y
  `+5492615007788` sin doble prefijo.

### El `accept` del input NO existe cuando se arrastra (2026-08-31)

- El `<input type="file" accept=".csv">` filtra **solo el diálogo de explorar archivos**.
  Al **arrastrar y soltar** entra cualquier cosa: un `.xlsx`, un PDF, una foto. Se leía
  como texto, `parseCSV()` no encontraba nada y la app quedaba **"cargada" con 0 filas
  y sin decir una palabra** — el usuario veía el paso 1 en verde y el CSV salía vacío.
- 📌 **Un archivo pasa por tres puertas, y ninguna sobra:**
  1. **Extensión** (`validarExtension`) — barata, y es la que da el mensaje útil:
     si es Excel, dice cómo guardarlo como CSV en vez de "formato inválido".
  2. **Contenido binario** (`pareceBinario`) — un `.xlsx` renombrado a `.csv` sigue
     siendo un ZIP (arranca con `PK`), y un `.xls` viejo es OLE (`ÐÏ`). La extensión
     miente; los primeros bytes no.
  3. **CSV usable** (`parseCSV`) — devuelve `{ok:false, motivo}` en vez de fallar en
     silencio: sin filas, sin columnas separables, o sin ninguna columna de teléfono.
- 🔴 **Fallar tiene que dejar la app como estaba, no a medias.** `fallarCarga()` hace
  `resetFile()` y **recién ahí** muestra el cartel. `parseCSV()` solo pisa
  `headers`/`rawData`/`phoneColNames` cuando el archivo sirve: un archivo roto no puede
  dejar datos del anterior mezclados.
- Excel en Windows guarda en ANSI. Leído como UTF-8, "Panadería" queda con `\ufffd`.
  Si aparece ese caracter (y no es binario) se **relee con `windows-1252`**. Ojo con
  confundirlo con binario: el umbral es 20% de la muestra, no la simple presencia.

### La columna de teléfono no siempre se llama `Telefono_1` (2026-08-31)

- La lista de columnas era literal (`['Telefono_1',...,'Telefono_9']`) y se comparaba
  con `===`. Un archivo con `TELEFONO 1`, `Teléfono1` o `Cel_2` **no tenía ni una
  columna de teléfono**: 0 filas para exportar, sin explicación.
- 📌 **Se detecta por el nombre normalizado** (sin tildes, sin mayúsculas, sin
  separadores) y con dos criterios:
  - **Fuerte**: la columna *es* una palabra de teléfono con o sin número al final —
    `telefono`, `tel3`, `celular2`. Entra siempre.
  - **Débil**: *empieza* con una pero sigue con letras — `Telefono particular`,
    `Celular del titular`. Entra **solo si los datos traen un número de verdad**.
    Así `Telefonista` (nombres de personas) no se cuela y sigue disponible como
    variable `{Telefonista}` y como columna extra. **El nombre solo no alcanza para
    decidir; los datos desempatan.**
- ⚠️ En `PALABRAS_TEL` **las palabras largas van primero**: si `tel` estuviera antes
  que `telefono`, en `telefono1` el resto sería `efono1` y el match fuerte fallaría.
- El separador también dejó de ser fijo: gana el que parta el encabezado en más
  columnas (`;`, `,`, tab, `|`), con `;` ganando el empate — es el de siempre.
- Si no aparece ninguna columna de teléfono, el cartel **lista las columnas que sí
  trae el archivo**. Un error que no dice qué encontró obliga a abrir el CSV a mano.
- Regresión: `node test-carga-csv.js` (51 casos, sin dependencias). Se validó con
  **control negativo**: mutando `PALABRAS_TEL`, el `accept` de extensión y el chequeo
  de columnas, el test falla 8/5/3 casos. Un test verde que no se vio fallar no prueba
  nada.

### Concatenar un prefijo sin mirar lo que ya está es un bug esperando el dato correcto (2026-08-21)

- `exportCSV()` armaba la celda del teléfono con `'="+549' + c.number + ',"'` sobre el
  valor **crudo** de la planilla. Con los Informes de Cuentas de siempre (10 dígitos
  pelados) anduvo durante meses. El día que una columna Telefono vino en formato
  internacional, escupió **`+5495492616414595`** y HERMES no pudo enviar a nadie.
- 📌 **Normalizar es idempotente o no es normalizar.** `normalizarNumero()` saca el
  `549`/`54`/`0` que ya esté, y encima colapsa el prefijo pegado más de una vez. Un
  móvil argentino es siempre `549` + 10 dígitos y **no hay código de área que empiece
  con 9**, así que `549549…` nunca es un número real: con eso alcanza para decidir.
- 🔴 **Para cortar varios teléfonos de una celda, el criterio es el LARGO, no el
  separador.** El primer intento partía por `-` y rompía `261 641-4595` en `261641` y
  `4595` — un número perfectamente válido escrito como lo escribe cualquiera. La regla
  que sí sirve: si al cortar queda algún pedazo de menos de 10 dígitos, el separador
  era parte del número y la celda es una sola. Lo cazó un test de 15 casos, no la vista.
- **La misma función tiene que contar y exportar.** Había tres lugares contando
  teléfonos con lógicas distintas (el cartel de "N teléfonos", el chip de cada columna
  y el export). Los dos primeros solo separaban `Telefono_1`, así que la app decía 495
  y el CSV traía otra cosa. Un contador que no comparte código con lo que cuenta
  miente apenas cambia una regla.
- 📌 **Probar contra el código DEPLOYADO, no contra el del disco.** El chequeo final
  bajó el `index.html` de producción con `curl`, le extrajo las dos funciones
  balanceando llaves y las corrió con `node` sobre casos reales. Eso comprueba lo que
  le pasa al usuario, no lo que hay en el working tree.

### La columna Mensaje: cuándo va entre comillas y cuándo no (2026-08-21)

Esta celda tiene dos consumidores con necesidades opuestas, y por eso el CSV usa
**dos serializadores distintos**: `csvMessage()` para el mensaje y `csvField()`
(RFC 4180 clásico) para las columnas extra.

| Problema | Fecha | Fix |
|---|---|---|
| El cliente final recibía el mensaje **con las comillas puestas** (queja de pazp) | 2026-07-21 | `csvMessage()` dejó de escapar y pasó a *sanear*: `;`→`,`, `"`→`'` |
| El mensaje llegaba a WhatsApp como **un chorizo de una línea** | 2026-08-21 | Los saltos se conservan y el campo se entrecomilla **sólo si los tiene** |

Reglas que hay que respetar si se vuelve a tocar `csvMessage()`:

1. **Mensaje de una sola línea → sin comillas.** Las herramientas que pegan la
   celda literal (no todas parsean CSV de verdad) mostrarían las comillas al
   cliente. Este es el caso mayoritario y no puede regresar.
2. **Mensaje con saltos → entre comillas, sin alternativa.** Un `\n` sólo
   sobrevive dentro de un campo entrecomillado (RFC 4180). No hay forma de
   tener salto de línea *y* campo pelado: si alguien pide las dos cosas, el
   salto es lo que se pierde.
3. **LF, nunca CRLF.** HERMES lee con `csv.DictReader` y el `\r` viaja verbatim;
   en la ruta de tipeo (Lupita/Token) `\r` y `\n` son dos caracteres especiales
   distintos y dejan basura en el campo del chat. `csvMessage()` normaliza
   `\r\n?` → `\n` antes de nada.
4. **No colapsar los saltos al colapsar espacios.** El `.replace(/\s{2,}/g,' ')`
   original se comía las líneas en blanco. Va con `[^\S\n]{2,}` (espacios y tabs
   sí, saltos no), o los párrafos se pierden igual que antes.
5. **Las comillas dobles se sustituyen por simples, no se duplican.** Doblarlas
   (`""`) es lo correcto según la norma, pero un parser ingenuo se las muestra
   al cliente. Con `'` se lee igual y no puede romper la celda.

Del lado de HERMES esto ya está contemplado a propósito (`Hermes.py`, el
comentario de `_is_ascii_safe`: los saltos se insertan por uiautomator2 sin
mandar Enter, así que el mensaje no se parte en varios envíos).

Test de regresión: `csvMessage()` + round-trip por `csv.DictReader` de Python
(el mismo parser que usa HERMES) — ver la entrada del 2026-08-21 en el historial.

### La rotación entre mensajes son cajas, no `---` (2026-08-21)

Entre 2026-08-15 y 2026-08-21 las variantes se escribían en un solo textarea
separadas por una línea de `---`. Problemas que tenía y por los que se cambió:
sólo se anunciaba en una frase del hint (nadie la encontraba), la vista previa
mostraba únicamente la primera variante, había que reescribir el texto entero
para cada una, y una línea decorativa de guiones partía el mensaje sin aviso.

Ahora cada mensaje es su propia caja con **Agregar / Duplicar / Borrar**. El
`---` se sigue aceptando al escribir o pegar: se parte solo en cajas, así que
quien aprendió el truco viejo no pierde nada.

**Ojo con el placeholder:** `getTemplates()` caía al `placeholder` del textarea
cuando estaba vacío, y el export no validaba nada — se podía descargar un CSV
con el texto de ejemplo como mensaje real a cientos de clientes. Ahora devuelve
sólo lo escrito de verdad y la descarga se bloquea con un aviso.

### El nombre del archivo lo elige el usuario (2026-08-21)

Antes el CSV bajaba directo con el nombre puesto por la página. Ahora hay un
modal al final del flujo (después de la donación) que deja editarlo.

Cosas a no romper si se toca:

- **El `.csv` no se edita.** Va como `<span>` fijo dentro del campo, y
  `cleanFileName()` igual saca un `.csv` que el usuario haya escrito, para que
  no quede `archivo.csv.csv`.
- **Se sanea, no se rechaza.** Windows no acepta `\ / : * ? " < > |` ni punto o
  espacio al final; un nombre inválido hace que la descarga falle **sin decir
  por qué**. Se reemplazan por `-` en silencio: el ejecutivo no tiene por qué
  saber esa lista.
- **`a.download` no controla el explorador de archivos.** Si Chrome tiene
  activado *"Preguntar dónde guardar cada archivo"*, el explorador se abre igual
  — pero ahora aparece con el nombre ya puesto. Eso es una preferencia del
  navegador (`chrome://settings/downloads`), no algo que la página pueda cambiar.

### Creador-Mensajes (ex MensajesMasivos) - CSV + GitHub Pages
- *CSV con campos entre comillas*: Un `split(';')` simple no alcanza cuando los campos están envueltos en `"..."`. Hay que hacer un parser custom que trackee `inQuotes` para no romper campos que contengan `;` o `""`
- *Signo + en CSV abierto con Excel*: Excel interpreta `+549...` como numero y pierde el `+`. Solucion: exportar como formula `="+549XXXXXXX,"` que Excel evalua como texto literal
- *gh CLI en WSL*: `gh` no estaba instalado ni en Windows ni en WSL. Instalar con `winget install GitHub.cli` y ejecutar via `powershell.exe -Command "& 'C:\Program Files\GitHub CLI\gh.exe' ..."`
- *GitHub Pages API body*: El endpoint `POST /repos/{owner}/{repo}/pages` necesita JSON con `build_type` y `source` como objeto. En PowerShell, pipear el JSON string al comando con `--input -`
