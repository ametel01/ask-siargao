export type GuidePerson = {
  name: string;
  role: string;
};

export type GuideImage = {
  src: string;
  alt: string;
  caption: string;
};

export type GuideContentItem = {
  title: string;
  body: string;
  note?: string;
};

export type GuideSection = {
  id: string;
  title: string;
  introduction: string;
  items: readonly GuideContentItem[];
};

export type GuideComparison = {
  title: string;
  introduction: string;
  columns: readonly [string, string, string];
  rows: readonly (readonly [string, string, string])[];
};

export type GuideTravelTime = {
  from: string;
  to: string;
  estimate: string;
  planFor: string;
};

export type GuideMapStop = {
  label: string;
  position: "north" | "west" | "center" | "south" | "east";
  note: string;
};

export type GuideRealityCheck = {
  analyticsKey: "activity_replacement" | "hotel_location" | "no_scooter" | "weather";
  label: string;
  prompt: string;
};

export type GuideFaq = {
  question: string;
  answer: string;
};

export type GuideSource = {
  name: string;
  publisher: string;
  url: string;
  usedFor: string;
};

export type PlanningGuide = {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  quickRecommendation: string;
  image: GuideImage;
  lastChecked: string;
  readingMinutes: number;
  author: GuidePerson;
  reviewer: GuidePerson;
  sections: readonly GuideSection[];
  comparison: GuideComparison;
  travelTimes: readonly GuideTravelTime[];
  mapStops: readonly GuideMapStop[];
  realityChecks: readonly GuideRealityCheck[];
  faqs: readonly GuideFaq[];
  relatedSlugs: readonly string[];
  limitations: readonly string[];
  sources: readonly GuideSource[];
};
