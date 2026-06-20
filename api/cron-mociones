// /api/cron-mociones.js
//
// Esta función la ejecuta Vercel Cron una vez al día (configurado en vercel.json).
// Llama a la lógica de conteo y guarda el resultado en un Gist de GitHub,
// para que la página pública lo pueda leer al instante sin esperar el conteo.
//
// Variables de entorno necesarias (configurar en Vercel → Settings → Environment Variables):
//   GITHUB_TOKEN  → token personal de GitHub con permiso "gist"
//   GIST_ID       → ID del Gist donde se guarda el archivo mociones.json

import contarMociones from "./contar-mociones.js";

export default async function handler(req, res) {
  // Seguridad simple: Vercel Cron manda este header en las llamadas programadas.
  // Si alguien intenta llamar este endpoint directo sin ser el cron, lo rechazamos.
  const esVercelCron = req.headers["x-vercel-cron"] !== undefined;
  if (!esVercelCron && process.env.NODE_ENV === "production") {
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

    // Guardar en el Gist
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
            content: JSON.stringify(resultado, null, 2),
          },
        },
      }),
    });

    if (!gistRes.ok) {
      const texto = await gistRes.text();
      throw new Error(`Error guardando en Gist: ${gistRes.status} ${texto}`);
    }

    res.status(200).json({ ok: true, resultado });
  } catch (error) {
    res.status(200).json({ ok: false, error: error.message });
  }
}
