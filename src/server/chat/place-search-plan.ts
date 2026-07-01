export type PlaceSearchPlanInput = {
  category?: string;
  meal?: string | null;
  location?: string | null;
  areaScope?: string | null;
  constraints?: readonly unknown[];
  latestUserTurn?: string;
  recentUserContext?: string;
  tripContext?: {
    temporaryModifiers?: readonly unknown[];
  };
};

export type PlaceSearchPlan = {
  query: string;
  searchTerm: string;
  includedType?: GooglePlacesIncludedType;
};

export type GooglePlacesIncludedType =
  | "atm"
  | "bar"
  | "cafe"
  | "laundry"
  | "pharmacy"
  | "restaurant";

export function buildPlaceSearchPlan(input: PlaceSearchPlanInput): PlaceSearchPlan {
  const location = input.location ?? "General Luna";
  const searchTerm = inferPlaceSearchTerm(input);
  const locationPhrase = input.areaScope === "nearby" ? `near ${location}` : `in ${location}`;
  const includedType = inferIncludedType(searchTerm);

  return {
    query: `${searchTerm} ${locationPhrase} Siargao`,
    searchTerm,
    ...(includedType ? { includedType } : {}),
  };
}

function inferPlaceSearchTerm(input: PlaceSearchPlanInput) {
  const primaryIntentText = `${input.latestUserTurn ?? ""} ${input.recentUserContext ?? ""}`;
  const budgetFocused =
    hasConstraint(input.constraints, "cheaper") ||
    hasConstraint(input.constraints, "budget") ||
    hasTemporaryModifier(input.tripContext?.temporaryModifiers, "cheaper");
  const familyFocused = hasConstraint(input.constraints, "family_friendly");

  if (input.category === "service") {
    return inferServiceSearchTerm(primaryIntentText);
  }
  if (input.category === "bar") {
    return "bar";
  }
  if (input.category === "coffee") {
    if (budgetFocused) {
      return "budget cafe";
    }
    if (familyFocused) {
      return "family cafe";
    }
    return /\bbeachfront\b/i.test(primaryIntentText) ? "beachfront cafe" : "cafe";
  }
  if (input.category === "activity_place") {
    if (/\bbeachfront\b/i.test(primaryIntentText)) {
      return "beachfront places";
    }
    if (/\bcovered|indoors?|inside\b/i.test(primaryIntentText)) {
      return "covered places";
    }
    return "places to go";
  }
  if (/\bseafood\b/i.test(primaryIntentText)) {
    return "seafood restaurant";
  }
  if (
    /\bbeachfront\b/i.test(primaryIntentText) &&
    /\b(caf[eé]s?|coffee)\b/i.test(primaryIntentText)
  ) {
    return "beachfront cafe";
  }
  if (/\bbeachfront\b/i.test(primaryIntentText)) {
    return "beachfront restaurant";
  }
  if (/\b(caf[eé]s?|coffee)\b/i.test(primaryIntentText)) {
    return "cafe";
  }
  if (/\b(bars?|nightlife|drinks?)\b/i.test(primaryIntentText)) {
    return "bar";
  }
  if (/\bproper|sit[-\s]?down|not\s+car[ie]nderia\b/i.test(input.latestUserTurn ?? "")) {
    return "sit down restaurant";
  }
  if (budgetFocused) {
    return "cheap restaurant";
  }
  if (familyFocused) {
    return "family restaurant";
  }
  if (input.meal === "breakfast") {
    return "breakfast restaurants";
  }
  if (input.meal === "lunch") {
    return "lunch restaurants";
  }
  if (input.meal === "dinner") {
    return "dinner restaurants";
  }
  return "good restaurant";
}

export function inferServiceSearchTerm(content: string) {
  const wantsClinic = /\bclinics?\b/i.test(content);
  const wantsPharmacy = /\bpharmac(?:y|ies)|drugstores?\b/i.test(content);
  if (wantsClinic && wantsPharmacy) {
    return "clinic pharmacy";
  }
  if (wantsClinic) {
    return "clinic";
  }
  if (wantsPharmacy) {
    return "pharmacy";
  }
  if (/\batms?|cash\s+machines?\b/i.test(content)) {
    return "atm";
  }
  if (/\blaundr(?:y|ies)\b/i.test(content)) {
    return "laundry";
  }
  if (/\bscooter\s+rentals?|motorbike\s+rentals?\b/i.test(content)) {
    return "scooter rental";
  }
  return "local service";
}

function inferIncludedType(searchTerm: string): GooglePlacesIncludedType | undefined {
  if (/\bclinic|scooter|motorbike\b/i.test(searchTerm)) {
    return undefined;
  }
  if (/\bcafe\b/i.test(searchTerm)) {
    return "cafe";
  }
  if (/\bbar\b/i.test(searchTerm)) {
    return "bar";
  }
  if (/\bpharmacy\b/i.test(searchTerm)) {
    return "pharmacy";
  }
  if (/\batm\b/i.test(searchTerm)) {
    return "atm";
  }
  if (/\blaundry\b/i.test(searchTerm)) {
    return "laundry";
  }
  if (!/\brestaurant|breakfast|lunch|dinner|seafood|sit down\b/i.test(searchTerm)) {
    return undefined;
  }
  return "restaurant";
}

function hasConstraint(constraints: readonly unknown[] | undefined, constraint: string) {
  return constraints?.includes(constraint) ?? false;
}

function hasTemporaryModifier(modifiers: readonly unknown[] | undefined, modifier: string) {
  return modifiers?.includes(modifier) ?? false;
}
