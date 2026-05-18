import type { Activity } from "./types.js";

const CATEGORY_OPTIONS = [
  { name: "Поширення", color: "blue" },
  { name: "Партнерства", color: "green" },
  { name: "Виступи", color: "purple" },
  { name: "Контент", color: "yellow" },
  { name: "Екскурсії", color: "orange" }
];

const STATUS_OPTIONS = [
  { name: "Submitted", color: "blue" },
  { name: "Approved", color: "green" },
  { name: "Rejected", color: "red" }
];

const AUTOMATION_KIND_OPTIONS = [
  { name: "reminder", color: "blue" },
  { name: "report", color: "green" }
];

export const notionSchemas = {
  ambassadors: {
    Name: { title: {} },
    "Slack Nickname": { rich_text: {} },
    "Slack User ID": { rich_text: {} },
    Active: { checkbox: {} },
    "Created Via": { rich_text: {} }
  },
  activityCatalog: {
    Activity: { title: {} },
    Key: { rich_text: {} },
    Category: { select: { options: CATEGORY_OPTIONS } },
    "Coins per Unit": { number: { format: "number" } },
    "Requires Quantity": { checkbox: {} },
    "Requires Proof": { checkbox: {} },
    Active: { checkbox: {} },
    Order: { number: { format: "number" } }
  },
  submissions: {
    Submission: { title: {} },
    "Ambassador Name": { rich_text: {} },
    "Slack Nickname": { rich_text: {} },
    "Slack User ID": { rich_text: {} },
    Month: { date: {} },
    "Activity Key": { rich_text: {} },
    Activity: { rich_text: {} },
    Category: { select: { options: CATEGORY_OPTIONS } },
    Quantity: { number: { format: "number" } },
    "Coins per Unit": { number: { format: "number" } },
    "Base Coins": { number: { format: "number" } },
    "Proof Files": { files: {} },
    Status: { select: { options: STATUS_OPTIONS } },
    Notes: { rich_text: {} },
    "Submitted At": { date: {} }
  },
  monthlySummary: {
    Summary: { title: {} },
    Month: { date: {} },
    "Slack Nickname": { rich_text: {} },
    "Slack User ID": { rich_text: {} },
    "Base Coins": { number: { format: "number" } },
    "Completed Count": { number: { format: "number" } },
    "Bonus Coins": { number: { format: "number" } },
    "Total Coins": { number: { format: "number" } },
    "Report Line": { rich_text: {} },
    "Generated At": { date: {} }
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
