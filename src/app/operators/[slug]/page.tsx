import { renderPublicHumanPage } from "@/server/public-pages/responses";

export default async function OperatorPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return renderPublicHumanPage("operators", slug);
}
