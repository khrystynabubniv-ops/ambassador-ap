import "dotenv/config";
import { loadConfig, requireEnv } from "../src/config.js";
import { notionJson } from "../src/notionClient.js";
import { ACTIVITY_SUMMARY_PROPERTIES } from "../src/notionSchema.js";

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

  console.log("Monthly Summary schema is ready for manager dashboard columns.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
