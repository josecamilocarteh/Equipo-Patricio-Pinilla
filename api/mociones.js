// /api/mociones.js
//
// Endpoint liviano que consulta el index.html. Solo LEE el contenido ya
// calculado del Gist. Si la versión actual es inválida (los 5 del Distrito 21
// en 0 por una falla de la API de la Cámara), sirve la última versión válida.
import { leerArchivoValido, validarDistrito21 } from "./_gist.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
  try {
    const contenido = await leerArchivoValido("mociones-distrito21.json", validarDistrito21);
    res.status(200).json(contenido);
  } catch (error) {
    res.status(200).json({ error: true, mensaje: error.message });
  }
}
