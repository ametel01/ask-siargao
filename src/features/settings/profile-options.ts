export type ProfileOption<Value extends string = string> = {
  value: Value;
  label: string;
};

function optionRegistry<const Values extends readonly string[]>(
  values: Values,
  labels: Record<Values[number], string>,
): readonly ProfileOption<Values[number]>[] {
  return Array.from(values, (value) => ({ value, label: labels[value as Values[number]] }));
}

export const budgetLevelValues = ["budget", "mid_range", "premium", "mixed"] as const;
export type BudgetLevel = (typeof budgetLevelValues)[number];
export const budgetLevelOptions = optionRegistry(budgetLevelValues, {
  budget: "Budget",
  mid_range: "Mid-range",
  premium: "Premium",
  mixed: "A mix of budgets",
});

export const surfAbilityValues = ["beginner", "intermediate", "advanced"] as const;
export type SurfAbility = (typeof surfAbilityValues)[number];
export const surfAbilityOptions = optionRegistry(surfAbilityValues, {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
});

export const travelerTypeValues = [
  "solo",
  "couple",
  "friends",
  "family",
  "family_with_kids",
  "group",
] as const;
export type TravelerType = (typeof travelerTypeValues)[number];
export const travelerTypeOptions = optionRegistry(travelerTypeValues, {
  solo: "Solo traveler",
  couple: "Couple",
  friends: "Friends",
  family: "Family",
  family_with_kids: "Family with children",
  group: "Group",
});

export const foodNeedValues = [
  "vegetarian",
  "vegan",
  "halal",
  "gluten_free",
  "seafood_free",
] as const;
export type FoodNeed = (typeof foodNeedValues)[number];
export const foodNeedOptions = optionRegistry(foodNeedValues, {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  halal: "Halal",
  gluten_free: "Gluten-free",
  seafood_free: "Avoid seafood",
});

export const transportModeValues = ["walk", "scooter", "tricycle", "van", "unknown"] as const;
export type TransportModeValue = (typeof transportModeValues)[number];
export const transportModeOptions = optionRegistry(transportModeValues, {
  walk: "Walking",
  scooter: "Scooter",
  tricycle: "Tricycle",
  van: "Van or transfer",
  unknown: "Not sure yet",
});

export const weatherPreferenceValues = ["avoid_rain", "flexible"] as const;
export type WeatherPreference = (typeof weatherPreferenceValues)[number];
export const weatherPreferenceOptions = optionRegistry(weatherPreferenceValues, {
  avoid_rain: "Prefer drier plans",
  flexible: "Happy to adapt to rain",
});

export const durableConstraintValues = [
  "with_kids",
  "budget_cheap",
  "budget_mid",
  "budget_premium",
  "rain_avoidance",
  "avoid_rocky_beach",
  "no_scooter",
  "quiet_sleep",
] as const;
export type DurableConstraint = (typeof durableConstraintValues)[number];
export const durableConstraintOptions = optionRegistry(durableConstraintValues, {
  with_kids: "Traveling with children",
  budget_cheap: "Budget-conscious",
  budget_mid: "Mid-range budget",
  budget_premium: "Premium budget",
  rain_avoidance: "Prefer drier plans",
  avoid_rocky_beach: "Avoid rocky beaches",
  no_scooter: "No scooter",
  quiet_sleep: "Quiet sleep matters",
});
export const groupNeedOptions = durableConstraintOptions.filter(
  (option) => option.value === "with_kids" || option.value === "avoid_rocky_beach",
);

export const currentAreaValues = [
  "Cloud 9",
  "General Luna",
  "Del Carmen",
  "Dapa",
  "Siargao Island",
] as const;
export const currentAreaOptions = optionRegistry(currentAreaValues, {
  "Cloud 9": "Cloud 9",
  "General Luna": "General Luna",
  "Del Carmen": "Del Carmen",
  Dapa: "Dapa",
  "Siargao Island": "Siargao Island",
});

const legacyAliases = {
  budgetLevel: {
    cheap: "budget",
    mid: "mid_range",
    "mid-range": "mid_range",
  },
  surfAbility: {
    Beginner: "beginner",
    Intermediate: "intermediate",
    Advanced: "advanced",
  },
  travelerType: {
    Solo: "solo",
    Couple: "couple",
    Friends: "friends",
    Family: "family",
    "Family with kids": "family_with_kids",
    "Family with children": "family_with_kids",
    Group: "group",
  },
} as const;

export function optionValueOrLegacy<Value extends string>(
  value: string | null | undefined,
  options: readonly ProfileOption<Value>[],
  aliases: Readonly<Record<string, Value>> = {},
): Value | string | "" {
  if (!value) {
    return "";
  }
  if (options.some((option) => option.value === value)) {
    return value as Value;
  }
  return aliases[value] ?? value;
}

export function isOptionValue<Value extends string>(
  value: unknown,
  options: readonly { value: Value }[],
): value is Value {
  return typeof value === "string" && options.some((option) => option.value === value);
}

export function normalizeBudgetLevel(value: string | null | undefined): BudgetLevel | undefined {
  const normalized = optionValueOrLegacy(value, budgetLevelOptions, legacyAliases.budgetLevel);
  return isOptionValue(normalized, budgetLevelOptions) ? normalized : undefined;
}

export function normalizeSurfAbility(value: string | null | undefined): SurfAbility | undefined {
  const normalized = optionValueOrLegacy(value, surfAbilityOptions, legacyAliases.surfAbility);
  return isOptionValue(normalized, surfAbilityOptions) ? normalized : undefined;
}

export function normalizeTravelerType(value: string | null | undefined): TravelerType | undefined {
  const normalized = optionValueOrLegacy(value, travelerTypeOptions, legacyAliases.travelerType);
  return isOptionValue(normalized, travelerTypeOptions) ? normalized : undefined;
}

export function legacyOptionLabel(value: string) {
  return `Legacy value: ${value}`;
}

export function normalizedMultiValue(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

export function addMultiValue(
  values: readonly string[],
  value: string,
  maxLength: number,
  maxItems: number,
) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { values: [...values], error: "Enter a value before adding it." };
  }
  if (trimmed.length > maxLength) {
    return { values: [...values], error: `Use ${maxLength} characters or fewer.` };
  }
  if (values.some((existing) => normalizedMultiValue(existing) === normalizedMultiValue(trimmed))) {
    return { values: [...values], error: "That value is already added." };
  }
  if (values.length >= maxItems) {
    return { values: [...values], error: `You can add up to ${maxItems} values.` };
  }
  return { values: [...values, trimmed] };
}

export function profileBudgetForTripContext(value: string | null | undefined) {
  switch (normalizeBudgetLevel(value)) {
    case "budget":
      return "cheap" as const;
    case "mid_range":
    case "mixed":
      return "mid" as const;
    case "premium":
      return "premium" as const;
    default:
      return undefined;
  }
}

export const profileLegacyAliases = legacyAliases;
