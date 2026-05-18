import "dotenv/config";
import { z } from "zod";

const optionalNumber = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : fallback))
    .pipe(z.number().int().positive());

const ConfigSchema = z.object({
  port: optionalNumber(3000),
  publicBaseUrl: z.string().url().optional(),
  notionApiKey: z.string().min(1).optional(),
  notionParentPageId: z.string().optional(),
  notionAmbassadorsDataSourceId: z.string().optional(),
  notionActivityCatalogDataSourceId: z.string().optional(),
  notionSubmissionsDataSourceId: z.string().optional(),
  notionMonthlySummaryDataSourceId: z.string().optional(),
  notionAutomationLogDataSourceId: z.string().optional(),
  slackBotToken: z.string().optional(),
  slackSigningSecret: z.string().optional(),
  slackAmbassadorChannelId: z.string().optional(),
  slackAdminChannelId: z.string().optional(),
  slackReportChannelId: z.string().optional(),
  timezone: z.string().default("Europe/Kyiv"),
  reminderDay: optionalNumber(1),
  reminderHour: optionalNumber(9),
  reportDay: optionalNumber(5),
  reportHour: optionalNumber(9),
  bonusThreshold: optionalNumber(3),
  bonusCoins: optionalNumber(10),
  bonusDistinctBy: z.enum(["activity", "category"]).default("activity")
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const config = ConfigSchema.parse({
    port: process.env.PORT,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    notionApiKey: process.env.NOTION_API_KEY,
    notionParentPageId: process.env.NOTION_PARENT_PAGE_ID,
    notionAmbassadorsDataSourceId: process.env.NOTION_AMBASSADORS_DATA_SOURCE_ID,
    notionActivityCatalogDataSourceId: process.env.NOTION_ACTIVITY_CATALOG_DATA_SOURCE_ID,
    notionSubmissionsDataSourceId: process.env.NOTION_SUBMISSIONS_DATA_SOURCE_ID,
    notionMonthlySummaryDataSourceId: process.env.NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID,
    notionAutomationLogDataSourceId: process.env.NOTION_AUTOMATION_LOG_DATA_SOURCE_ID,
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    slackAmbassadorChannelId: process.env.SLACK_AMBASSADOR_CHANNEL_ID,
    slackAdminChannelId: process.env.SLACK_ADMIN_CHANNEL_ID,
    slackReportChannelId: process.env.SLACK_REPORT_CHANNEL_ID,
    timezone: process.env.TIMEZONE ?? "Europe/Kyiv",
    reminderDay: process.env.REMINDER_DAY,
    reminderHour: process.env.REMINDER_HOUR,
    reportDay: process.env.REPORT_DAY,
    reportHour: process.env.REPORT_HOUR,
    bonusThreshold: process.env.BONUS_THRESHOLD,
    bonusCoins: process.env.BONUS_COINS,
    bonusDistinctBy: process.env.BONUS_DISTINCT_BY ?? "activity"
  });

  return config;
}

export function requireEnv(name: keyof AppConfig, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${String(name)}`);
  }
}
