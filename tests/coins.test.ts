import { afterEach, describe, expect, it, vi } from "vitest";
import { AmbassadorProgram } from "../src/ambassadorProgram.js";
import { DEFAULT_ACTIVITIES } from "../src/activities.js";
import { calculateActivityCoins, calculateEgcCoins, calculateMonthlySummary, normalizeQuantity } from "../src/coins.js";
import { loadConfig } from "../src/config.js";
import { NotionService } from "../src/notionService.js";
import { monthlyReminderText, monthlyReportText } from "../src/slackService.js";
import { displaySlackNickname, normalizeSlackNickname } from "../src/text.js";
import { EGC_MAX_PROOF_FILES, NOTION_MULTIPART_CHUNK_SIZE_BYTES } from "../src/uploadLimits.js";

describe("coin calculation", () => {
  const ambassadorConfig = loadConfig().programs[0];
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

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

  it("mentions the configured owner in scheduled monthly reports", () => {
    const egcConfig = {
      ...loadConfig().programs.find((program) => program.key === "egc")!,
      slackReportMentionUserId: "U07LJE64188"
    };

    const message = monthlyReportText(egcConfig, "2026-05", "EGC coins to issue - травень 2026\n\n@diana - 22 coins");

    expect(message).toContain("<@U07LJE64188>, нагадування: видай EGC коіни за *травень 2026*.");
    expect(message).toContain("EGC coins to issue - травень 2026");
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

  it("rejects EGC reports with more than ten proof files", async () => {
    const egcConfig = loadConfig().programs.find((program) => program.key === "egc")!;
    const program = new AmbassadorProgram(
      egcConfig,
      {
        isConfigured: () => true,
        createEgcReport: async () => {
          throw new Error("Should not create report when file limit is exceeded.");
        }
      } as any,
      { sendEgcSubmissionNotification: async () => undefined } as any
    );
    const files = Array.from({ length: EGC_MAX_PROOF_FILES + 1 }, (_, index) => ({
      fieldname: "egcProofs",
      originalname: `proof-${index}.jpg`,
      mimetype: "image/jpeg",
      size: 100
    })) as Express.Multer.File[];

    await expect(
      program.submitEgcReport(
        {
          participantName: "Diana Bondarenko",
          slackNickname: "Diana Bondarenko",
          month: "2026-05",
          instagramStories: 1,
          instagramVacancyStories: 0,
          instagramReels: 0,
          instagramPosts: 0,
          linkedinPosts: 0,
          linkedinVacancyPosts: 0,
          instagramStorySeries: 0,
          storySeriesDays: []
        },
        files
      )
    ).rejects.toThrow(`максимум ${EGC_MAX_PROOF_FILES} файлів`);
  });

  it("uploads proof files larger than 20 MB using Notion multi-part mode", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "upload-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;
    const service = new NotionService({ notionApiKey: "secret" } as any);
    const file = {
      originalname: "large-proof.png",
      mimetype: "image/png",
      buffer: Buffer.alloc(NOTION_MULTIPART_CHUNK_SIZE_BYTES * 2 + 1),
      size: NOTION_MULTIPART_CHUNK_SIZE_BYTES * 2 + 1
    } as Express.Multer.File;

    await expect((service as any).uploadMultiPartProof(file)).resolves.toBe("upload-id");

    const createBody = JSON.parse(String(calls[0].init?.body));
    expect(createBody).toMatchObject({
      mode: "multi_part",
      filename: "large-proof.png",
      content_type: "image/png",
      number_of_parts: 3
    });
    const sendCalls = calls.filter((call) => call.url.endsWith("/send"));
    expect(sendCalls).toHaveLength(3);
    expect(sendCalls.map((call) => (call.init?.body as FormData).get("part_number"))).toEqual(["1", "2", "3"]);
    expect(calls.at(-1)?.url).toContain("/file_uploads/upload-id/complete");
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
