import { renderPublicHumanPage } from "@/server/public-pages/responses";

export default async function RiskPublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return renderPublicHumanPage("risks", slug);
}
