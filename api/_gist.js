// /api/_gist.js
//
// Funciones compartidas para leer y validar los datos guardados en el Gist.
// (Vercel no publica como endpoint los archivos que empiezan con "_".)
//
// Por qué existe: en noviembre de 2026 la API de Datos Abiertos de la Cámara
// empezó a devolver diputados del período ANTERIOR, tanto en
// retornarDiputadosPeriodoActual como en los autores de las mociones. El cron
// guardó esos datos en el Gist y el ranking quedó sin Pinilla y sin
// partido/distrito. El 16 de noviembre la Cámara corrigió la lista de
// diputados, pero los autores siguieron mal (Pinilla con 0). Con esto:
//   1. el cron NO guarda datos que no pasen la validación, y
//   2. los endpoints de lectura, si la versión actual del Gist es inválida,
//      buscan en el historial del Gist la última versión válida y sirven esa.

const UMBRAL_CRUCE = 0.9; // al menos 90% de los 155 deben cruzar con el dataset curado

export function validarRankingGeneral(datos) {
  const lista = datos && Array.isArray(datos.ranking) ? datos.ranking : null;
  if (!lista || lista.length < 150) return "la lista no trae 155 diputados";
  const conPartido = lista.filter((d) => d.partido).length;
  if (conPartido / lista.length < UMBRAL_CRUCE) {
    return `solo ${conPartido} de ${lista.length} diputados coinciden con la nómina 2026-2030`;
  }
  if (!lista.some((d) => d.esPinilla)) return "Patricio Pinilla no aparece en la lista";
  // Los autores de las mociones también pueden venir mal (diputados del período
  // anterior): en ese caso casi todos los diputados actuales quedan con 0.
  // En los datos buenos, prácticamente los 155 tienen al menos una moción.
  const conMociones = lista.filter((d) => d.mociones > 0).length;
  if (conMociones / lista.length < 0.5) {
    return `solo ${conMociones} de ${lista.length} diputados tienen mociones (autores mal asignados por la Cámara)`;
  }
  return null; // válido
}

export function validarDistrito21(datos) {
  const lista = datos && Array.isArray(datos.ranking) ? datos.ranking : null;
  if (!lista || !lista.length) return "no hay ranking del Distrito 21";
  const total = lista.reduce((s, d) => s + (d.mociones || 0), 0);
  if (total === 0) return "los 5 diputados del Distrito 21 aparecen con 0 mociones";
  return null;
}

function headersGitHub() {
  const h = { Accept: "application/vnd.github+json" };
  // Con token, GitHub permite 5.000 consultas por hora en vez de 60.
  if (process.env.GITHUB_TOKEN) h.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function leerJSON(url) {
  const r = await fetch(url, { headers: headersGitHub() });
  if (!r.ok) throw new Error(`Error leyendo Gist: ${r.status}`);
  return r.json();
}

async function contenidoArchivo(gist, nombre) {
  const archivo = gist.files && gist.files[nombre];
  if (!archivo) return null;
  // GitHub corta el contenido de archivos grandes; en ese caso hay que ir a raw_url.
  if (archivo.truncated && archivo.raw_url) {
    const r = await fetch(archivo.raw_url, { headers: headersGitHub() });
    if (!r.ok) return null;
    return JSON.parse(await r.text());
  }
  return JSON.parse(archivo.content);
}

// Devuelve el contenido válido más reciente del archivo pedido.
// Si tuvo que usar una versión anterior, agrega respaldo: true y el motivo.
export async function leerArchivoValido(nombre, validar, maxVersiones = 30) {
  const id = process.env.GIST_ID;
  const actual = await leerJSON(`https://api.github.com/gists/${id}`);
  const contenidoActual = await contenidoArchivo(actual, nombre);
  if (!contenidoActual) {
    throw new Error(`El Gist todavía no tiene ${nombre} (espera a que corra el cron una vez)`);
  }
  const motivo = validar(contenidoActual);
  if (!motivo) return contenidoActual;

  // La versión actual es inválida: recorremos el historial (de más nueva a más antigua).
  const versiones = await leerJSON(
    `https://api.github.com/gists/${id}/commits?per_page=${maxVersiones}`
  );
  for (const v of versiones.slice(1)) {
    try {
      const gist = await leerJSON(`https://api.github.com/gists/${id}/${v.version}`);
      const contenido = await contenidoArchivo(gist, nombre);
      if (contenido && !validar(contenido)) {
        return { ...contenido, respaldo: true, motivoRespaldo: motivo };
      }
    } catch (e) {
      // versión ilegible: seguimos con la anterior
    }
  }
  // No hay ninguna versión válida: devolvemos la actual tal cual, avisando.
  return { ...contenidoActual, respaldo: false, advertencia: motivo };
}
