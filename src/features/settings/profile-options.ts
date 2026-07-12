export type ProfileOption<Value extends string = string> = {
  value: Value;
  label: string;
};

function optionValues<const Options extends readonly ProfileOption[]>(options: Options) {
  return options.map((option) => option.value) as {
    readonly [Index in keyof Options]: Options[Index] extends ProfileOption<infer Value>
      ? Value
      : never;
  };
}

export const budgetLevelOptions = [
  { value: "budget", label: "Budget" },
  { value: "mid_range", label: "Mid-range" },
  { value: "premium", label: "Premium" },
  { value: "mixed", label: "A mix of budgets" },
] as const satisfies readonly ProfileOption[];
export const budgetLevelValues = optionValues(budgetLevelOptions);
export type BudgetLevel = (typeof budgetLevelValues)[number];

export const surfAbilityOptions = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const satisfies readonly ProfileOption[];
export const surfAbilityValues = optionValues(surfAbilityOptions);
export type SurfAbility = (typeof surfAbilityValues)[number];

export const travelerTypeOptions = [
  { value: "solo", label: "Solo traveler" },
  { value: "couple", label: "Couple" },
  { value: "friends", label: "Friends" },
  { value: "family", label: "Family" },
  { value: "family_with_kids", label: "Family with children" },
  { value: "group", label: "Group" },
] as const satisfies readonly ProfileOption[];
export const travelerTypeValues = optionValues(travelerTypeOptions);
export type TravelerType = (typeof travelerTypeValues)[number];

export const foodNeedOptions = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "halal", label: "Halal" },
  { value: "gluten_free", label: "Gluten-free" },
  { value: "seafood_free", label: "Avoid seafood" },
] as const satisfies readonly ProfileOption[];
export const foodNeedValues = optionValues(foodNeedOptions);
export type FoodNeed = (typeof foodNeedValues)[number];

export const transportModeOptions = [
  { value: "walk", label: "Walking" },
  { value: "scooter", label: "Scooter" },
  { value: "tricycle", label: "Tricycle" },
  { value: "van", label: "Van or transfer" },
  { value: "unknown", label: "Not sure yet" },
] as const satisfies readonly ProfileOption[];
export const transportModeValues = optionValues(transportModeOptions);
export type TransportModeValue = (typeof transportModeValues)[number];

export const weatherPreferenceOptions = [
  { value: "avoid_rain", label: "Prefer drier plans" },
  { value: "flexible", label: "Happy to adapt to rain" },
] as const satisfies readonly ProfileOption[];
export const weatherPreferenceValues = optionValues(weatherPreferenceOptions);
export type WeatherPreference = (typeof weatherPreferenceValues)[number];

export const durableConstraintOptions = [
  { value: "with_kids", label: "Traveling with children" },
  { value: "budget_cheap", label: "Budget-conscious" },
  { value: "budget_mid", label: "Mid-range budget" },
  { value: "budget_premium", label: "Premium budget" },
  { value: "rain_avoidance", label: "Prefer drier plans" },
  { value: "avoid_rocky_beach", label: "Avoid rocky beaches" },
  { value: "no_scooter", label: "No scooter" },
  { value: "quiet_sleep", label: "Quiet sleep matters" },
] as const satisfies readonly ProfileOption[];
export const durableConstraintValues = optionValues(durableConstraintOptions);
export type DurableConstraint = (typeof durableConstraintValues)[number];
export const groupNeedOptions = durableConstraintOptions.filter(
  (option) => option.value === "with_kids" || option.value === "avoid_rocky_beach",
);

export const currentAreaOptions = [
  { value: "Cloud 9", label: "Cloud 9" },
  { value: "General Luna", label: "General Luna" },
  { value: "Del Carmen", label: "Del Carmen" },
  { value: "Dapa", label: "Dapa" },
  { value: "Siargao Island", label: "Siargao Island" },
] as const satisfies readonly ProfileOption[];
export const currentAreaValues = optionValues(currentAreaOptions);
export type CurrentAreaValue = (typeof currentAreaValues)[number];

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
