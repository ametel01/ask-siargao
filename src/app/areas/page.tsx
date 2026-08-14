import { getPublicSurface } from "@/server/public-pages/public-surface-registry";
import {
  publicKnowledgeHubMetadata,
  renderPublicKnowledgeHub,
} from "@/server/public-pages/responses";

const surface = getPublicSurface("areas");

export const dynamic = "force-dynamic";
export const metadata = publicKnowledgeHubMetadata(surface);

export default function AreasHubPage() {
  return renderPublicKnowledgeHub(surface);
}
