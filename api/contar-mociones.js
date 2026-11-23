// /api/contar-mociones.js
//
// Cuenta cuántas mociones presentó cada diputado en el año dado. Calcula DOS
// rankings en la misma pasada:
//
//   1. ranking         → los 5 diputados del Distrito 21
//   2. rankingGeneral   → los 155 diputados en ejercicio (período 2026-2030)
//
// FLUJO:
// 1. La nómina de los 155 sale del dataset curado (datos-diputados.js), el
//    mismo de congreso-chile. Ya NO depende de retornarDiputadosPeriodoActual
//    de la Cámara, que en noviembre de 2026 devolvió diputados del período
//    anterior. (A la Cámara solo se le pide, si responde, el Id de cada
//    diputado, para conservar el campo "id"; si falla, el ranking sigue igual.)
// 2. La lista de mociones del año sale de la Cámara (retornarMocionesXAnno).
// 3. Los AUTORES de cada moción salen de la API pública de tramitación del
//    SENADO (tramitacion.senado.cl/wspublico), que cubre todos los proyectos
//    del Congreso. Desde el 14-nov-2026 la Cámara (retornarProyectoLey)
//    atribuye las mociones a diputados del período anterior; el Senado trae
//    los autores correctos.
// 4. Cada autor ("Apellido1 Apellido2, Nombre") se cruza contra la nómina.
//    Los senadores que firman alguna moción quedan fuera porque no están en
//    la nómina de diputados.
//
// OJO: esto hace muchas llamadas (una por cada moción de la Cámara en el año).
// Por eso NO se llama desde el navegador del visitante: la usa
// /api/cron-mociones.js una vez al día, y el resultado se guarda en un Gist.

import { diputados as DIPUTADOS_ESTATICOS } from "./datos-diputados.js";

const BASE = "https://opendata.camara.cl/camaradiputados/WServices/WSLegislativo.asmx";
const DIP_BASE = "https://opendata.camara.cl/camaradiputados/WServices/WSDiputado.asmx";
const SENADO = "https://tramitacion.senado.cl/wspublico/tramitacion.php";

// Los 5 diputados del Distrito 21 (nombre como se muestra en index.html).
const DIPUTADOS_DISTRITO_21 = [
  { nombre: "Patricio Pinilla", completo: "Patricio Pinilla Valencia" },
  { nombre: "Joanna Pérez", completo: "Joanna Pérez Olea" },
  { nombre: "Flor Weisse", completo: "Flor Weisse Novoa" },
  { nombre: "Cristóbal Urruticoechea", completo: "Cristóbal Urruticoechea Ríos" },
  { nombre: "Lilian Betancurt", completo: "Lilian Betancurt Delgado" },
];

// Palabras que no sirven para identificar a nadie ("de la", "del", etc.).
const STOP = new Set(["de", "del", "la", "las", "los", "y", "san"]);

function normalizar(str) {
  return (str || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita tildes (también ö → o)
}

function palabras(str) {
  return normalizar(str)
    .split(/[\s-]+/)
    .filter((t) => t && !STOP.has(t));
}

// Parser XML simple por regex (sin librerías externas).
function extraerTags(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out = [];
  let m;
  while ((m = regex.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function extraerTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : "";
}

async function fetchXML(url, intentos = 2) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      return await res.text();
    } catch (e) {
      ultimoError = e;
    }
  }
  throw ultimoError;
}

// Crea una función que, dado un autor tal como viene del Senado
// ("Pinilla Valencia, Patricio"), devuelve el índice del diputado en `lista`
// (o null si no es diputado o si hay empate). Puntaje: cada apellido que
// coincide vale 2 y cada nombre 1. Se exige al menos un apellido y un nombre,
// o bien los dos apellidos (para casos como "Coca" Ñanco, que en el Senado
// figura con su nombre legal, Ericka).
function crearCruzador(lista) {
  const indice = lista.map((d, i) => ({ i, toks: new Set(palabras(d.nombre)) }));
  return function cruzar(parlamentario) {
    const [apellidos, nombres] = (parlamentario || "").split(",");
    const apT = palabras(apellidos);
    const nomT = palabras(nombres);
    let mejor = null;
    let mejorPuntaje = 0;
    let empate = false;
    for (const c of indice) {
      const a = apT.filter((t) => c.toks.has(t)).length;
      const n = nomT.filter((t) => c.toks.has(t)).length;
      if (!((a >= 1 && n >= 1) || a >= 2)) continue;
      const puntaje = a * 2 + n;
      if (puntaje > mejorPuntaje) {
        mejor = c.i;
        mejorPuntaje = puntaje;
        empate = false;
      } else if (puntaje === mejorPuntaje) {
        empate = true;
      }
    }
    return empate ? null : mejor;
  };
}

// Intenta obtener el Id de la Cámara de cada diputado (solo para conservar el
// campo "id" que podrían usar otras apps). Si la Cámara falla, devuelve {}.
async function idsDeLaCamara(cruzar) {
  try {
    const xml = await fetchXML(`${DIP_BASE}/retornarDiputadosPeriodoActual`, 1);
    const ids = {};
    extraerTags(xml, "DiputadoPeriodo").forEach((bloque) => {
      const dip = extraerTag(bloque, "Diputado");
      const id = extraerTag(dip, "Id");
      const nombre = extraerTag(dip, "Nombre");
      const ap = [extraerTag(dip, "ApellidoPaterno"), extraerTag(dip, "ApellidoMaterno")].join(" ");
      const i = cruzar(`${ap}, ${nombre}`);
      if (id && i !== null && ids[i] === undefined) ids[i] = id;
    });
    return ids;
  } catch (e) {
    return {};
  }
}

export default async function handler(req, res) {
  const anno = parseInt(req.query.anno, 10) || new Date().getFullYear();

  // El período legislativo 2026-2030 comenzó el 11 de marzo de 2026: se
  // excluyen las mociones de enero/febrero (eran otros representantes).
  const INICIO_PERIODO = new Date("2026-03-11T00:00:00");

  try {
    const nomina = DIPUTADOS_ESTATICOS;
    const cruzar = crearCruzador(nomina);

    // Índices de los 5 del Distrito 21 dentro de la nómina
    const indicesD21 = DIPUTADOS_DISTRITO_21.map((d) => {
      const [nombrePila, ...apellidos] = d.completo.split(" ");
      return cruzar(`${apellidos.join(" ")}, ${nombrePila}`);
    });

    // 1. Lista de mociones del año (Cámara)
    const listaXML = await fetchXML(`${BASE}/retornarMocionesXAnno?prmAnno=${anno}`);
    const boletines = extraerTags(listaXML, "ProyectoLey")
      .filter((p) => extraerTag(p, "CamaraOrigen").includes("Cámara"))
      .filter((p) => {
        const fechaStr = extraerTag(p, "FechaIngreso");
        return fechaStr && new Date(fechaStr) >= INICIO_PERIODO;
      })
      .map((p) => extraerTag(p, "NumeroBoletin"))
      .filter(Boolean);

    // 2. Autores de cada moción (Senado), en tandas para no saturar la API
    const conteo = new Array(nomina.length).fill(0);
    let fallidos = 0;
    let sinAutores = 0;
    const TANDA = 8;
    for (let i = 0; i < boletines.length; i += TANDA) {
      const tanda = boletines.slice(i, i + TANDA);
      await Promise.all(
        tanda.map(async (boletin) => {
          try {
            const numero = boletin.split("-")[0];
            const xml = await fetchXML(`${SENADO}?boletin=${numero}`);
            const autores = extraerTags(xml, "PARLAMENTARIO").map((a) => a.trim());
            if (!autores.length) sinAutores++;
            // Un diputado cuenta una sola vez por moción
            const vistos = new Set();
            autores.forEach((autor) => {
              const idx = cruzar(autor);
              if (idx !== null && !vistos.has(idx)) {
                vistos.add(idx);
                conteo[idx]++;
              }
            });
          } catch (e) {
            fallidos++;
            console.error(`Error en boletín ${boletin}:`, e.message);
          }
        })
      );
    }

    const ids = await idsDeLaCamara(cruzar);

    const ranking = DIPUTADOS_DISTRITO_21.map((d, k) => ({
      nombre: d.nombre,
      mociones: indicesD21[k] !== null ? conteo[indicesD21[k]] : 0,
    }));

    const rankingGeneral = nomina
      .map((d, i) => ({
        id: ids[i] || null,
        nombre: d.nombre,
        partido: d.partido,
        distrito: d.distrito,
        region: d.region,
        mociones: conteo[i],
        esPinilla: indicesD21[0] === i,
      }))
      .sort((a, b) => b.mociones - a.mociones);

    res.status(200).json({
      actualizado: new Date().toISOString(),
      anno,
      totalMocionesRevisadas: boletines.length,
      fuenteAutores: "Senado (tramitacion.senado.cl)",
      boletinesFallidos: fallidos || undefined,
      boletinesSinAutores: sinAutores || undefined,
      ranking,
      rankingGeneral,
    });
  } catch (error) {
    res.status(200).json({
      error: true,
      mensaje: error.message,
      actualizado: new Date().toISOString(),
    });
  }
}
