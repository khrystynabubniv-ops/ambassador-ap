import "dotenv/config";
import { DEFAULT_ACTIVITIES } from "../src/activities.js";
import { calculateMonthlySummary } from "../src/coins.js";
import { loadConfig, requireEnv } from "../src/config.js";
import { monthEnglishName, monthStart, monthsOfYear } from "../src/dates.js";
import {
  notionJson,
  propertyDate,
  propertyNumber,
  propertyPlainText,
  queryDataSource,
  richText,
  titleText
} from "../src/notionClient.js";
import { ACTIVITY_SUMMARY_PROPERTIES, OLD_ACTIVITY_SUMMARY_PROPERTIES } from "../src/notionSchema.js";
import { NotionService } from "../src/notionService.js";

const YEAR = 2026;
const TRACKER_TITLE = "Ambassador Program - Yearly Tracker 2026";

type NotionPage = {
  id: string;
  properties: Record<string, any>;
};

type Participant = {
  name: string;
  slackNickname: string;
  slackUserId?: string;
};

type SubmissionGroup = {
  participant: Participant;
  month: string;
  quantities: Record<string, number>;
};

async function main() {
  const config = loadConfig();
  requireEnv("notionApiKey", config.notionApiKey);
  requireEnv("notionParentPageId", config.notionParentPageId);
  requireEnv("notionMonthlySummaryDataSourceId", config.notionMonthlySummaryDataSourceId);

  const notion = new NotionService(config);
  const dataSource = await notionJson<any>(config, `/v1/data_sources/${config.notionMonthlySummaryDataSourceId}`, "GET");
  const trackerDatabaseId = dataSource.parent?.database_id;
  if (!trackerDatabaseId) {
    throw new Error("Could not resolve tracker database id from data source.");
  }

  await renameTracker(config, trackerDatabaseId);
  await updateTrackerSchema(config);

  const participants = await collectParticipants(config);
  const submissions = await collectSubmissionGroups(config, participants);

  if (!participants.size) {
    console.log("No participants found yet. Tracker schema and page cleanup still completed.");
  }

  for (const participant of participants.values()) {
    for (const month of monthsOfYear(YEAR)) {
      const group = submissions.get(groupKey(participant.slackNickname, month));
      const submittedActivities = DEFAULT_ACTIVITIES.map((activity) => {
        const quantity = group?.quantities[activity.key] ?? 0;
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

  await cleanHubPage(config, trackerDatabaseId);
  console.log(`Done. Main manager table is now "${TRACKER_TITLE}".`);
}

async function renameTracker(config: ReturnType<typeof loadConfig>, trackerDatabaseId: string) {
  const title = [{ type: "text", text: { content: TRACKER_TITLE } }];
  await notionJson(config, `/v1/databases/${trackerDatabaseId}`, "PATCH", { title });
  await notionJson(config, `/v1/data_sources/${config.notionMonthlySummaryDataSourceId}`, "PATCH", { title });
}

async function updateTrackerSchema(config: ReturnType<typeof loadConfig>) {
  await notionJson(config, `/v1/data_sources/${config.notionMonthlySummaryDataSourceId}`, "PATCH", {
    properties: {
      "Ambassador Name": { rich_text: {} },
      Month: { date: {} },
      "Month Name": {
        select: {
          options: [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December"
          ].map((name) => ({ name }))
        }
      },
      "Slack Nickname": { rich_text: {} },
      "Activity Breakdown": { rich_text: {} },
      "Proof Files": { files: {} },
      ...Object.fromEntries(
        ACTIVITY_SUMMARY_PROPERTIES.map(({ property }) => [property, { number: { format: "number" } }])
      ),
      "Base Coins": { number: { format: "number" } },
      "Completed Count": { number: { format: "number" } },
      "Bonus Coins": { number: { format: "number" } },
      "Total Coins": { number: { format: "number" } },
      "Report Line": { rich_text: {} },
      "Last Submitted At": { date: {} },
      "Slack User ID": null,
      "Generated At": null,
      ...Object.fromEntries(OLD_ACTIVITY_SUMMARY_PROPERTIES.map((property) => [property, null]))
    }
  });
}

async function collectParticipants(config: ReturnType<typeof loadConfig>): Promise<Map<string, Participant>> {
  const participants = new Map<string, Participant>();

  if (config.notionAmbassadorsDataSourceId) {
    const rows = (await safeQuery(config, config.notionAmbassadorsDataSourceId)) as NotionPage[];
    for (const row of rows) {
      upsertParticipant(participants, {
        name: propertyPlainText(row.properties.Name),
        slackNickname: propertyPlainText(row.properties["Slack Nickname"]),
        slackUserId: propertyPlainText(row.properties["Slack User ID"]) || undefined
      });
    }
  }

  if (config.notionMonthlySummaryDataSourceId) {
    const rows = (await safeQuery(config, config.notionMonthlySummaryDataSourceId)) as NotionPage[];
    for (const row of rows) {
      upsertParticipant(participants, {
        name: propertyPlainText(row.properties["Ambassador Name"]),
        slackNickname: propertyPlainText(row.properties["Slack Nickname"])
      });
    }
  }

  if (config.notionSubmissionsDataSourceId) {
    const rows = (await safeQuery(config, config.notionSubmissionsDataSourceId)) as NotionPage[];
    for (const row of rows) {
      upsertParticipant(participants, {
        name: propertyPlainText(row.properties["Ambassador Name"]),
        slackNickname: propertyPlainText(row.properties["Slack Nickname"]),
        slackUserId: propertyPlainText(row.properties["Slack User ID"]) || undefined
      });
    }
  }

  return participants;
}

async function collectSubmissionGroups(
  config: ReturnType<typeof loadConfig>,
  participants: Map<string, Participant>
): Promise<Map<string, SubmissionGroup>> {
  const groups = new Map<string, SubmissionGroup>();
  if (!config.notionSubmissionsDataSourceId) return groups;

  const rows = (await safeQuery(config, config.notionSubmissionsDataSourceId)) as NotionPage[];
  for (const row of rows) {
    const month = propertyDate(row.properties.Month).slice(0, 7);
    const activityKey = propertyPlainText(row.properties["Activity Key"]);
    const slackNickname = propertyPlainText(row.properties["Slack Nickname"]);
    if (!month || !activityKey || !slackNickname || !month.startsWith(`${YEAR}-`)) continue;

    const participant = {
      name: propertyPlainText(row.properties["Ambassador Name"]),
      slackNickname,
      slackUserId: propertyPlainText(row.properties["Slack User ID"]) || undefined
    };
    upsertParticipant(participants, participant);

    const key = groupKey(slackNickname, month);
    const group = groups.get(key) ?? {
      participant,
      month,
      quantities: {}
    };
    group.quantities[activityKey] = (group.quantities[activityKey] ?? 0) + propertyNumber(row.properties.Quantity);
    groups.set(key, group);
  }

  return groups;
}

async function cleanHubPage(config: ReturnType<typeof loadConfig>, trackerDatabaseId: string) {
  const blocks = await listChildBlocks(config, config.notionParentPageId!);
  for (const block of blocks) {
    if (block.id === trackerDatabaseId) continue;
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
  } catch (error) {
    console.warn(`Skipping unavailable data source ${dataSourceId}.`, error);
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

function groupKey(slackNickname: string, month: string): string {
  return `${normalizeNickname(slackNickname)}:${month}`;
}

function normalizeNickname(slackNickname: string): string {
  return slackNickname.trim().replace(/^@+/, "").toLowerCase();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
