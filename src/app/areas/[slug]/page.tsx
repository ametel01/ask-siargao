import { renderPublicHumanPage } from "@/server/public-pages/responses";

export default async function AreaPublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return renderPublicHumanPage("areas", slug);
}
