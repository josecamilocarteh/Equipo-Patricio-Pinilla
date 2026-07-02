// /api/ranking.js
//
// Endpoint liviano que consulta el ranking GENERAL (155 diputados). Solo LEE
// el contenido ya calculado del Gist (rápido, 1 sola llamada). El cálculo
// pesado (una llamada a la API de la Cámara por cada moción del año, más
// una para la lista de diputados) lo hace /api/cron-mociones.js una vez al día.
export default async function handler(req, res) {
  try {
    const gistRes = await fetch(`https://api.github.com/gists/${process.env.GIST_ID}`, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!gistRes.ok) throw new Error(`Error leyendo Gist: ${gistRes.status}`);

    const gistData = await gistRes.json();
    const archivo = gistData.files["ranking-general.json"];
    if (!archivo) throw new Error("El Gist todavía no tiene ranking-general.json (espera a que corra el cron una vez)");
    const contenido = JSON.parse(archivo.content);

    res.status(200).json(contenido);
  } catch (error) {
    // Si algo falla, devolvemos un error claro en vez de romper la página.
    res.status(200).json({ error: true, mensaje: error.message });
  }
}
