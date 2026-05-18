import { describe, expect, it } from "vitest";
import { DEFAULT_ACTIVITIES } from "../src/activities.js";
import { calculateActivityCoins, calculateMonthlySummary, normalizeQuantity } from "../src/coins.js";

describe("coin calculation", () => {
  it("multiplies quantity only for quantity-based activities", () => {
    const quantityActivity = DEFAULT_ACTIVITIES.find((activity) => activity.key === "vacancy_student_chats")!;
    const fixedActivity = DEFAULT_ACTIVITIES.find((activity) => activity.key === "own_university_lecture")!;

    expect(calculateActivityCoins(quantityActivity, 4)).toBe(20);
    expect(calculateActivityCoins(fixedActivity, 4)).toBe(50);
    expect(normalizeQuantity(quantityActivity, 2.8)).toBe(2);
  });

  it("adds bonus for three distinct completed activities", () => {
    const submittedActivities = DEFAULT_ACTIVITIES.slice(0, 3).map((activity) => ({
      activity,
      quantity: 1,
      baseCoins: activity.coinsPerUnit
    }));

    const summary = calculateMonthlySummary("2026-04", undefined, "anna", undefined, submittedActivities, {
      bonusThreshold: 3,
      bonusCoins: 10,
      bonusDistinctBy: "activity"
    });

    expect(summary.baseCoins).toBe(20);
    expect(summary.bonusCoins).toBe(10);
    expect(summary.totalCoins).toBe(30);
    expect(summary.reportLine).toBe("@anna - 30 coins");
  });
});
