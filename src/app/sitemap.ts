import type { MetadataRoute } from "next";
import { urlDoSite } from "@/lib/site";

/** Só as páginas públicas fixas; perfis e partidas são abertos por link compartilhado. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = urlDoSite();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/comunidade`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/seguranca`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
