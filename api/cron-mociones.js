// /api/cron-mociones.js

export default async function handler(req, res) {
  const esVercelCron = req.headers["x-vercel-cron"] !== undefined;
  const claveCorrecta =
    process.env.CRON_SECRET && req.query.secreto === process.env.CRON_SECRET;

  if (!esVercelCron && !claveCorrecta) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const anno = new Date().getFullYear();

    // URL fija de producción para el fetch interno
    const conteoRes = await fetch(
      `https://equipo-patricio-pinilla.vercel.app/api/contar-mociones?anno=${anno}`
    );

    if (!conteoRes.ok) {
      throw new Error(`Error al llamar contar-mociones: HTTP ${conteoRes.status}`);
    }

    const resultado = await conteoRes.json();

    if (resultado.error) {
      return res.status(200).json({ ok: false, detalle: resultado });
    }

    if (!resultado.ranking || !resultado.rankingGeneral) {
      return res.status(200).json({
        ok: false,
        error: "Respuesta de contar-mociones incompleta",
        resultado,
      });
    }

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
