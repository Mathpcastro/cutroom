const PRIVATE_BACKEND = "https://cutroom-editor.abloombat.chatgpt.site/api/download";
const MAX_BODY_BYTES = 4096;
const DOWNLOAD_URLS = {
  windows: "https://github.com/Mathpcastro/cutroom/releases/download/v0.6.1/CutRoom.Setup.0.6.1.exe",
  "macos-arm64": "https://github.com/Mathpcastro/cutroom/releases/download/v0.6.1/CutRoom-0.6.1-mac-arm64.dmg",
  "macos-x64": "https://github.com/Mathpcastro/cutroom/releases/download/v0.6.1/CutRoom-0.6.1-mac-x64.dmg",
};

function fail(response, status, error) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify({ ok: false, error }));
}

function firstHeader(value) {
  return (Array.isArray(value) ? value[0] : value)?.split(",", 1)[0]?.trim() || "";
}

export default async function handler(request, response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");

  if (request.method !== "POST") return fail(response, 405, "Método não permitido.");

  const origin = firstHeader(request.headers.origin);
  const host = firstHeader(request.headers["x-forwarded-host"] || request.headers.host);
  const protocol = firstHeader(request.headers["x-forwarded-proto"]) || "https";
  if (!origin || origin !== `${protocol}://${host}` || firstHeader(request.headers["sec-fetch-site"]) === "cross-site")
    return fail(response, 403, "Origem não permitida.");

  if (!firstHeader(request.headers["content-type"]).toLowerCase().startsWith("application/json"))
    return fail(response, 415, "Formato de envio inválido.");
  if (Number(firstHeader(request.headers["content-length"])) > MAX_BODY_BYTES)
    return fail(response, 413, "Envio maior que o permitido.");

  let body = request.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch { return fail(response, 400, "Não foi possível ler o formulário. Tente novamente."); }
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return fail(response, 400, "Preencha o formulário.");

  const platform = body.platform || "windows";
  if (!Object.hasOwn(DOWNLOAD_URLS, platform))
    return fail(response, 422, "Selecione Windows ou uma versão compatível de macOS.");

  let payload;
  try { payload = JSON.stringify(body); }
  catch { return fail(response, 400, "Não foi possível ler o formulário. Tente novamente."); }
  if (Buffer.byteLength(payload, "utf8") > MAX_BODY_BYTES)
    return fail(response, 413, "Envio maior que o permitido.");

  const token = process.env.CUTROOM_SITES_BYPASS_TOKEN;
  if (!token) return fail(response, 503, "O cadastro está indisponível. Tente novamente em instantes.");

  try {
    const upstream = await fetch(PRIVATE_BACKEND, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "OAI-Sites-Authorization": `Bearer ${token}`,
      },
      body: payload,
      signal: AbortSignal.timeout(8000),
    });
    let content = await upstream.text();
    if (upstream.ok && (upstream.headers.get("content-type") || "").includes("application/json")) {
      try {
        const result = JSON.parse(content);
        if (result?.ok === true) {
          result.downloadUrl = DOWNLOAD_URLS[platform];
          content = JSON.stringify(result);
        }
      } catch {
        // Preserve the private backend's response if it is not valid JSON.
      }
    }
    response.statusCode = upstream.status;
    response.setHeader("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    response.end(content);
  } catch {
    fail(response, 503, "Não foi possível salvar seu cadastro. Tente novamente.");
  }
}
