import { describe, expect, test } from "bun:test";

import {
  addMultiValue,
  budgetLevelOptions,
  currentAreaOptions,
  durableConstraintOptions,
  foodNeedOptions,
  groupNeedOptions,
  legacyOptionLabel,
  normalizeBudgetLevel,
  normalizeSurfAbility,
  normalizeTravelerType,
  optionValueOrLegacy,
  profileBudgetForTripContext,
  surfAbilityOptions,
  transportModeOptions,
  travelerTypeOptions,
  weatherPreferenceOptions,
} from "@/features/settings/profile-options";

describe("profile option registry", () => {
  test("keeps stable values independent from traveler-facing labels", () => {
    expect(budgetLevelOptions).toContainEqual({ value: "mid_range", label: "Mid-range" });
    expect(profileBudgetForTripContext("mid_range")).toBe("mid");
    expect(profileBudgetForTripContext("Mid-range")).toBeUndefined();
  });

  test("round-trips every enumerated control through the one authoritative registry", () => {
    const registries = [
      budgetLevelOptions,
      surfAbilityOptions,
      travelerTypeOptions,
      foodNeedOptions,
      transportModeOptions,
      weatherPreferenceOptions,
      currentAreaOptions,
      durableConstraintOptions,
    ];

    for (const options of registries) {
      for (const option of options) {
        expect(optionValueOrLegacy(option.value, options)).toBe(option.value);
        expect(option.label).not.toBe("");
      }
    }

    expect(groupNeedOptions.map((option) => option.value)).toEqual([
      "with_kids",
      "avoid_rocky_beach",
    ]);
  });

  test("maps recognized historical values while retaining unknown values for display", () => {
    expect(normalizeBudgetLevel("cheap")).toBe("budget");
    expect(normalizeSurfAbility("Intermediate")).toBe("intermediate");
    expect(normalizeTravelerType("Family with kids")).toBe("family_with_kids");
    expect(legacyOptionLabel("Ocean whisperer")).toBe("Legacy value: Ocean whisperer");
  });

  test("adds bounded custom values without comma splitting or duplicate normalization", () => {
    expect(addMultiValue(["Surf, yoga"], "  food  ", 60, 20)).toEqual({
      values: ["Surf, yoga", "food"],
    });
    expect(addMultiValue(["Surf"], " surf ", 60, 20).error).toBe("That value is already added.");
    expect(addMultiValue([], "", 60, 20).error).toBe("Enter a value before adding it.");
    expect(addMultiValue([], "x".repeat(61), 60, 20).error).toBe("Use 60 characters or fewer.");
    expect(
      addMultiValue(
        Array.from({ length: 20 }, (_, index) => `${index}`),
        "new",
        60,
        20,
      ).error,
    ).toBe("You can add up to 20 values.");
  });
});
