import type { Metadata } from "next";

import { PrivacyNoticePage } from "@/features/legal/PrivacyNoticePage";

export const metadata: Metadata = {
  title: "Privacy Notice | Ask Siargao",
  description: "How Ask Siargao processes chat, account, location, provider, and operational data.",
};

export default function Page() {
  return <PrivacyNoticePage />;
}
