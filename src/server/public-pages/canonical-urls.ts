export const canonicalSiteOrigin = "https://www.asksiargao.com";
export const canonicalSitemapUrl = `${canonicalSiteOrigin}/sitemap.xml`;

export function buildCanonicalSiteUrl(pathname: string) {
  return new URL(pathname, `${canonicalSiteOrigin}/`).href;
}
