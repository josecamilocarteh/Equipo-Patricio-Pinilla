// /api/cron-mociones.js
//
// Esta función la ejecuta Vercel Cron una vez al día (configurado en vercel.json).
// Llama al endpoint /api/contar-mociones y guarda AMBOS rankings en un Gist
// de GitHub para que la página pública los pueda leer al instante.
//
// Variables de entorno necesarias (en Vercel → Settings → Environment Variables):
//   GITHUB_TOKEN  → token personal de GitHub con permiso "gist"
//   GIST_ID       → ID del Gist donde se guardan los archivos .json
//   CRON_SECRET   → clave secreta para poder probar manualmente con ?secreto=TU_CLAVE

export default async function handler(req, res) {
  // Seguridad: deja pasar a Vercel Cron O a quien conozca la clave secreta
  const esVercelCron = req.headers["x-vercel-cron"] !== undefined;
  const claveCorrecta =
    process.env.CRON_SECRET && req.query.secreto === process.env.CRON_SECRET;

  if (!esVercelCron && !claveCorrecta) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const anno = new Date().getFullYear();

    // Llamar directamente al endpoint de conteo via fetch
    // (evita el patrón fake que puede tener problemas de timing con async)
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const conteoRes = await fetch(`${base}/api/contar-mociones?anno=${anno}`);
    if (!conteoRes.ok) {
      throw new Error(`Error al llamar contar-mociones: HTTP ${conteoRes.status}`);
    }
    const resultado = await conteoRes.json();

    if (resultado.error) {
      return res.status(200).json({ ok: false, detalle: resultado });
    }

    // Verificar que llegaron los datos necesarios
    if (!resultado.ranking || !resultado.rankingGeneral) {
      return res.status(200).json({
        ok: false,
        error: "Respuesta de contar-mociones incompleta",
        resultado,
      });
    }

    // Separar lo que va a cada archivo del Gist
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

    // Guardar ambos archivos en el Gist en una sola escritura
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
