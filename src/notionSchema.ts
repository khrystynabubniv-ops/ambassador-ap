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

export const ACTIVITY_SUMMARY_PROPERTIES = [
  { key: "vacancy_student_chats", property: "Vacancy Chats Qty" },
  { key: "events_internships_student_chats", property: "Event Chats Qty" },
  { key: "teacher_contact", property: "Teacher Contacts Qty" },
  { key: "own_university_lecture", property: "Own Lectures Qty" },
  { key: "guest_lecture_coorganization", property: "Guest Lectures Qty" },
  { key: "career_center_channel", property: "Career Center Qty" },
  { key: "telegram_uni_career_hub_post", property: "Telegram Posts Qty" },
  { key: "office_tour", property: "Office Tours Qty" }
] as const;

const ACTIVITY_SUMMARY_SCHEMA = Object.fromEntries(
  ACTIVITY_SUMMARY_PROPERTIES.map(({ property }) => [property, { number: { format: "number" } }])
);

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
    "Ambassador Name": { rich_text: {} },
    Month: { date: {} },
    "Slack Nickname": { rich_text: {} },
    "Slack User ID": { rich_text: {} },
    "Activity Breakdown": { rich_text: {} },
    ...ACTIVITY_SUMMARY_SCHEMA,
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
