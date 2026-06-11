import { describe, expect, it } from "vitest";
import { AmbassadorProgram } from "../src/ambassadorProgram.js";
import { DEFAULT_ACTIVITIES } from "../src/activities.js";
import { calculateActivityCoins, calculateEgcCoins, calculateMonthlySummary, normalizeQuantity } from "../src/coins.js";
import { loadConfig } from "../src/config.js";
import { monthlyReminderText } from "../src/slackService.js";
import { displaySlackNickname, normalizeSlackNickname } from "../src/text.js";

describe("coin calculation", () => {
  const ambassadorConfig = loadConfig().programs[0];

  it("requires proof only for screenshot-marked activity types", () => {
    const proofRequiredKeys = DEFAULT_ACTIVITIES
      .filter((activity) => activity.requiresProof)
      .map((activity) => activity.key);

    expect(proofRequiredKeys).toEqual([
      "vacancy_student_chats",
      "events_internships_student_chats",
      "teacher_contact",
      "career_center_channel",
      "telegram_uni_career_hub_post"
    ]);
  });

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
    expect(summary.hasActivity).toBe(true);
    expect(summary.bonusCoins).toBe(10);
    expect(summary.totalCoins).toBe(30);
    expect(summary.reportLine).toBe("@anna - 30 coins");
  });

  it("keeps spaces in Slack display names", () => {
    expect(normalizeSlackNickname(" @Diana   Bondarenko ")).toBe("Diana Bondarenko");
    expect(displaySlackNickname("Diana Bondarenko")).toBe("@Diana Bondarenko");
  });

  it("marks empty monthly summary as no activity", () => {
    const summary = calculateMonthlySummary("2026-04", undefined, "anna", undefined, [], {
      bonusThreshold: 3,
      bonusCoins: 10,
      bonusDistinctBy: "activity"
    });

    expect(summary.hasActivity).toBe(false);
  });

  it("formats the monthly reminder message", () => {
    const message = monthlyReminderText(
      ambassadorConfig,
      "2026-04",
      "https://ambassador-ap-production.up.railway.app/ambassador?month=2026-04"
    );

    expect(message).toContain("Привіт, амбасадори!");
    expect(message).toContain("чекліст за *квітень 2026*");
    expect(message).toContain("<https://ambassador-ap-production.up.railway.app/ambassador?month=2026-04|Заповнити чекліст>");
    expect(message).toContain("юнікоіни");
  });

  it("calculates EGC reports with story series as a separate input", () => {
    const summary = calculateEgcCoins({
      participantName: "Diana Bondarenko",
      slackNickname: "Diana Bondarenko",
      month: "2026-05",
      instagramStories: 10,
      instagramVacancyStories: 2,
      instagramReels: 1,
      instagramPosts: 1,
      linkedinPosts: 1,
      linkedinVacancyPosts: 0,
      instagramStorySeries: 1,
      storySeriesDays: ["2026-05-12"]
    });

    expect(summary.totalCoins).toBe(56);
    expect(summary.breakdown).toContain("Дні з серією сторіз в Instagram: 1 (3 coins)");
  });

  it("keeps monthly reports focused on participants with activity", async () => {
    const program = new AmbassadorProgram(
      ambassadorConfig,
      {
        listMonthlySummaries: async () => [
          { slackNickname: "anna", hasActivity: true, totalCoins: 30, reportLine: "@anna - 30 coins" },
          { slackNickname: "maksym", hasActivity: false, totalCoins: 0, reportLine: "@maksym - 0 coins" }
        ]
      } as any,
      {} as any
    );

    await expect(program.buildMonthlyReport("2026-04")).resolves.toBe(
      "Ambassador coins report - квітень 2026\n\n@anna - 30 coins"
    );
  });
});
