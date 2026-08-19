import "dotenv/config";
import { z } from "zod";
import { DEFAULT_ACTIVITIES } from "./activities.js";
import { DEFAULT_EGC_COIN_RATES } from "./coins.js";
import type { Activity, BonusDistinctBy, EgcCoinRates, ProgramConfig } from "./types.js";

const DEFAULT_AMBASSADOR_DETAILS_URL =
  "https://www.notion.so/Ambassador-program-for-students-2cbce9899cb78073b0b7f3e9df2bf82b?source=copy_link";
const DEFAULT_EGC_DETAILS_URL =
  "https://app.notion.com/p/UGC-aka-Universe-Generated-Content-176ce9899cb780d3ab12d4b76ba14334?source=copy_link";
const DEFAULT_EGC_REPORTS_DATA_SOURCE_ID = "2e8ce989-9cb7-809d-83df-000b244a691e";
const DEFAULT_ACTIVITY_TRACKER_ID = "66083f8f-3526-4eec-a622-9a341e21be82";

const GlobalConfigSchema = z.object({
  port: z.number().int().positive(),
  publicBaseUrl: z.string().url().optional(),
  slackBotToken: z.string().optional(),
  slackSigningSecret: z.string().optional(),
  timezone: z.string()
});

export type AppConfig = z.infer<typeof GlobalConfigSchema> & {
  programs: ProgramConfig[];
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function numberEnv(name: string, fallback: number): number {
  const value = env(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function enumEnv<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = env(name);
  if (!value) return fallback;
  if (!allowed.includes(value as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function urlEnv(name: string, fallback: string): string {
  const value = env(name) ?? fallback;
  return z.string().url().parse(value);
}

function activitiesEnv(name: string, fallback: Activity[]): Activity[] {
  const value = env(name);
  if (!value) return fallback;

  const parsed = z
    .array(
      z.object({
        key: z.string().min(1),
        title: z.string().min(1),
        category: z.string().min(1),
        summaryProperty: z.string().min(1).optional(),
        coinsPerUnit: z.number().int().positive(),
        requiresQuantity: z.boolean(),
        requiresProof: z.boolean(),
        active: z.boolean().default(true),
        order: z.number().int().positive().optional()
      })
    )
    .parse(JSON.parse(value));

  return parsed;
}

function egcCoinRatesEnv(name: string, fallback: EgcCoinRates): EgcCoinRates {
  const value = env(name);
  if (!value) return fallback;

  const parsed = z
    .object({
      instagramStory: z.number().int().nonnegative().optional(),
      instagramVacancyStory: z.number().int().nonnegative().optional(),
      instagramReel: z.number().int().nonnegative().optional(),
      instagramPost: z.number().int().nonnegative().optional(),
      linkedinPost: z.number().int().nonnegative().optional(),
      linkedinVacancyPost: z.number().int().nonnegative().optional(),
      instagramStorySeries: z.number().int().nonnegative().optional()
    })
    .parse(JSON.parse(value));

  return { ...fallback, ...parsed };
}

function dataSourceIdEnv(name: string, fallback?: string): string | undefined {
  const value = env(name) ?? fallback;
  return value?.replace(/^collection:\/\//, "");
}

function minuteEnv(name: string, fallback: number): number {
  const value = env(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 59) {
    throw new Error(`${name} must be an integer between 0 and 59.`);
  }
  return parsed;
}

function schedule(prefix: string, fallbackDay: number, fallbackHour: number, fallbackReminderMinute = 1) {
  return {
    reminderDay: numberEnv(`${prefix}REMINDER_DAY`, numberEnv("REMINDER_DAY", fallbackDay)),
    reminderHour: numberEnv(`${prefix}REMINDER_HOUR`, numberEnv("REMINDER_HOUR", fallbackHour)),
    reminderMinute: minuteEnv(`${prefix}REMINDER_MINUTE`, minuteEnv("REMINDER_MINUTE", fallbackReminderMinute)),
    reportDay: numberEnv(`${prefix}REPORT_DAY`, numberEnv("REPORT_DAY", 5)),
    reportHour: numberEnv(`${prefix}REPORT_HOUR`, numberEnv("REPORT_HOUR", 9))
  };
}

function bonus(prefix: string) {
  return {
    bonusThreshold: numberEnv(`${prefix}BONUS_THRESHOLD`, numberEnv("BONUS_THRESHOLD", 3)),
    bonusCoins: numberEnv(`${prefix}BONUS_COINS`, numberEnv("BONUS_COINS", 10)),
    bonusDistinctBy: enumEnv<BonusDistinctBy>(
      `${prefix}BONUS_DISTINCT_BY`,
      ["activity", "category"],
      enumEnv<BonusDistinctBy>("BONUS_DISTINCT_BY", ["activity", "category"], "activity")
    )
  };
}

export function loadConfig(): AppConfig {
  const timezone = env("TIMEZONE") ?? "Europe/Kyiv";
  const publicBaseUrl = env("PUBLIC_BASE_URL");
  const globalConfig = GlobalConfigSchema.parse({
    port: numberEnv("PORT", 3000),
    publicBaseUrl,
    slackBotToken: env("SLACK_BOT_TOKEN"),
    slackSigningSecret: env("SLACK_SIGNING_SECRET"),
    timezone
  });

  return {
    ...globalConfig,
    programs: [
      {
        key: "ambassador",
        mode: "activity",
        slug: "ambassador",
        displayName: "Student Ambassador Program",
        shortName: "Ambassador",
        notionDatabasePrefix: "Ambassador Program",
        trackerTitle: "Ambassador Program Tracker 2026",
        createdVia: "ambassador-form",
        publicBaseUrl,
        notionApiKey: env("NOTION_API_KEY"),
        notionParentPageId: env("NOTION_PARENT_PAGE_ID"),
        notionParticipantsDataSourceId: env("NOTION_AMBASSADORS_DATA_SOURCE_ID"),
        notionActivityCatalogDataSourceId: env("NOTION_ACTIVITY_CATALOG_DATA_SOURCE_ID"),
        notionSubmissionsDataSourceId: env("NOTION_SUBMISSIONS_DATA_SOURCE_ID"),
        notionMonthlySummaryDataSourceId: env("NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID"),
        notionActivityTrackerId: env("NOTION_ACTIVITY_TRACKER_ID") ?? DEFAULT_ACTIVITY_TRACKER_ID,
        notionAutomationLogDataSourceId: env("NOTION_AUTOMATION_LOG_DATA_SOURCE_ID"),
        slackCommunityChannelId: env("SLACK_AMBASSADOR_CHANNEL_ID"),
        slackAdminChannelId: env("SLACK_ADMIN_CHANNEL_ID"),
        slackReportChannelId: env("SLACK_REPORT_CHANNEL_ID"),
        slackReportMentionUserId: env("SLACK_REPORT_MENTION_USER_ID"),
        programDetailsUrl: urlEnv("PROGRAM_DETAILS_URL", DEFAULT_AMBASSADOR_DETAILS_URL),
        timezone,
        ...schedule("", 1, 9),
        ...bonus(""),
        activities: activitiesEnv("AMBASSADOR_ACTIVITIES_JSON", DEFAULT_ACTIVITIES),
        content: {
          brandMark: "U",
          formEyebrow: "Student Ambassador Program",
          formTitle: "Ambassador activity report",
          deadlineNote: "Заповни до 5-го числа наступного місяця",
          participantLabel: "Ім'я у Slack",
          participantPlaceholder: "Diana Bondarenko",
          participantHelp: "Напишіть так, як ви підписані у Slack.",
          summaryLabel: "Coins",
          summaryNote:
            "Це орієнтовна кількість коінів. Точна кількість та видача відбуваються після перевірки EB-командою.",
          submitLabel: "Відправити форму",
          addActivityLabel: "Додати активність"
        },
        slackContent: {
          homeTitle: "Ambassador",
          homeDescription:
            "Керування амбасадорськими коінами: форма, ручний reminder і monthly report.",
          detailsLabel: "Ambassador Program for Students",
          reportTitle: "Ambassador coins report",
          notificationTitle: "Новий ambassador activity report",
          reminderGreeting: "Привіт, амбасадори!",
          reminderIntro: "Новий місяць уже почався, а це значить, що час заповнити чекліст",
          reminderCta: "Заповнити чекліст",
          reminderProofHint:
            "Додавайте скріншоти виконаних активностей та отримуйте юнікоіни за свою залученість.",
          reminderChannelLabel: "ambassador channel"
        }
      },
      {
        key: "egc",
        mode: "egc-report",
        slug: "egc",
        displayName: "EGC Program",
        shortName: "EGC",
        notionDatabasePrefix: "EGC",
        trackerTitle: "EGC аналітика",
        createdVia: "egc-form",
        envPrefix: "EGC_",
        publicBaseUrl,
        notionApiKey: env("EGC_NOTION_API_KEY") ?? env("NOTION_API_KEY"),
        notionParentPageId: undefined,
        notionParticipantsDataSourceId: undefined,
        notionActivityCatalogDataSourceId: undefined,
        notionSubmissionsDataSourceId: undefined,
        notionMonthlySummaryDataSourceId: undefined,
        notionActivityTrackerId: undefined,
        notionEgcReportsDataSourceId: dataSourceIdEnv(
          "EGC_NOTION_REPORTS_DATA_SOURCE_ID",
          DEFAULT_EGC_REPORTS_DATA_SOURCE_ID
        ),
        notionAutomationLogDataSourceId: env("EGC_NOTION_AUTOMATION_LOG_DATA_SOURCE_ID"),
        slackCommunityChannelId: env("EGC_SLACK_COMMUNITY_CHANNEL_ID") ?? env("EGC_SLACK_CHANNEL_ID"),
        slackAdminChannelId: env("EGC_SLACK_ADMIN_CHANNEL_ID") ?? env("SLACK_ADMIN_CHANNEL_ID"),
        slackReportChannelId: env("EGC_SLACK_REPORT_CHANNEL_ID") ?? env("SLACK_REPORT_CHANNEL_ID"),
        slackReportMentionUserId: env("EGC_SLACK_REPORT_MENTION_USER_ID"),
        programDetailsUrl: urlEnv("EGC_PROGRAM_DETAILS_URL", DEFAULT_EGC_DETAILS_URL),
        timezone: env("EGC_TIMEZONE") ?? timezone,
        ...schedule("EGC_", 1, 9),
        ...bonus("EGC_"),
        reportDay: numberEnv("EGC_REPORT_DAY", 3),
        reportHour: numberEnv("EGC_REPORT_HOUR", numberEnv("REPORT_HOUR", 9)),
        activities: [],
        egcCoinRates: egcCoinRatesEnv("EGC_COIN_RATES_JSON", DEFAULT_EGC_COIN_RATES),
        content: {
          brandMark: "E",
          formEyebrow: "EGC Reports",
          formTitle: "EGC monthly report",
          deadlineNote: "Заповнюй раз на місяць. Якщо Instagram/LinkedIn неактуальні - постав 0.",
          participantLabel: "Ім'я у Slack",
          participantPlaceholder: "Diana Bondarenko",
          participantHelp: "Напишіть так, як ви підписані у Slack.",
          summaryLabel: "Coins",
          summaryNote:
            "Це попередній підрахунок. Фінальна кількість коінів підтверджується після перевірки менеджером.",
          submitLabel: "Відправити EGC форму",
          addActivityLabel: "Додати активність"
        },
        slackContent: {
          homeTitle: "EGC",
          homeDescription:
            "EGC форма, ручний reminder і список коінів до видачі для менеджерів.",
          detailsLabel: "EGC Program",
          reportTitle: "EGC coins to issue",
          notificationTitle: "Новий EGC report",
          reminderGreeting: "Привіт!",
          reminderIntro: "Час подати EGC report",
          reminderCta: "Заповнити EGC форму",
          reminderProofHint: "Додай скріншоти постів і рілз; сторіз можна не прикріплювати.",
          reminderChannelLabel: "EGC channel"
        }
      }
    ]
  };
}

export function getProgramConfig(config: AppConfig, slugOrKey: string): ProgramConfig | undefined {
  return config.programs.find((program) => program.slug === slugOrKey || program.key === slugOrKey);
}

export function requireEnv(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}
