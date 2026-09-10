// Test de la CARGA del archivo: que extensiones entran, que se rechaza, y como
// se detectan las columnas de telefono cuando no se llaman "Telefono_1".
//
// Sin dependencias: extrae las funciones REALES del index.html balanceando
// llaves y las corre con node. Asi el test no se desincroniza del codigo que
// corre de verdad (misma tecnica que usa el chequeo de normalizarNumero).
//
//   node test-carga-csv.js
const fs = require('fs');
// Por defecto el index.html de al lado. Se le puede pasar otro por argumento
// para probar contra PRODUCCION:
//   curl -s https://creador.fidelizador.online/ > /tmp/prod.html
//   node test-carga-csv.js /tmp/prod.html
const ARCHIVO = process.argv[2] || require('path').join(__dirname, 'index.html');
const src = fs.readFileSync(ARCHIVO, 'utf8');

function extraerFn(nombre) {
  const i = src.indexOf('function ' + nombre + '(');
  if (i < 0) throw new Error('no esta ' + nombre);
  let j = src.indexOf('{', i), d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('sin cerrar ' + nombre);
}
function extraerConst(nombre) {
  const m = src.match(new RegExp('const ' + nombre + ' = \\[[^\\]]*\\];'));
  if (!m) throw new Error('no esta const ' + nombre);
  return m[0];
}

const FNS = ['parseCSVLine', 'parseCSVTexto', 'detectarDelimitador', 'normNombreCol', 'detectarColumnasTelefono',
  'detectarColumnaMensaje', 'parseCSV', 'normalizarNumero', 'separarNumeros', 'validarExtension',
  'pareceBinario', 'escHtml', 'headersUnicos'];
const codigo = [
  // stub minimo de DOM: escHtml usa document.createElement
  'const document = { createElement: () => ({ set textContent(v) { this._v = v; },'
  + ' get innerHTML() { return String(this._v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }) };',
  'let headers = [], rawData = [], phoneColNames = [], selectedPhoneCols = new Set(), msgColName = "";',
  extraerConst('PALABRAS_TEL'), extraerConst('PALABRAS_MSG'),
  extraerConst('EXT_XLSX'), extraerConst('EXT_EXCEL'), extraerConst('EXT_OK'),
  ...FNS.map(extraerFn),
  'module.exports = {' + FNS.join(',') + ', st: () => ({headers, rawData, phoneColNames, msgColName})};',
].join('\n');
const m = { exports: {} };
new Function('module', codigo)(m);
const F = m.exports;

let ok = 0, fail = 0;
const t = (nombre, cond, extra) => {
  if (cond) ok++;
  else { fail++; console.log('  FALLA: ' + nombre + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};

console.log('--- 1. extension ---');
t('.csv pasa', F.validarExtension('Informe de Cuentas.csv') === null);
t('.CSV pasa', F.validarExtension('INFORME.CSV') === null);
t('.txt pasa', F.validarExtension('x.txt') === null);
t('.xlsx pasa (lo abre la pagina)', F.validarExtension('Informe.xlsx') === null);
t('.XLSX pasa', F.validarExtension('INFORME.XLSX') === null);
t('.xlsm pasa', F.validarExtension('macro.xlsm') === null);
t('.xls (OLE viejo) rebota con instruccion', /Guardar como/.test(F.validarExtension('viejo.xls') || ''));
t('.ods rebota', F.validarExtension('libre.ods') !== null);
t('.pdf rebota', /\.pdf/.test(F.validarExtension('cosa.pdf') || ''));
t('.png rebota', F.validarExtension('foto.png') !== null);
t('sin extension rebota', /sin extensi/.test(F.validarExtension('archivo') || ''));
t('nombre con html se escapa', !/<b>/.test(F.validarExtension('<b>x</b>.pdf')));

console.log('--- 2. binario ---');
t('xlsx renombrado (PK)', F.pareceBinario('PK basura'));
t('xls viejo (OLE)', F.pareceBinario('ÐÏà basura'));
t('con NUL', F.pareceBinario('Cuenta;Telefono_1\u0000\u0000'));
t('csv normal NO es binario', !F.pareceBinario('Cuenta;Razon Social;Telefono_1\n1;Ferreteria;2616414595'));
t('csv latin-1 con acentos NO es binario',
  !F.pareceBinario('Cuenta;Razon Social;Telefono_1\n1;Panader\ufffda La Espiga;2616414595\n2;Do\ufffda Rosa;2616414596'));

console.log('--- 3. delimitador ---');
t('punto y coma', F.detectarDelimitador('Cuenta;Razon Social;Telefono_1') === ';');
t('coma', F.detectarDelimitador('Cuenta,Razon Social,Telefono_1') === ',');
t('tab', F.detectarDelimitador('Cuenta\tRazon\tTelefono_1') === '\t');

console.log('--- 4. nombres de columna ---');
const casos = [
  ['Telefono_1', true], ['TELEFONO_1', true], ['Teléfono 1', true], ['telefono1', true],
  ['TEL_3', true], ['Tel 2', true], ['Celular', true], ['CELULAR_2', true],
  ['Móvil', true], ['WhatsApp', true], ['Telefono', true], ['tel', true],
  ['Cuenta', false], ['Razon Social', false], ['$ Asig.', false], ['Nombre', false],
  ['Direccion', false], ['Email', false], ['Numero de cuenta', false],
];
for (const [col, esperado] of casos) {
  const det = F.detectarColumnasTelefono([col], [{ [col]: '2616414595' }]).length > 0;
  t('columna ' + col + ' => ' + esperado, det === esperado, det);
}
t('"Telefono particular" con numeros SI',
  F.detectarColumnasTelefono(['Telefono particular'], [{ 'Telefono particular': '2616414595' }]).length === 1);
t('"Telefonista" con nombres NO',
  F.detectarColumnasTelefono(['Telefonista'], [{ 'Telefonista': 'Juan Perez' }]).length === 0);
t('orden de columnas se respeta',
  JSON.stringify(F.detectarColumnasTelefono(['Cuenta', 'Tel_2', 'Telefono_1'], [{}])) === '["Tel_2","Telefono_1"]');

console.log('--- 5. parseCSV ---');
const okCsv = ['Cuenta;Razon Social;TELEFONO 1;$ Asig.',
  '1001;Ferreteria;2616414595;15000',
  '1002;Almacen;3416003344-3416005566;8250'].join('\n');
let r = F.parseCSV(okCsv);
t('csv con "TELEFONO 1" se acepta', r.ok === true, r);
t('detecta la columna rara', JSON.stringify(F.st().phoneColNames) === '["TELEFONO 1"]', F.st().phoneColNames);
t('2 filas', F.st().rawData.length === 2);

r = F.parseCSV('Cuenta,Razon Social,Telefono_1\n1001,Ferreteria,2616414595');
t('csv con comas se acepta', r.ok === true, r);
t('columnas bien partidas', F.st().headers.length === 3, F.st().headers);

r = F.parseCSV('Cuenta;Razon Social;Domicilio\n1001;Ferreteria;San Martin 100');
t('sin columna de telefono => error', r.ok === false && /columna de tel/.test(r.motivo), r);
t('el error lista las columnas', /Cuenta, Razon Social, Domicilio/.test(r.motivo || ''));
t('no pisa el estado anterior', F.st().headers.length === 3 && F.st().phoneColNames[0] === 'Telefono_1');

r = F.parseCSV('Cuenta;Telefono_1');
t('sin filas de datos => error', r.ok === false && /una sola fila/.test(r.motivo), r);

r = F.parseCSV('esto es un texto suelto sin nada\notra linea cualquiera');
t('texto suelto => error', r.ok === false, r);

r = F.parseCSV('﻿Cuenta;Telefono_1\n1001;2616414595');
t('BOM no ensucia el encabezado', r.ok === true && F.st().headers[0] === 'Cuenta', F.st().headers);

r = F.parseCSV(['Cuenta;Razon Social;Telefono_1;Telefono_2;$ Asig.',
  '1001;Ferreteria;2616414595;;15000'].join('\n'));
t('regresion: Informe de Cuentas clasico', r.ok === true &&
  JSON.stringify(F.st().phoneColNames) === '["Telefono_1","Telefono_2"]', F.st().phoneColNames);

console.log('--- 6. columna de mensaje ya escrito (amartin) ---');
const conMsg = ['Cuenta;Telefono_1;Mensaje',
  '1001;2616414595;Hola Juan, te escribimos por tu cuenta.',
  '1002;2616414596;Hola Ana, pasamos a saludarte.'].join('\n');
r = F.parseCSV(conMsg);
t('csv con columna Mensaje se acepta', r.ok === true, r);
t('detecta la columna Mensaje', F.st().msgColName === 'Mensaje', F.st().msgColName);

r = F.parseCSV('Cuenta;Telefono_1;TEXTO\n1001;2616414595;Buenas, le escribimos de MAVERIX');
t('tambien "TEXTO"', F.st().msgColName === 'TEXTO', F.st().msgColName);
r = F.parseCSV('Cuenta;Telefono_1;mensaje_1\n1001;2616414595;Buenas, le escribimos de aca');
t('tambien "mensaje_1"', F.st().msgColName === 'mensaje_1', F.st().msgColName);

// Control: una columna que se llama parecido pero NO trae texto no cuenta
r = F.parseCSV('Cuenta;Telefono_1;Mensajes enviados\n1001;2616414595;14');
t('"Mensajes enviados" con numeros NO es la columna', F.st().msgColName === '', F.st().msgColName);
r = F.parseCSV('Cuenta;Telefono_1;Mensaje\n1001;2616414595;');
t('columna Mensaje vacia NO cuenta', F.st().msgColName === '', F.st().msgColName);
r = F.parseCSV('Cuenta;Razon Social;Telefono_1\n1001;Ferreteria;2616414595');
t('informe clasico: no hay columna de mensaje', F.st().msgColName === '', F.st().msgColName);

console.log('--- 7. encabezados unicos en el CSV final ---');
t('sin repetidos queda igual',
  JSON.stringify(F.headersUnicos(['Telefono','Mensaje','Cuenta'])) === '["Telefono","Mensaje","Cuenta"]');
t('Mensaje repetida pasa a Mensaje_2',
  JSON.stringify(F.headersUnicos(['Telefono','Mensaje','Mensaje'])) === '["Telefono","Mensaje","Mensaje_2"]',
  F.headersUnicos(['Telefono','Mensaje','Mensaje']));
t('no distingue mayusculas',
  JSON.stringify(F.headersUnicos(['Telefono','Mensaje','MENSAJE'])) === '["Telefono","Mensaje","MENSAJE_2"]',
  F.headersUnicos(['Telefono','Mensaje','MENSAJE']));
t('tres iguales: _2 y _3',
  JSON.stringify(F.headersUnicos(['Mensaje','Mensaje','Mensaje'])) === '["Mensaje","Mensaje_2","Mensaje_3"]',
  F.headersUnicos(['Mensaje','Mensaje','Mensaje']));

console.log('--- 8. campos multilinea entrecomillados (RFC 4180) ---');
r = F.parseCSV(['Cuenta;Telefono_1;Mensaje',
  '1001;2616414595;"Hola Juan,',
  'te escribimos por tu cuenta."',
  '1002;2616414596;Hola Ana'].join('\n'));
t('un campo con salto adentro NO parte la fila', r.ok === true && F.st().rawData.length === 2, F.st().rawData);
t('el salto queda dentro del campo',
  F.st().rawData[0]['Mensaje'] === 'Hola Juan,\nte escribimos por tu cuenta.', F.st().rawData[0]);
t('la fila siguiente no se corre', F.st().rawData[1]['Telefono_1'] === '2616414596', F.st().rawData[1]);

r = F.parseCSV('Cuenta;Telefono_1\r\n1001;2616414595\r\n1002;2616414596\r\n');
t('CRLF se banca', r.ok === true && F.st().rawData.length === 2 && F.st().rawData[1]['Telefono_1'] === '2616414596', F.st().rawData);

// Lo que escribe filasACsv (el camino del xlsx) lo tiene que leer parseCSV:
// una celda con Alt+Enter viaja entrecomillada y con el salto adentro.
r = F.parseCSV(['Cuenta;Telefono_1;Nota',
  '1001;2616414595;"linea 1',
  'linea 2"',
  '1002;2616414596;sin nota'].join('\n'));
t('camino xlsx: celda con Alt+Enter no corrompe', r.ok === true && F.st().rawData.length === 2
  && F.st().rawData[0]['Nota'] === 'linea 1\nlinea 2', F.st().rawData);

console.log('--- 9. encabezados duplicados en la entrada ---');
r = F.parseCSV('Cuenta;Telefono_1;Mensaje;Mensaje\n1001;2616414595;Hola;Chau');
t('la segunda se renombra, no pisa',
  r.ok === true && JSON.stringify(F.st().headers) === '["Cuenta","Telefono_1","Mensaje","Mensaje_2"]', F.st().headers);
t('ninguna de las dos pierde su dato',
  F.st().rawData[0]['Mensaje'] === 'Hola' && F.st().rawData[0]['Mensaje_2'] === 'Chau', F.st().rawData[0]);
t('se avisa la renombrada', r.aviso && /Mensaje_2/.test(r.aviso), r.aviso);

console.log('\n' + ok + ' OK, ' + fail + ' fallas');
process.exit(fail ? 1 : 0);
