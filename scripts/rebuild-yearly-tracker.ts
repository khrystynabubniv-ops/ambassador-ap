import "dotenv/config";
import fs from "node:fs";
import { DEFAULT_ACTIVITIES } from "../src/activities.js";
import { calculateMonthlySummary } from "../src/coins.js";
import { loadConfig, requireEnv } from "../src/config.js";
import { monthsOfYear } from "../src/dates.js";
import {
  notionJson,
  propertyDate,
  propertyNumber,
  propertyPlainText,
  queryDataSource
} from "../src/notionClient.js";
import { notionSchemas, TRACKER_TITLE } from "../src/notionSchema.js";
import { NotionService } from "../src/notionService.js";

const YEAR = 2026;

type NotionPage = {
  id: string;
  properties: Record<string, any>;
};

type Participant = {
  name: string;
  slackNickname: string;
  slackUserId?: string;
};

async function main() {
  const config = loadConfig();
  requireEnv("notionApiKey", config.notionApiKey);
  requireEnv("notionParentPageId", config.notionParentPageId);

  const participants = await collectParticipants(config);
  const quantitiesByPersonMonth = await collectSubmissionQuantities(config, participants);
  const oldTrackerRows = config.notionMonthlySummaryDataSourceId
    ? ((await safeQuery(config, config.notionMonthlySummaryDataSourceId)) as NotionPage[])
    : [];
  mergeOldTrackerRows(oldTrackerRows, participants, quantitiesByPersonMonth);

  await archiveHubChildren(config);
  const created = await notionJson<any>(config, "/v1/databases", "POST", {
    parent: { type: "page_id", page_id: config.notionParentPageId },
    title: [{ type: "text", text: { content: TRACKER_TITLE } }],
    is_inline: false,
    initial_data_source: {
      properties: notionSchemas.monthlySummary
    }
  });

  const dataSourceId = created.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new Error("Could not resolve new tracker data source id.");
  }

  config.notionMonthlySummaryDataSourceId = dataSourceId;
  updateLocalEnv("NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID", dataSourceId);

  const notion = new NotionService(config);
  for (const participant of participants.values()) {
    for (const month of monthsOfYear(YEAR)) {
      const quantities = quantitiesByPersonMonth.get(groupKey(participant.slackNickname, month)) ?? {};
      const submittedActivities = DEFAULT_ACTIVITIES.map((activity) => {
        const quantity = quantities[activity.key] ?? 0;
        return quantity > 0 ? { activity, quantity, baseCoins: quantity * activity.coinsPerUnit } : undefined;
      }).filter((item): item is NonNullable<typeof item> => Boolean(item));

      const summary = calculateMonthlySummary(
        month,
        participant.name,
        participant.slackNickname,
        participant.slackUserId,
        submittedActivities,
        {
          bonusThreshold: config.bonusThreshold,
          bonusCoins: config.bonusCoins,
          bonusDistinctBy: config.bonusDistinctBy
        }
      );
      await notion.upsertMonthlySummary(summary);
    }
  }

  console.log(`Created clean tracker: ${TRACKER_TITLE}`);
  console.log(`NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID=${dataSourceId}`);
}

async function collectParticipants(config: ReturnType<typeof loadConfig>): Promise<Map<string, Participant>> {
  const participants = new Map<string, Participant>();

  if (config.notionAmbassadorsDataSourceId) {
    for (const row of (await safeQuery(config, config.notionAmbassadorsDataSourceId)) as NotionPage[]) {
      upsertParticipant(participants, {
        name: propertyPlainText(row.properties.Name),
        slackNickname: propertyPlainText(row.properties["Slack Nickname"]),
        slackUserId: propertyPlainText(row.properties["Slack User ID"]) || undefined
      });
    }
  }

  if (config.notionSubmissionsDataSourceId) {
    for (const row of (await safeQuery(config, config.notionSubmissionsDataSourceId)) as NotionPage[]) {
      upsertParticipant(participants, {
        name: propertyPlainText(row.properties["Ambassador Name"]),
        slackNickname: propertyPlainText(row.properties["Slack Nickname"]),
        slackUserId: propertyPlainText(row.properties["Slack User ID"]) || undefined
      });
    }
  }

  if (config.notionMonthlySummaryDataSourceId) {
    for (const row of (await safeQuery(config, config.notionMonthlySummaryDataSourceId)) as NotionPage[]) {
      upsertParticipant(participants, {
        name:
          propertyPlainText(row.properties["Учасник"]) ||
          propertyPlainText(row.properties["Ambassador Name"]),
        slackNickname:
          propertyPlainText(row.properties.Slack) ||
          propertyPlainText(row.properties["Slack Nickname"])
      });
    }
  }

  if (!participants.size) {
    console.warn("No participants found. Add participants by submitting the form once per person.");
  }

  return participants;
}

async function collectSubmissionQuantities(
  config: ReturnType<typeof loadConfig>,
  participants: Map<string, Participant>
): Promise<Map<string, Record<string, number>>> {
  const groups = new Map<string, Record<string, number>>();
  if (!config.notionSubmissionsDataSourceId) return groups;

  for (const row of (await safeQuery(config, config.notionSubmissionsDataSourceId)) as NotionPage[]) {
    const month = propertyDate(row.properties.Month).slice(0, 7);
    const activityKey = propertyPlainText(row.properties["Activity Key"]);
    const slackNickname = propertyPlainText(row.properties["Slack Nickname"]);
    if (!month.startsWith(`${YEAR}-`) || !activityKey || !slackNickname) continue;

    upsertParticipant(participants, {
      name: propertyPlainText(row.properties["Ambassador Name"]),
      slackNickname,
      slackUserId: propertyPlainText(row.properties["Slack User ID"]) || undefined
    });

    const key = groupKey(slackNickname, month);
    const quantities = groups.get(key) ?? {};
    quantities[activityKey] = (quantities[activityKey] ?? 0) + propertyNumber(row.properties.Quantity);
    groups.set(key, quantities);
  }

  return groups;
}

function mergeOldTrackerRows(
  rows: NotionPage[],
  participants: Map<string, Participant>,
  groups: Map<string, Record<string, number>>
) {
  for (const row of rows) {
    const slackNickname =
      propertyPlainText(row.properties.Slack) ||
      propertyPlainText(row.properties["Slack Nickname"]);
    const month =
      propertyDate(row.properties.Month).slice(0, 7) ||
      monthFromSummaryTitle(propertyPlainText(row.properties.Summary));
    if (!slackNickname || !month?.startsWith(`${YEAR}-`)) continue;

    upsertParticipant(participants, {
      name:
        propertyPlainText(row.properties["Учасник"]) ||
        propertyPlainText(row.properties["Ambassador Name"]),
      slackNickname
    });

    const key = groupKey(slackNickname, month);
    const quantities = groups.get(key) ?? {};
    for (const activity of DEFAULT_ACTIVITIES) {
      const property = activityProperty(activity.key);
      if (!property) continue;
      quantities[activity.key] = Math.max(quantities[activity.key] ?? 0, propertyNumber(row.properties[property]));
    }
    groups.set(key, quantities);
  }
}

async function archiveHubChildren(config: ReturnType<typeof loadConfig>) {
  const children = await listChildBlocks(config, config.notionParentPageId!);
  for (const block of children) {
    await notionJson(config, `/v1/blocks/${block.id}`, "DELETE");
  }
}

async function listChildBlocks(config: ReturnType<typeof loadConfig>, blockId: string): Promise<any[]> {
  const results: any[] = [];
  let startCursor: string | undefined;
  do {
    const response = await notionJson<any>(
      config,
      `/v1/blocks/${blockId}/children?page_size=100${startCursor ? `&start_cursor=${startCursor}` : ""}`,
      "GET"
    );
    results.push(...response.results);
    startCursor = response.has_more ? response.next_cursor : undefined;
  } while (startCursor);
  return results;
}

async function safeQuery(config: ReturnType<typeof loadConfig>, dataSourceId: string): Promise<unknown[]> {
  try {
    return await queryDataSource(config, dataSourceId);
  } catch {
    return [];
  }
}

function upsertParticipant(participants: Map<string, Participant>, participant: Participant) {
  if (!participant.slackNickname) return;
  const key = normalizeNickname(participant.slackNickname);
  const existing = participants.get(key);
  participants.set(key, {
    name: participant.name || existing?.name || participant.slackNickname,
    slackNickname: participant.slackNickname,
    slackUserId: participant.slackUserId ?? existing?.slackUserId
  });
}

function activityProperty(activityKey: string): string | undefined {
  return {
    vacancy_student_chats: "Вакансії в чатах",
    events_internships_student_chats: "Івенти/стажування в чатах",
    teacher_contact: "Контакти викладачів",
    own_university_lecture: "Власні лекції",
    guest_lecture_coorganization: "Гостьові лекції",
    career_center_channel: "Кар'єрні канали",
    telegram_uni_career_hub_post: "Пости Uni Career Hub",
    office_tour: "Екскурсії офісом"
  }[activityKey];
}

function groupKey(slackNickname: string, month: string): string {
  return `${normalizeNickname(slackNickname)}:${month}`;
}

function normalizeNickname(slackNickname: string): string {
  return slackNickname.trim().replace(/^@+/, "").toLowerCase();
}

function monthFromSummaryTitle(summary: string): string | undefined {
  return summary.match(/\b20\d{2}-\d{2}\b/)?.[0];
}

function updateLocalEnv(key: string, value: string) {
  const envPath = ".env";
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  const next = content.match(new RegExp(`^${key}=`, "m"))
    ? content.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`)
    : `${content.trimEnd()}\n${key}=${value}\n`;
  fs.writeFileSync(envPath, next);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
