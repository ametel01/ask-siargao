import { getPublicSurface } from "@/server/public-pages/public-surface-registry";
import {
  publicKnowledgeHubMetadata,
  renderPublicKnowledgeHub,
} from "@/server/public-pages/responses";

const surface = getPublicSurface("risks");

export const dynamic = "force-dynamic";
export const metadata = publicKnowledgeHubMetadata(surface);

export default function RisksHubPage() {
  return renderPublicKnowledgeHub(surface);
}
