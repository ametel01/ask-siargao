import { renderPublicHumanPage } from "@/server/public-pages/responses";

export default async function RoutePublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return renderPublicHumanPage("routes", slug);
}
