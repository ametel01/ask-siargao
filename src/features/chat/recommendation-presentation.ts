import type {
  ItineraryPlanArtifact,
  RecommendationCardArtifact,
} from "@/features/chat/saved-trip-client";

export type RecommendationCardRole = "best" | "alternative" | "fallback" | "confirm" | "avoid";

export type RecommendationCardPresentation = {
  card: RecommendationCardArtifact;
  role: RecommendationCardRole;
  roleLabel: string;
  fitRationale: string;
  isPrimary: boolean;
};

export type RecommendationSetPresentation = {
  cards: readonly RecommendationCardPresentation[];
  hasComparison: boolean;
};

const maximumAlternativeCards = 2;

export function projectRecommendationSet({
  cards,
  itineraries = [],
}: {
  cards: readonly RecommendationCardArtifact[];
  itineraries?: readonly ItineraryPlanArtifact[];
}): RecommendationSetPresentation {
  const routeStopTitles = new Set(
    itineraries.flatMap((plan) => plan.stops.map((stop) => normalizedIdentity(stop.title))),
  );
  const routeBackedCards = routeStopTitles.size
    ? cards.filter((card) => routeStopTitles.has(normalizedIdentity(card.title)))
    : [];
  const routeBackedCardSet = new Set(routeBackedCards);
  const cardsForDisplay =
    routeBackedCards.length >= 2 ? cards.filter((card) => !routeBackedCardSet.has(card)) : cards;

  const usefulCards = cardsForDisplay.flatMap((card) => {
    const fitRationale = usefulRecommendationReasons(card.fitReasons)[0];
    if (!fitRationale) {
      return [];
    }
    return [{ card, fitRationale }];
  });
  const explicitBestIndex = usefulCards.findIndex(
    ({ card }) => card.decision?.label === "best_fit",
  );
  const hasExplicitBest = explicitBestIndex >= 0;
  const orderedCards = hasExplicitBest
    ? [
        usefulCards[explicitBestIndex],
        ...usefulCards.filter((_, index) => index !== explicitBestIndex),
      ]
    : usefulCards;
  const visibleLimit = hasExplicitBest
    ? 1 + maximumAlternativeCards
    : Math.min(orderedCards.length, maximumAlternativeCards + 1);

  return {
    hasComparison: orderedCards.length > 1,
    cards: orderedCards.slice(0, visibleLimit).map(({ card, fitRationale }, index) => {
      const role = recommendationRole(card, index, hasExplicitBest);
      return {
        card,
        fitRationale,
        role,
        roleLabel: recommendationRoleLabel(role),
        isPrimary: role === "best",
      };
    }),
  };
}

export function usefulRecommendationReasons(reasons: readonly string[]) {
  return reasons.filter((reason) => !isRedundantRecommendationReason(reason)).slice(0, 1);
}

function recommendationRole(
  card: RecommendationCardArtifact,
  index: number,
  hasExplicitBest: boolean,
): RecommendationCardRole {
  switch (card.decision?.label) {
    case "best_fit":
      return "best";
    case "fallback":
      return "fallback";
    case "needs_confirmation":
      return "confirm";
    case "avoid_today":
      return "avoid";
    case "good_now":
      return hasExplicitBest ? "alternative" : "alternative";
    default:
      return hasExplicitBest || index > 0 ? "alternative" : "alternative";
  }
}

function recommendationRoleLabel(role: RecommendationCardRole) {
  switch (role) {
    case "best":
      return "Best fit";
    case "alternative":
      return "Alternative";
    case "fallback":
      return "Fallback";
    case "confirm":
      return "Confirm first";
    case "avoid":
      return "Avoid today";
  }
}

function normalizedIdentity(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function isRedundantRecommendationReason(reason: string) {
  return [
    /google places/i,
    /matching what you asked/i,
    /returned\s+#?\d+/i,
    /\btop\b.*\bmatch\b/i,
    /\blisted as\b/i,
    /\beasy to reach\b/i,
    /\bopen\b/i,
    /\bwell rated\b/i,
  ].some((pattern) => pattern.test(reason));
}
