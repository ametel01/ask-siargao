import { getPublicSurface } from "@/server/public-pages/public-surface-registry";
import {
  publicKnowledgeHubMetadata,
  renderPublicKnowledgeHub,
} from "@/server/public-pages/responses";

const surface = getPublicSurface("operators");

export const dynamic = "force-dynamic";
export const metadata = publicKnowledgeHubMetadata(surface);

export default function OperatorsHubPage() {
  return renderPublicKnowledgeHub(surface);
}
