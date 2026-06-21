// /api/contar-mociones.js
//
// Cuenta cuántas mociones presentó cada diputado del Distrito 21 en el año dado,
// consultando la API de Datos Abiertos de la Cámara.
//
// FLUJO:
// 1. Pide la lista completa de mociones del año (retornarMocionesXAnno).
// 2. Por cada moción que se originó en la Cámara (no Senado), pide el detalle
//    (retornarProyectoLey) para ver sus autores.
// 3. Cuenta cuántas veces aparece cada uno de los 5 diputados del distrito.
//
// OJO: esto hace muchas llamadas (una por cada moción de la Cámara en el año).
// Por eso NO se llama directo desde el navegador del visitante — la usa
// /api/cron-mociones.js una vez al día, y el resultado se guarda en un Gist.

const BASE = "https://opendata.camara.cl/camaradiputados/WServices/WSLegislativo.asmx";

// Diputados del Distrito 21 a rastrear. Cada uno con su apellido paterno
// (tal como viene en el campo <ApellidoPaterno> de la API) y nombre, para
// cruzar de forma robusta evitando falsos positivos por apellidos comunes.
const DIPUTADOS_DISTRITO_21 = [
  { nombre: "Patricio Pinilla", apellidoPaterno: "Pinilla", nombrePila: "Patricio" },
  { nombre: "Joanna Pérez", apellidoPaterno: "Pérez", nombrePila: "Joanna" },
  { nombre: "Flor Weisse", apellidoPaterno: "Weisse", nombrePila: "Flor" },
  { nombre: "Cristóbal Urruticoechea", apellidoPaterno: "Urruticoechea", nombrePila: "Cristóbal" },
  { nombre: "Lilian Betancurt", apellidoPaterno: "Betancurt", nombrePila: "Lilian" },
];

function normalizar(str) {
  return (str || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita tildes
}

// Parser XML simple por regex (sin librerías externas, igual estilo que
// el resto del proyecto Congreso Chile para no agregar dependencias).
function extraerTags(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out = [];
  let m;
  while ((m = regex.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function extraerTag(xml, tag) {
  // [^>]* permite (e ignora) atributos como Valor="1" dentro de la etiqueta de apertura,
  // ej. <CamaraOrigen Valor="1">Cámara de Diputados</CamaraOrigen>
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : "";
}

async function fetchXML(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return await res.text();
}

export default async function handler(req, res) {
  const anno = parseInt(req.query.anno, 10) || new Date().getFullYear();

  try {
    // 1. Lista completa de mociones del año
    const listaXML = await fetchXML(`${BASE}/retornarMocionesXAnno?prmAnno=${anno}`);
    const proyectos = extraerTags(listaXML, "ProyectoLey");

    // Solo nos interesan las mociones originadas en la Cámara de Diputados
    // (las del Senado no las firman diputados de la Cámara).
    const boletines = proyectos
      .filter((p) => extraerTag(p, "CamaraOrigen").includes("Cámara"))
      .map((p) => extraerTag(p, "NumeroBoletin"))
      .filter(Boolean);

    // Conteo inicial en 0 para los 5 diputados
    const conteo = {};
    DIPUTADOS_DISTRITO_21.forEach((d) => (conteo[d.nombre] = 0));

    // 2. Por cada boletín, pedir detalle y revisar autores
    //    (en tandas para no saturar la API de golpe)
    const TANDA = 8;
    for (let i = 0; i < boletines.length; i += TANDA) {
      const tanda = boletines.slice(i, i + TANDA);
      await Promise.all(
        tanda.map(async (boletin) => {
          try {
            const detalleXML = await fetchXML(
              `${BASE}/retornarProyectoLey?prmNumeroBoletin=${boletin}`
            );
            const autoresXML = extraerTags(detalleXML, "Diputado"); // autores diputados (no Senador)
            autoresXML.forEach((autorXML) => {
              const apellido = normalizar(extraerTag(autorXML, "ApellidoPaterno"));
              const nombrePila = normalizar(extraerTag(autorXML, "Nombre"));
              DIPUTADOS_DISTRITO_21.forEach((d) => {
                if (
                  normalizar(d.apellidoPaterno) === apellido &&
                  normalizar(d.nombrePila) === nombrePila
                ) {
                  conteo[d.nombre]++;
                }
              });
            });
          } catch (e) {
            // Si un boletín individual falla, lo ignoramos y seguimos
            console.error(`Error en boletín ${boletin}:`, e.message);
          }
        })
      );
    }

    const ranking = DIPUTADOS_DISTRITO_21.map((d) => ({
      nombre: d.nombre,
      mociones: conteo[d.nombre],
    }));

    res.status(200).json({
      actualizado: new Date().toISOString(),
      anno,
      totalMocionesRevisadas: boletines.length,
      ranking,
    });
  } catch (error) {
    res.status(200).json({
      error: true,
      mensaje: error.message,
      actualizado: new Date().toISOString(),
    });
  }
}
