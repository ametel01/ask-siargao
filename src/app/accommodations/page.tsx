import { getPublicSurface } from "@/server/public-pages/public-surface-registry";
import {
  publicKnowledgeHubMetadata,
  renderPublicKnowledgeHub,
} from "@/server/public-pages/responses";

const surface = getPublicSurface("accommodations");

export const dynamic = "force-dynamic";
export const metadata = publicKnowledgeHubMetadata(surface);

export default function AccommodationsHubPage() {
  return renderPublicKnowledgeHub(surface);
}
