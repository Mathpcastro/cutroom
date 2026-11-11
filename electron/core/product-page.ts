import { Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export function publicProductUrl(value: string) {
  const input = value.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : "https://" + input);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port ||
      !url.hostname.includes(".") || isIP(url.hostname) || url.hostname.endsWith(".localhost")) {
    throw new Error("Use o link público da página do produto.");
  }
  url.hash = "";
  return url;
}

export function isPublicProductAddress(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return a > 0 && a < 224 && a !== 10 && a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
}

const MAX_BYTES = 768 * 1024;
async function readHtml(url: URL, signal: AbortSignal): Promise<{ html?: string; redirect?: string }> {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  const addresses = await resolver.resolve4(url.hostname);
  if (!addresses.length || addresses.some((address) => !isPublicProductAddress(address))) throw new Error("A página do produto precisa estar em um endereço público.");
  signal.throwIfAborted();
  // Connect to the validated address directly, while retaining the origin for TLS and HTTP.
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: addresses[0], servername: url.hostname,
      path: url.pathname + url.search, method: "GET", signal,
      headers: { Host: url.host, Accept: "text/html,text/plain", "User-Agent": "Videosell Product Onboarding" },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.destroy();
        resolve({ redirect: res.headers.location });
        return;
      }
      if (status !== 200 || !/^text\/(html|plain)\b/i.test(res.headers["content-type"] ?? "")) {
        res.destroy();
        reject(new Error("Não consegui ler essa página. Cole uma descrição ou preencha a marca manualmente."));
        return;
      }
      const buffers: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        const remaining = MAX_BYTES - size;
        buffers.push(chunk.subarray(0, remaining));
        size += chunk.length;
        if (size >= MAX_BYTES) {
          resolve({ html: Buffer.concat(buffers).toString("utf8") });
          res.destroy();
        }
      });
      res.on("end", () => resolve({ html: Buffer.concat(buffers).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

export async function readProductPage(input: string) {
  let url = publicProductUrl(input);
  const signal = AbortSignal.timeout(14_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const page = await readHtml(url, signal);
    if (page.redirect) {
      url = publicProductUrl(new URL(page.redirect, url).href);
      continue;
    }
    const html = page.html ?? "";
    const title = /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim().slice(0, 200) ?? "";
    const text = html.replace(/<!--[^]*?-->|<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, 11_000);
    if (text.length < 80) throw new Error("A página retornou pouco texto. Use o caminho por prompt ou preencha manualmente.");
    return { url: url.href, title, text };
  }
  throw new Error("A página fez redirecionamentos demais.");
}

