// /api/cron-mociones.js
//
// Esta función la ejecuta Vercel Cron una vez al día (configurado en versel.json).
// Llama a la lógica de conteo (Distrito 21 + ranking general) y guarda AMBOS
// resultados en un Gist de GitHub, para que la página pública los pueda leer
// al instante sin esperar el conteo.
//
// Variables de entorno necesarias (configurar en Vercel → Settings → Environment Variables):
//   GITHUB_TOKEN  → token personal de GitHub con permiso "gist"
//   GIST_ID       → ID del Gist donde se guardan los archivos .json
import contarMociones from "./contar-mociones.js";

export default async function handler(req, res) {
  // Seguridad: deja pasar a Vercel Cron (manda este header en llamadas programadas)
  // O a quien conozca la clave secreta CRON_SECRET, para pruebas manuales
  // (ej. ?secreto=loquesea en la URL).
  const esVercelCron = req.headers["x-vercel-cron"] !== undefined;
  const claveCorrecta =
    process.env.CRON_SECRET && req.query.secreto === process.env.CRON_SECRET;
  if (!esVercelCron && !claveCorrecta) {
    return res.status(401).json({ error: "No autorizado" });
  }
  try {
    // Reutilizamos la lógica de conteo simulando la llamada
    const resultado = await new Promise((resolve) => {
      const fakeRes = {
        status: () => fakeRes,
        json: (data) => resolve(data),
      };
      const fakeReq = { query: { anno: new Date().getFullYear() } };
      contarMociones(fakeReq, fakeRes);
    });
    if (resultado.error) {
      return res.status(200).json({ ok: false, detalle: resultado });
    }

    // Separamos lo que va a cada archivo del Gist.
    // "mociones-distrito21.json" mantiene EXACTAMENTE el mismo formato de
    // siempre, para no romper /api/mociones.js ni el panel del Distrito 21.
    const distrito21 = {
      actualizado: resultado.actualizado,
      anno: resultado.anno,
      totalMocionesRevisadas: resultado.totalMocionesRevisadas,
      ranking: resultado.ranking,
    };

    const general = {
      actualizado: resultado.actualizado,
      anno: resultado.anno,
      totalMocionesRevisadas: resultado.totalMocionesRevisadas,
      ranking: resultado.rankingGeneral,
    };

    // Guardar ambos archivos en el Gist, en una sola escritura
    const gistRes = await fetch(`https://api.github.com/gists/${process.env.GIST_ID}`, {
      method: "PATCH",
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: {
          "mociones-distrito21.json": {
            content: JSON.stringify(distrito21, null, 2),
          },
          "ranking-general.json": {
            content: JSON.stringify(general, null, 2),
          },
        },
      }),
    });
    if (!gistRes.ok) {
      const texto = await gistRes.text();
      throw new Error(`Error guardando en Gist: ${gistRes.status} ${texto}`);
    }
    res.status(200).json({
      ok: true,
      distrito21Count: distrito21.ranking.length,
      generalCount: general.ranking.length,
      totalMocionesRevisadas: resultado.totalMocionesRevisadas,
    });
  } catch (error) {
    res.status(200).json({ ok: false, error: error.message });
  }
}
