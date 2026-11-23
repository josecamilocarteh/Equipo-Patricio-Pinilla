// /middleware.js
//
// Pide clave para ver la página del ranking general (ranking.html).
// Usa la ventana de usuario y contraseña del propio navegador ("Basic Auth"):
// el usuario puede ser cualquiera; lo que se revisa es la contraseña.
//
// La clave NO está escrita aquí: se guarda en Vercel como variable de entorno
// RANKING_CLAVE (Settings → Environment Variables). Para cambiarla, se cambia
// esa variable y se vuelve a publicar.
//
// IMPORTANTE: solo se protege la PÁGINA. El endpoint /api/ranking sigue
// abierto para que las otras apps conectadas (ej. equipo-mella) lo sigan
// leyendo igual que antes.

export const config = {
  matcher: ["/ranking.html", "/ranking"],
};

export default function middleware(request) {
  const clave = process.env.RANKING_CLAVE;

  // Si todavía no se configuró la clave en Vercel, no se muestra la página
  // (mejor cerrado que abierto por error).
  if (!clave) {
    return new Response(
      "Falta configurar la clave del ranking (variable RANKING_CLAVE en Vercel).",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Basic ")) {
    try {
      // "usuario:contraseña" en base64 (UTF-8, para aceptar tildes y ñ)
      const bytes = Uint8Array.from(atob(auth.slice(6)), (c) => c.charCodeAt(0));
      const texto = new TextDecoder().decode(bytes);
      const contrasena = texto.slice(texto.indexOf(":") + 1);
      if (contrasena === clave) return; // clave correcta: sigue a la página
    } catch (e) {
      // encabezado mal formado: se vuelve a pedir la clave
    }
  }

  return new Response("Se necesita la clave para ver el ranking.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Ranking de mociones", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
