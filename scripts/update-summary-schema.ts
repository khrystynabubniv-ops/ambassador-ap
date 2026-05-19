import "dotenv/config";
import { loadConfig, requireEnv } from "../src/config.js";
import { notionJson, propertyNumber, queryDataSource } from "../src/notionClient.js";
import { ACTIVITY_SUMMARY_PROPERTIES, TRACKER_PROPERTIES } from "../src/notionSchema.js";
import { NotionService } from "../src/notionService.js";

type NotionPage = {
  id: string;
  properties: Record<string, any>;
};

async function main() {
  const config = loadConfig();
  requireEnv("notionApiKey", config.notionApiKey);
  requireEnv("notionMonthlySummaryDataSourceId", config.notionMonthlySummaryDataSourceId);

  await notionJson(config, `/v1/data_sources/${config.notionMonthlySummaryDataSourceId}`, "PATCH", {
    properties: {
      "Ambassador Name": { rich_text: {} },
      "Activity Breakdown": { rich_text: {} },
      ...Object.fromEntries(
        ACTIVITY_SUMMARY_PROPERTIES.map(({ property }) => [property, { number: { format: "number" } }])
      )
    }
  });

  const notion = new NotionService(config);
  const activityTrackerDataSourceId = await notion.ensureActivityTrackerSchema();
  if (!activityTrackerDataSourceId) {
    console.log("Monthly Summary schema is ready for manager dashboard columns.");
    console.log("Activity tracker was not configured; skipped backfill.");
    return;
  }

  const pages = (await queryDataSource(config, activityTrackerDataSourceId)) as NotionPage[];
  for (const page of pages) {
    const hasActivity =
      propertyNumber(page.properties[TRACKER_PROPERTIES.totalCoins]) > 0 ||
      ACTIVITY_SUMMARY_PROPERTIES.some(({ property }) => propertyNumber(page.properties[property]) > 0);

    await notionJson(config, `/v1/pages/${page.id}`, "PATCH", {
      properties: {
        [TRACKER_PROPERTIES.hasActivity]: { checkbox: hasActivity }
      }
    });
  }

  console.log("Monthly Summary schema is ready for manager dashboard columns.");
  console.log(`Backfilled ${pages.length} activity tracker rows with "${TRACKER_PROPERTIES.hasActivity}".`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
