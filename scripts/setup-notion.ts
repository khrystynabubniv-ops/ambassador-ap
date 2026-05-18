import "dotenv/config";
import { DEFAULT_ACTIVITIES } from "../src/activities.js";
import { loadConfig, requireEnv } from "../src/config.js";
import { notionJson } from "../src/notionClient.js";
import { activityPageProperties, notionSchemas } from "../src/notionSchema.js";

type CreatedDatabase = {
  id: string;
  data_sources?: Array<{ id: string; name?: string }>;
};

type SetupResult = {
  label: string;
  envName: string;
  databaseId: string;
  dataSourceId: string;
};

const databases = [
  {
    label: "Ambassadors",
    envName: "NOTION_AMBASSADORS_DATA_SOURCE_ID",
    schema: notionSchemas.ambassadors
  },
  {
    label: "Activity Catalog",
    envName: "NOTION_ACTIVITY_CATALOG_DATA_SOURCE_ID",
    schema: notionSchemas.activityCatalog
  },
  {
    label: "Activity Submissions",
    envName: "NOTION_SUBMISSIONS_DATA_SOURCE_ID",
    schema: notionSchemas.submissions
  },
  {
    label: "Monthly Summary",
    envName: "NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID",
    schema: notionSchemas.monthlySummary
  },
  {
    label: "Automation Log",
    envName: "NOTION_AUTOMATION_LOG_DATA_SOURCE_ID",
    schema: notionSchemas.automationLog
  }
] as const;

async function main() {
  const config = loadConfig();
  requireEnv("notionApiKey", config.notionApiKey);
  requireEnv("notionParentPageId", config.notionParentPageId);

  const results: SetupResult[] = [];

  for (const database of databases) {
    const created = await notionJson<CreatedDatabase>(config, "/v1/databases", "POST", {
      parent: { type: "page_id", page_id: config.notionParentPageId },
      title: [{ type: "text", text: { content: `Ambassador Program - ${database.label}` } }],
      is_inline: false,
      initial_data_source: {
        properties: database.schema
      }
    });

    const dataSourceId = created.data_sources?.[0]?.id;
    if (!dataSourceId) {
      throw new Error(`Could not find data source id for ${database.label}.`);
    }

    results.push({
      label: database.label,
      envName: database.envName,
      databaseId: created.id,
      dataSourceId
    });
  }

  const activityCatalog = results.find((item) => item.envName === "NOTION_ACTIVITY_CATALOG_DATA_SOURCE_ID");
  if (!activityCatalog) {
    throw new Error("Activity Catalog was not created.");
  }

  for (const activity of DEFAULT_ACTIVITIES) {
    await notionJson(config, "/v1/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: activityCatalog.dataSourceId },
      properties: activityPageProperties(activity)
    });
  }

  console.log("Created Notion databases and seeded Activity Catalog.");
  console.log("");
  for (const result of results) {
    console.log(`${result.envName}=${result.dataSourceId}`);
  }
  console.log("");
  console.log("Database IDs, in case you want to bookmark them:");
  for (const result of results) {
    console.log(`${result.label}: ${result.databaseId}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
