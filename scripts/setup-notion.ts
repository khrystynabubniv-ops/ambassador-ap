import "dotenv/config";
import { getProgramConfig, loadConfig, requireEnv } from "../src/config.js";
import { notionJson } from "../src/notionClient.js";
import { activityPageProperties, buildNotionSchemas } from "../src/notionSchema.js";
import type { ProgramConfig } from "../src/types.js";

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

function databases(program: ProgramConfig) {
  const schemas = buildNotionSchemas(program);
  return [
  {
    label: "Participants",
    envName: envName(program, "NOTION_PARTICIPANTS_DATA_SOURCE_ID", "NOTION_AMBASSADORS_DATA_SOURCE_ID"),
    schema: schemas.participants
  },
  {
    label: "Activity Catalog",
    envName: envName(program, "NOTION_ACTIVITY_CATALOG_DATA_SOURCE_ID"),
    schema: schemas.activityCatalog
  },
  {
    label: "Activity Submissions",
    envName: envName(program, "NOTION_SUBMISSIONS_DATA_SOURCE_ID"),
    schema: schemas.submissions
  },
  {
    label: "Monthly Summary",
    envName: envName(program, "NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID"),
    schema: schemas.monthlySummary
  },
  {
    label: "Automation Log",
    envName: envName(program, "NOTION_AUTOMATION_LOG_DATA_SOURCE_ID"),
    schema: schemas.automationLog
  }
  ] as const;
}

async function main() {
  const config = loadConfig();
  const program = getProgramConfig(config, programArg()) ?? config.programs[0];
  if (program.mode === "egc-report") {
    throw new Error("EGC uses the existing EGC турнір data source. Set EGC_NOTION_REPORTS_DATA_SOURCE_ID instead of running setup:notion.");
  }
  requireEnv(`${program.envPrefix ?? ""}NOTION_API_KEY`, program.notionApiKey);
  requireEnv(`${program.envPrefix ?? ""}NOTION_PARENT_PAGE_ID`, program.notionParentPageId);

  const results: SetupResult[] = [];

  for (const database of databases(program)) {
    const created = await notionJson<CreatedDatabase>(program, "/v1/databases", "POST", {
      parent: { type: "page_id", page_id: program.notionParentPageId },
      title: [{ type: "text", text: { content: `${program.notionDatabasePrefix} - ${database.label}` } }],
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

  for (const activity of program.activities) {
    await notionJson(program, "/v1/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: activityCatalog.dataSourceId },
      properties: activityPageProperties(activity)
    });
  }

  console.log(`Created ${program.displayName} Notion databases and seeded Activity Catalog.`);
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

function programArg(): string {
  const index = process.argv.findIndex((arg) => arg === "--program" || arg === "-p");
  return index >= 0 ? process.argv[index + 1] : "ambassador";
}

function envName(program: ProgramConfig, name: string, legacyName = name): string {
  return program.envPrefix ? `${program.envPrefix}${name}` : legacyName;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
