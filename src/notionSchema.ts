import type { Activity, ProgramConfig } from "./types.js";
import { monthUkrainianName, monthsOfYear } from "./dates.js";

const STATUS_OPTIONS = [
  { name: "Submitted", color: "blue" },
  { name: "Approved", color: "green" },
  { name: "Rejected", color: "red" }
];

const AUTOMATION_KIND_OPTIONS = [
  { name: "reminder", color: "blue" },
  { name: "report", color: "green" }
];

export const TRACKER_PROPERTIES = {
  title: "Учасник",
  slack: "Slack",
  month: "Місяць",
  baseCoins: "Base coins",
  bonusCoins: "Bonus",
  totalCoins: "Total coins",
  hasActivity: "Є активність",
  proofs: "Proofs",
  updatedAt: "Оновлено"
} as const;

const TRACKER_OPTION_MONTHS = [...monthsOfYear(2026).slice(2), ...monthsOfYear(2026).slice(0, 2)];

export const TRACKER_MONTH_OPTIONS = TRACKER_OPTION_MONTHS.map((month) => ({
  name: monthUkrainianName(month),
  color: "default"
}));

export const OLD_ACTIVITY_SUMMARY_PROPERTIES = [
  "Vacancy Chats Qty",
  "Event Chats Qty",
  "Teacher Contacts Qty",
  "Own Lectures Qty",
  "Guest Lectures Qty",
  "Career Center Qty",
  "Telegram Posts Qty",
  "Office Tours Qty"
] as const;

export type ActivitySummaryProperty = {
  key: string;
  property: string;
};

export function activitySummaryProperties(activities: Activity[]): ActivitySummaryProperty[] {
  return activities.map((activity) => ({
    key: activity.key,
    property: activity.summaryProperty ?? compactPropertyName(activity.title)
  }));
}

export function buildNotionSchemas(program: ProgramConfig) {
  const categoryOptions = categoryOptionsForActivities(program.activities);
  const activitySummarySchema = Object.fromEntries(
    activitySummaryProperties(program.activities).map(({ property }) => [property, { number: { format: "number" } }])
  );

  return {
    participants: {
      Name: { title: {} },
      "Slack Nickname": { rich_text: {} },
      "Slack User ID": { rich_text: {} },
      Active: { checkbox: {} },
      "Created Via": { rich_text: {} }
    },
    activityCatalog: {
      Activity: { title: {} },
      Key: { rich_text: {} },
      Category: { select: { options: categoryOptions } },
      "Summary Property": { rich_text: {} },
      "Coins per Unit": { number: { format: "number" } },
      "Requires Quantity": { checkbox: {} },
      "Requires Proof": { checkbox: {} },
      Active: { checkbox: {} },
      Order: { number: { format: "number" } }
    },
    submissions: {
      Submission: { title: {} },
      "Participant Name": { rich_text: {} },
      "Ambassador Name": { rich_text: {} },
      "Slack Nickname": { rich_text: {} },
      "Slack User ID": { rich_text: {} },
      Month: { date: {} },
      "Activity Key": { rich_text: {} },
      Activity: { rich_text: {} },
      Category: { select: { options: categoryOptions } },
      Quantity: { number: { format: "number" } },
      "Coins per Unit": { number: { format: "number" } },
      "Base Coins": { number: { format: "number" } },
      "Proof Files": { files: {} },
      Status: { select: { options: STATUS_OPTIONS } },
      Notes: { rich_text: {} },
      "Submitted At": { date: {} }
    },
    monthlySummary: {
      [TRACKER_PROPERTIES.title]: { title: {} },
      [TRACKER_PROPERTIES.slack]: { rich_text: {} },
      [TRACKER_PROPERTIES.month]: { select: { options: TRACKER_MONTH_OPTIONS } },
      ...activitySummarySchema,
      [TRACKER_PROPERTIES.baseCoins]: { number: { format: "number" } },
      [TRACKER_PROPERTIES.bonusCoins]: { number: { format: "number" } },
      [TRACKER_PROPERTIES.totalCoins]: { number: { format: "number" } },
      [TRACKER_PROPERTIES.proofs]: { files: {} },
      [TRACKER_PROPERTIES.updatedAt]: { date: {} }
    },
    automationLog: {
      Event: { title: {} },
      Kind: { select: { options: AUTOMATION_KIND_OPTIONS } },
      Key: { rich_text: {} },
      Month: { date: {} },
      "Sent At": { date: {} },
      Channel: { rich_text: {} },
      Payload: { rich_text: {} }
    }
  } satisfies Record<string, Record<string, unknown>>;
}

export function activityPageProperties(activity: Activity) {
  return {
    Activity: {
      title: [{ type: "text", text: { content: activity.title } }]
    },
    Key: {
      rich_text: [{ type: "text", text: { content: activity.key } }]
    },
    Category: {
      select: { name: activity.category }
    },
    "Summary Property": {
      rich_text: [{ type: "text", text: { content: activity.summaryProperty ?? compactPropertyName(activity.title) } }]
    },
    "Coins per Unit": {
      number: activity.coinsPerUnit
    },
    "Requires Quantity": {
      checkbox: activity.requiresQuantity
    },
    "Requires Proof": {
      checkbox: activity.requiresProof
    },
    Active: {
      checkbox: activity.active
    },
    Order: {
      number: activity.order ?? 999
    }
  };
}

function categoryOptionsForActivities(activities: Activity[]) {
  const categories = [...new Set(activities.map((activity) => activity.category).filter(Boolean))];
  const colors = ["blue", "green", "purple", "yellow", "orange", "pink", "gray", "brown", "red"] as const;
  return categories.map((name, index) => ({
    name,
    color: colors[index % colors.length]
  }));
}

function compactPropertyName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 48);
}
