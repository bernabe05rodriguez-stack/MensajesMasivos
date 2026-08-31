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

const FNS = ['parseCSVLine', 'detectarDelimitador', 'normNombreCol', 'detectarColumnasTelefono',
  'parseCSV', 'normalizarNumero', 'separarNumeros', 'validarExtension', 'pareceBinario', 'escHtml'];
const codigo = [
  // stub minimo de DOM: escHtml usa document.createElement
  'const document = { createElement: () => ({ set textContent(v) { this._v = v; },'
  + ' get innerHTML() { return String(this._v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }) };',
  'let headers = [], rawData = [], phoneColNames = [], selectedPhoneCols = new Set();',
  extraerConst('PALABRAS_TEL'), extraerConst('EXT_EXCEL'), extraerConst('EXT_OK'),
  ...FNS.map(extraerFn),
  'module.exports = {' + FNS.join(',') + ', st: () => ({headers, rawData, phoneColNames})};',
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
t('.xlsx rebota con instruccion Excel', /Excel/.test(F.validarExtension('Informe.xlsx') || ''));
t('.xls rebota', F.validarExtension('viejo.xls') !== null);
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

console.log('\n' + ok + ' OK, ' + fail + ' fallas');
process.exit(fail ? 1 : 0);
