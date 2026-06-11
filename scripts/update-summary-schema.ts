import "dotenv/config";
import { getProgramConfig, loadConfig, requireEnv } from "../src/config.js";
import { notionJson, propertyNumber, queryDataSource } from "../src/notionClient.js";
import { activitySummaryProperties, TRACKER_PROPERTIES } from "../src/notionSchema.js";
import { NotionService } from "../src/notionService.js";

type NotionPage = {
  id: string;
  properties: Record<string, any>;
};

async function main() {
  const config = loadConfig();
  const program = getProgramConfig(config, programArg()) ?? config.programs[0];
  if (program.mode === "egc-report") {
    const notion = new NotionService(program);
    await notion.ensureEgcReportsSchema();
    console.log("Existing EGC reports data source is ready for web-form columns.");
    return;
  }
  requireEnv(`${program.envPrefix ?? ""}NOTION_API_KEY`, program.notionApiKey);
  requireEnv(`${program.envPrefix ?? ""}NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID`, program.notionMonthlySummaryDataSourceId);

  await notionJson(program, `/v1/data_sources/${program.notionMonthlySummaryDataSourceId}`, "PATCH", {
    properties: {
      "Participant Name": { rich_text: {} },
      "Ambassador Name": { rich_text: {} },
      "Activity Breakdown": { rich_text: {} },
      ...Object.fromEntries(
        activitySummaryProperties(program.activities).map(({ property }) => [property, { number: { format: "number" } }])
      )
    }
  });

  const notion = new NotionService(program);
  const activityTrackerDataSourceId = await notion.ensureActivityTrackerSchema();
  if (!activityTrackerDataSourceId) {
    console.log("Monthly Summary schema is ready for manager dashboard columns.");
    console.log("Activity tracker was not configured; skipped backfill.");
    return;
  }

  const pages = (await queryDataSource(program, activityTrackerDataSourceId)) as NotionPage[];
  for (const page of pages) {
    const hasActivity =
      propertyNumber(page.properties[TRACKER_PROPERTIES.totalCoins]) > 0 ||
      activitySummaryProperties(program.activities).some(({ property }) => propertyNumber(page.properties[property]) > 0);

    await notionJson(program, `/v1/pages/${page.id}`, "PATCH", {
      properties: {
        [TRACKER_PROPERTIES.hasActivity]: { checkbox: hasActivity }
      }
    });
  }

  console.log("Monthly Summary schema is ready for manager dashboard columns.");
  console.log(`Backfilled ${pages.length} activity tracker rows with "${TRACKER_PROPERTIES.hasActivity}".`);
}

function programArg(): string {
  const index = process.argv.findIndex((arg) => arg === "--program" || arg === "-p");
  return index >= 0 ? process.argv[index + 1] : "ambassador";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
