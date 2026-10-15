import type { MetadataRoute } from "next";
import { urlDoSite } from "@/lib/site";

/** Telas de conta e API ficam fora do índice; o resto é público. URL absoluta, nunca localhost. */
export default function robots(): MetadataRoute.Robots {
  const base = urlDoSite();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/configuracoes", "/amigos", "/games/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
