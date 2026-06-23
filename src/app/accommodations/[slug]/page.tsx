import { renderPublicHumanPage } from "@/server/public-pages/responses";

export default async function AccommodationPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return renderPublicHumanPage("accommodations", slug);
}
