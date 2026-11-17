// /api/ranking.js
//
// Endpoint liviano que consulta el ranking GENERAL (155 diputados). Solo LEE
// el contenido ya calculado del Gist. El cálculo pesado lo hace
// /api/cron-mociones.js una vez al día.
//
// Si la versión actual del Gist trae datos inválidos (falla de la API de la
// Cámara), sirve la última versión válida del historial. Ver /api/_gist.js.
import { leerArchivoValido, validarRankingGeneral } from "./_gist.js";

export default async function handler(req, res) {
  // CORS: permite que otros sitios (ej. equipo-mella.vercel.app) usen este endpoint.
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Cache de 10 minutos en Vercel para no gastar consultas a GitHub en cada visita.
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");

  try {
    const contenido = await leerArchivoValido("ranking-general.json", validarRankingGeneral);
    res.status(200).json(contenido);
  } catch (error) {
    res.status(200).json({ error: true, mensaje: error.message });
  }
}
