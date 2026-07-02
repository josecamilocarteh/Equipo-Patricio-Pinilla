// /api/contar-mociones.js
//
// Cuenta cuántas mociones presentó cada diputado en el año dado, consultando
// la API de Datos Abiertos de la Cámara. Calcula DOS rankings en la misma
// pasada (mismo costo de llamadas HTTP que antes):
//
//   1. ranking         → los 5 diputados del Distrito 21 (igual que siempre)
//   2. rankingGeneral   → los 155 diputados en ejercicio actualmente
//
// FLUJO:
// 1. Pide la lista de diputados del período actual (retornarDiputadosPeriodoActual)
//    — UNA sola llamada, para saber nombre/apellido/partido vigente de los 155.
//    (Esta respuesta NO trae distrito, así que no se puede mostrar por ahora.)
// 2. Pide la lista completa de mociones del año (retornarMocionesXAnno).
// 3. Por cada moción que se originó en la Cámara (no Senado), pide el detalle
//    (retornarProyectoLey) para ver sus autores.
// 4. Por cada autor, lo cruza contra la lista de diputados del Distrito 21 Y
//    contra la lista completa de 155, sumando en ambos conteos a la vez.
//
// OJO: esto hace muchas llamadas (una por cada moción de la Cámara en el año,
// más una extra para la lista de diputados). Por eso NO se llama directo desde
// el navegador del visitante — la usa /api/cron-mociones.js una vez al día,
// y el resultado se guarda en un Gist.

import { diputados as DIPUTADOS_ESTATICOS } from "./datos-diputados.js";

const BASE = "https://opendata.camara.cl/camaradiputados/WServices/WSLegislativo.asmx";
const DIP_BASE = "https://opendata.camara.cl/camaradiputados/WServices/WSDiputado.asmx";

// Diputados del Distrito 21 a rastrear. Cada uno con su apellido paterno
// (tal como viene en el campo <ApellidoPaterno> de la API) y nombre, para
// cruzar de forma robusta evitando falsos positivos por apellidos comunes.
// (Se mantiene esta lista fija —igual que siempre— para no arriesgar el
// panel del Distrito 21, que ya funciona bien.)
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

function claveNombre(apellidoPaterno, nombrePila) {
  return normalizar(apellidoPaterno) + "|" + normalizar(nombrePila);
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

// Busca a un diputado dentro del dataset ESTÁTICO curado a mano (mismo que
// usa https://github.com/josecamilocarteh/Congreso-Chile), cruzando por
// apellido paterno + nombre de pila (normalizados, sin tildes). Ese dataset
// es la fuente de verdad para distrito y partido, porque la API oficial de
// la Cámara (retornarDiputadosPeriodoActual) no entrega distrito y su dato
// de partido puede no coincidir con la nomenclatura que usamos en el resto
// del proyecto.
function buscarEnDatosEstaticos(apellidoPaterno, nombrePila) {
  const apN = normalizar(apellidoPaterno);
  const noN = normalizar(nombrePila);
  if (!apN || !noN) return null;
  return (
    DIPUTADOS_ESTATICOS.find((d) => {
      const nombreN = normalizar(d.nombre);
      return nombreN.includes(apN) && nombreN.includes(noN);
    }) || null
  );
}

// Trae los diputados que están en ejercicio ahora mismo (155), con su
// nombre y apellidos desde la API, enriquecidos con distrito/partido desde
// el dataset estático. Una sola llamada a la API.
async function obtenerDiputadosActuales() {
  const xml = await fetchXML(`${DIP_BASE}/retornarDiputadosPeriodoActual`);
  const bloques = extraerTags(xml, "DiputadoPeriodo");

  const porClave = new Map(); // "apellido|nombre" normalizado -> info del diputado
  const lista = [];

  bloques.forEach((bloque) => {
    const dipXml = extraerTag(bloque, "Diputado");
    if (!dipXml) return;

    const id = extraerTag(dipXml, "Id");
    const nombrePila = extraerTag(dipXml, "Nombre");
    const apellidoPaterno = extraerTag(dipXml, "ApellidoPaterno");
    const apellidoMaterno = extraerTag(dipXml, "ApellidoMaterno");

    if (!id || !apellidoPaterno || !nombrePila) return;

    const nombreCompleto = [nombrePila, apellidoPaterno, apellidoMaterno]
      .filter(Boolean)
      .join(" ");

    const estatico = buscarEnDatosEstaticos(apellidoPaterno, nombrePila);
    const partido = estatico ? estatico.partido : null; // ej. "UDI", "RN", "Independiente"...
    const distrito = estatico ? estatico.distrito : null;
    const region = estatico ? estatico.region : null;

    const info = {
      id,
      nombre: nombreCompleto,
      apellidoPaterno,
      nombrePila,
      partido,
      distrito,
      region,
    };
    lista.push(info);

    const clave = claveNombre(apellidoPaterno, nombrePila);
    // Si dos diputados comparten apellido paterno + nombre exactos (raro),
    // nos quedamos con el primero; no debería afectar el conteo en la práctica.
    if (!porClave.has(clave)) porClave.set(clave, info);
  });

  return { lista, porClave };
}

export default async function handler(req, res) {
  const anno = parseInt(req.query.anno, 10) || new Date().getFullYear();

  // El período legislativo 2026-2030 comenzó el 11 de marzo de 2026. Antes de
  // esa fecha había otros representantes — por eso se excluyen esas mociones
  // de enero/febrero, aunque retornarMocionesXAnno las incluya por venir
  // dentro del mismo año calendario.
  const INICIO_PERIODO = new Date("2026-03-11T00:00:00");

  try {
    // 0. Lista de los 155 diputados actuales (para el ranking general)
    let diputadosActuales = { lista: [], porClave: new Map() };
    let errorDiputados = null;
    try {
      diputadosActuales = await obtenerDiputadosActuales();
    } catch (e) {
      // Si esto falla, seguimos igual con el ranking del Distrito 21
      // (que no depende de esta llamada), y el general queda vacío.
      errorDiputados = e.message;
    }

    // 1. Lista completa de mociones del año
    const listaXML = await fetchXML(`${BASE}/retornarMocionesXAnno?prmAnno=${anno}`);
    const proyectos = extraerTags(listaXML, "ProyectoLey");

    // Solo nos interesan las mociones originadas en la Cámara de Diputados
    // Y presentadas dentro del período legislativo actual.
    const boletines = proyectos
      .filter((p) => extraerTag(p, "CamaraOrigen").includes("Cámara"))
      .filter((p) => {
        const fechaStr = extraerTag(p, "FechaIngreso");
        if (!fechaStr) return false;
        const fecha = new Date(fechaStr);
        return fecha >= INICIO_PERIODO;
      })
      .map((p) => extraerTag(p, "NumeroBoletin"))
      .filter(Boolean);

    // Conteo Distrito 21 (igual que siempre)
    const conteo = {};
    DIPUTADOS_DISTRITO_21.forEach((d) => (conteo[d.nombre] = 0));

    // Conteo general, indexado por Id de diputado
    const conteoGeneral = {};
    diputadosActuales.lista.forEach((d) => (conteoGeneral[d.id] = 0));

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
              const apellido = extraerTag(autorXML, "ApellidoPaterno");
              const nombrePila = extraerTag(autorXML, "Nombre");

              // -- Distrito 21 (lógica original, intacta) --
              const apellidoN = normalizar(apellido);
              const nombreN = normalizar(nombrePila);
              DIPUTADOS_DISTRITO_21.forEach((d) => {
                if (normalizar(d.apellidoPaterno) === apellidoN && normalizar(d.nombrePila) === nombreN) {
                  conteo[d.nombre]++;
                }
              });

              // -- General (155 diputados) --
              const clave = claveNombre(apellido, nombrePila);
              const dip = diputadosActuales.porClave.get(clave);
              if (dip) conteoGeneral[dip.id]++;
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

    const rankingGeneral = diputadosActuales.lista
      .map((d) => ({
        id: d.id,
        nombre: d.nombre,
        partido: d.partido, // ej. "UDI", "RN", "Independiente"... o null si no hubo cruce
        distrito: d.distrito, // 1-28, o null si no hubo cruce
        region: d.region,
        mociones: conteoGeneral[d.id] || 0,
        esPinilla:
          normalizar(d.apellidoPaterno) === "pinilla" && normalizar(d.nombrePila) === "patricio",
      }))
      .sort((a, b) => b.mociones - a.mociones);

    res.status(200).json({
      actualizado: new Date().toISOString(),
      anno,
      totalMocionesRevisadas: boletines.length,
      ranking,
      rankingGeneral,
      errorDiputados: errorDiputados || undefined,
    });
  } catch (error) {
    res.status(200).json({
      error: true,
      mensaje: error.message,
      actualizado: new Date().toISOString(),
    });
  }
}
