import type { AppConfig } from "./config.js";
import type { Activity, AutomationKind, MonthlySummary, SubmissionInput, SubmittedActivity } from "./types.js";
import { DEFAULT_ACTIVITIES } from "./activities.js";
import { calculateActivityCoins } from "./coins.js";
import { monthFromUkrainianName, monthStart, monthUkrainianName } from "./dates.js";
import {
  notionForm,
  notionJson,
  propertyCheckbox,
  propertyDate,
  propertyNumber,
  propertyPlainText,
  queryDataSource,
  richText,
  titleText
} from "./notionClient.js";
import { displaySlackNickname, normalizeSlackNickname, truncateForNotion } from "./text.js";
import { ACTIVITY_SUMMARY_PROPERTIES, TRACKER_PROPERTIES } from "./notionSchema.js";

type NotionPage = {
  id: string;
  properties: Record<string, any>;
};

type UploadedProof = {
  id: string;
  name: string;
};

type NotionDatabase = {
  data_sources?: Array<{ id: string; name?: string }>;
};

export class NotionService {
  private activityTrackerDataSourceId?: string;
  private activityTrackerSchemaReady = false;

  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.notionApiKey &&
        this.config.notionMonthlySummaryDataSourceId
    );
  }

  async listActivities(): Promise<Activity[]> {
    return DEFAULT_ACTIVITIES;
  }

  async ensureAmbassador(input: SubmissionInput): Promise<void> {
    this.requireDataSource("notionAmbassadorsDataSourceId");
    const nickname = normalizeSlackNickname(input.slackNickname);
    const existing = await this.findFirst(this.config.notionAmbassadorsDataSourceId!, {
      property: "Slack Nickname",
      rich_text: { equals: nickname }
    });

    const properties = {
      Name: titleText(input.ambassadorName),
      "Slack Nickname": richText(nickname),
      "Slack User ID": richText(input.slackUserId ?? ""),
      Active: { checkbox: true },
      "Created Via": richText("ambassador-form")
    };

    if (existing) {
      await notionJson(this.config, `/v1/pages/${existing.id}`, "PATCH", { properties });
      return;
    }

    await notionJson(this.config, "/v1/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: this.config.notionAmbassadorsDataSourceId },
      properties
    });
  }

  async createSubmissionActivity(
    input: SubmissionInput,
    submittedActivity: SubmittedActivity,
    files: Express.Multer.File[]
  ): Promise<string> {
    this.requireDataSource("notionSubmissionsDataSourceId");
    const nickname = normalizeSlackNickname(input.slackNickname);
    const proofs = await this.uploadProofFiles(files);
    const activity = submittedActivity.activity;
    const submissionTitle = `${input.month} ${displaySlackNickname(nickname)} - ${activity.title}`;

    const response = await notionJson<NotionPage>(this.config, "/v1/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: this.config.notionSubmissionsDataSourceId },
      properties: {
        Submission: titleText(submissionTitle),
        "Ambassador Name": richText(input.ambassadorName),
        "Slack Nickname": richText(nickname),
        "Slack User ID": richText(input.slackUserId ?? ""),
        Month: { date: { start: monthStart(input.month) } },
        "Activity Key": richText(activity.key),
        Activity: richText(activity.title),
        Category: { select: { name: activity.category } },
        Quantity: { number: submittedActivity.quantity },
        "Coins per Unit": { number: activity.coinsPerUnit },
        "Base Coins": { number: submittedActivity.baseCoins },
        "Proof Files": {
          files: proofs.map((proof) => ({
            name: proof.name,
            type: "file_upload",
            file_upload: { id: proof.id }
          }))
        },
        Status: { select: { name: "Submitted" } },
        Notes: richText(submittedActivity.notes ?? ""),
        "Submitted At": { date: { start: new Date().toISOString() } }
      }
    });

    return response.id;
  }

  async listSubmittedActivities(month: string, slackNickname: string): Promise<SubmittedActivity[]> {
    this.requireDataSource("notionSubmissionsDataSourceId");
    const nickname = normalizeSlackNickname(slackNickname);
    const pages = (await queryDataSource(this.config, this.config.notionSubmissionsDataSourceId!, {
      filter: {
        and: [
          { property: "Month", date: { equals: monthStart(month) } },
          { property: "Slack Nickname", rich_text: { equals: nickname } }
        ]
      }
    })) as NotionPage[];

    return pages
      .filter((page) => propertyPlainText(page.properties.Status) !== "Rejected")
      .map((page) => {
        const activity: Activity = {
          key: propertyPlainText(page.properties["Activity Key"]),
          title: propertyPlainText(page.properties.Activity),
          category: propertyPlainText(page.properties.Category),
          coinsPerUnit: propertyNumber(page.properties["Coins per Unit"]),
          requiresQuantity: true,
          requiresProof: true,
          active: true
        };

        return {
          activity,
          quantity: propertyNumber(page.properties.Quantity),
          baseCoins: propertyNumber(page.properties["Base Coins"]),
          notes: propertyPlainText(page.properties.Notes)
        };
      });
  }

  async getMonthlySummary(month: string, slackNickname: string): Promise<MonthlySummary | undefined> {
    this.requireDataSource("notionMonthlySummaryDataSourceId");
    const existing = await this.findSummaryPage(month, slackNickname);
    return existing ? this.summaryFromPage(existing, month) : undefined;
  }

  async upsertMonthlySummary(summary: MonthlySummary, proofFiles: Express.Multer.File[] = []): Promise<void> {
    this.requireDataSource("notionMonthlySummaryDataSourceId");
    const existing = await this.findSummaryPage(summary.month, summary.slackNickname, summary.ambassadorName);
    const proofs = await this.uploadProofFiles(proofFiles);

    const properties = {
      [TRACKER_PROPERTIES.title]: titleText(summary.ambassadorName || displaySlackNickname(summary.slackNickname)),
      [TRACKER_PROPERTIES.slack]: richText(normalizeSlackNickname(summary.slackNickname)),
      [TRACKER_PROPERTIES.month]: { select: { name: monthUkrainianName(summary.month) } },
      ...(proofs.length
        ? {
            [TRACKER_PROPERTIES.proofs]: {
              files: proofs.map((proof) => ({
                name: proof.name,
                type: "file_upload",
                file_upload: { id: proof.id }
              }))
            }
          }
        : {}),
      ...Object.fromEntries(
        ACTIVITY_SUMMARY_PROPERTIES.map(({ key, property }) => [
          property,
          { number: summary.activityQuantities[key] ?? 0 }
        ])
      ),
      [TRACKER_PROPERTIES.baseCoins]: { number: summary.baseCoins },
      [TRACKER_PROPERTIES.bonusCoins]: { number: summary.bonusCoins },
      [TRACKER_PROPERTIES.totalCoins]: { number: summary.totalCoins },
      ...(proofFiles.length ? { [TRACKER_PROPERTIES.updatedAt]: { date: { start: new Date().toISOString() } } } : {})
    };

    if (existing) {
      await notionJson(this.config, `/v1/pages/${existing.id}`, "PATCH", { properties });
      return;
    }

    await notionJson(this.config, "/v1/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: this.config.notionMonthlySummaryDataSourceId },
      properties
    });
  }

  async upsertActivityTrackerFlag(summary: MonthlySummary): Promise<void> {
    const dataSourceId = await this.ensureActivityTrackerSchema();
    if (!dataSourceId) return;

    const existing = await this.findSummaryPage(
      summary.month,
      summary.slackNickname,
      summary.ambassadorName,
      dataSourceId
    );
    const properties = {
      [TRACKER_PROPERTIES.hasActivity]: { checkbox: summary.hasActivity }
    };

    if (existing) {
      await notionJson(this.config, `/v1/pages/${existing.id}`, "PATCH", { properties });
      return;
    }

    await notionJson(this.config, "/v1/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: {
        [TRACKER_PROPERTIES.title]: titleText(summary.ambassadorName || displaySlackNickname(summary.slackNickname)),
        [TRACKER_PROPERTIES.slack]: richText(normalizeSlackNickname(summary.slackNickname)),
        [TRACKER_PROPERTIES.month]: { select: { name: monthUkrainianName(summary.month) } },
        ...properties
      }
    });
  }

  async listMonthlySummaries(month: string): Promise<MonthlySummary[]> {
    this.requireDataSource("notionMonthlySummaryDataSourceId");
    const pages = (await queryDataSource(this.config, this.config.notionMonthlySummaryDataSourceId!, {
      filter: { property: TRACKER_PROPERTIES.month, select: { equals: monthUkrainianName(month) } },
      sorts: [{ property: TRACKER_PROPERTIES.totalCoins, direction: "descending" }]
    })) as NotionPage[];

    return pages.map((page) => ({
      ...this.summaryFromPage(page, month),
      month
    }));
  }

  async hasAutomationLog(kind: AutomationKind, key: string): Promise<boolean> {
    if (!this.config.notionAutomationLogDataSourceId) return false;
    try {
      const existing = await this.findFirst(this.config.notionAutomationLogDataSourceId, {
        and: [
          { property: "Kind", select: { equals: kind } },
          { property: "Key", rich_text: { equals: key } }
        ]
      });
      return Boolean(existing);
    } catch (error) {
      console.warn("Automation log is unavailable; continuing without log lookup.", error);
      return false;
    }
  }

  async logAutomationEvent(kind: AutomationKind, key: string, month: string, channel: string, payload: string): Promise<void> {
    if (!this.config.notionAutomationLogDataSourceId) return;
    try {
      await notionJson(this.config, "/v1/pages", "POST", {
        parent: { type: "data_source_id", data_source_id: this.config.notionAutomationLogDataSourceId },
        properties: {
          Event: titleText(`${kind}:${key}`),
          Kind: { select: { name: kind } },
          Key: richText(key),
          Month: { date: { start: monthStart(month) } },
          "Sent At": { date: { start: new Date().toISOString() } },
          Channel: richText(channel),
          Payload: richText(truncateForNotion(payload))
        }
      });
    } catch (error) {
      console.warn("Automation log is unavailable; event was not logged.", error);
    }
  }

  async ensureActivityTrackerSchema(): Promise<string | undefined> {
    const dataSourceId = await this.resolveActivityTrackerDataSourceId();
    if (!dataSourceId) return undefined;

    if (!this.activityTrackerSchemaReady) {
      await notionJson(this.config, `/v1/data_sources/${dataSourceId}`, "PATCH", {
        properties: {
          [TRACKER_PROPERTIES.hasActivity]: { checkbox: {} }
        }
      });
      this.activityTrackerSchemaReady = true;
    }

    return dataSourceId;
  }

  private activityFromPage(page: NotionPage): Activity {
    return {
      key: propertyPlainText(page.properties.Key),
      title: propertyPlainText(page.properties.Activity),
      category: propertyPlainText(page.properties.Category),
      coinsPerUnit: propertyNumber(page.properties["Coins per Unit"]),
      requiresQuantity: propertyCheckbox(page.properties["Requires Quantity"]),
      requiresProof: propertyCheckbox(page.properties["Requires Proof"]),
      active: propertyCheckbox(page.properties.Active),
      order: propertyNumber(page.properties.Order)
    };
  }

  private summaryFromPage(page: NotionPage, fallbackMonth: string): MonthlySummary {
    const selectedMonth = propertyPlainText(page.properties[TRACKER_PROPERTIES.month]);
    const month =
      monthFromUkrainianName(selectedMonth, Number(fallbackMonth.slice(0, 4))) ||
      propertyDate(page.properties.Month).slice(0, 7) ||
      fallbackMonth;
    const ambassadorName =
      propertyPlainText(page.properties[TRACKER_PROPERTIES.title]) ||
      propertyPlainText(page.properties["Ambassador Name"]);
    const slackNickname =
      propertyPlainText(page.properties[TRACKER_PROPERTIES.slack]) ||
      propertyPlainText(page.properties["Slack Nickname"]);
    const totalCoins =
      propertyNumber(page.properties[TRACKER_PROPERTIES.totalCoins]) ||
      propertyNumber(page.properties["Total Coins"]);
    const activityQuantities = Object.fromEntries(
      ACTIVITY_SUMMARY_PROPERTIES.map(({ key, property }) => [key, propertyNumber(page.properties[property])])
    );
    const distinctCompleted = Object.values(activityQuantities).filter((quantity) => quantity > 0).length;
    const hasActivity =
      propertyCheckbox(page.properties[TRACKER_PROPERTIES.hasActivity]) ||
      distinctCompleted > 0 ||
      totalCoins > 0;
    const reportName = slackNickname ? displaySlackNickname(slackNickname) : ambassadorName;
    return {
      ambassadorName,
      month,
      slackNickname,
      hasActivity,
      baseCoins:
        propertyNumber(page.properties[TRACKER_PROPERTIES.baseCoins]) ||
        propertyNumber(page.properties["Base Coins"]),
      distinctCompleted,
      bonusCoins:
        propertyNumber(page.properties[TRACKER_PROPERTIES.bonusCoins]) ||
        propertyNumber(page.properties["Bonus Coins"]),
      totalCoins,
      reportLine:
        propertyPlainText(page.properties["Report Line"]) || `${reportName} - ${totalCoins} coins`,
      activityQuantities,
      activityBreakdown: propertyPlainText(page.properties["Activity Breakdown"])
    };
  }

  private async uploadProofFiles(files: Express.Multer.File[]): Promise<UploadedProof[]> {
    const uploads: UploadedProof[] = [];

    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        throw new Error(`${file.originalname} is larger than Notion's 20 MB single-upload limit.`);
      }

      const created = await notionJson<{ id: string }>(this.config, "/v1/file_uploads", "POST", {
        mode: "single_part",
        filename: file.originalname,
        content_type: file.mimetype || "application/octet-stream"
      });

      const formData = new FormData();
      const blob = new Blob([file.buffer as unknown as BlobPart], { type: file.mimetype || "application/octet-stream" });
      formData.append("file", blob, file.originalname);
      await notionForm(this.config, `/v1/file_uploads/${created.id}/send`, formData);
      uploads.push({ id: created.id, name: file.originalname });
    }

    return uploads;
  }

  private async findFirst(dataSourceId: string, filter: Record<string, unknown>): Promise<NotionPage | undefined> {
    const results = (await queryDataSource(this.config, dataSourceId, { filter, page_size: 1 })) as NotionPage[];
    return results[0];
  }

  private async findSummaryPage(
    month: string,
    slackNickname: string,
    ambassadorName?: string,
    dataSourceId = this.config.notionMonthlySummaryDataSourceId!
  ): Promise<NotionPage | undefined> {
    const monthFilter = { property: TRACKER_PROPERTIES.month, select: { equals: monthUkrainianName(month) } };
    const normalizedNickname = normalizeSlackNickname(slackNickname);

    if (normalizedNickname) {
      const bySlack = await this.findFirst(dataSourceId, {
        and: [
          monthFilter,
          { property: TRACKER_PROPERTIES.slack, rich_text: { equals: normalizedNickname } }
        ]
      });
      if (bySlack) return bySlack;
    }

    if (!ambassadorName) return undefined;

    return this.findFirst(dataSourceId, {
      and: [
        monthFilter,
        { property: TRACKER_PROPERTIES.title, title: { equals: ambassadorName } }
      ]
    });
  }

  private requireDataSource(key: keyof AppConfig): void {
    if (!this.config.notionApiKey || !this.config[key]) {
      throw new Error(`Notion is not configured. Missing ${String(key)}.`);
    }
  }

  private async resolveActivityTrackerDataSourceId(): Promise<string | undefined> {
    if (!this.config.notionApiKey || !this.config.notionActivityTrackerId) {
      return undefined;
    }
    if (this.activityTrackerDataSourceId) {
      return this.activityTrackerDataSourceId;
    }

    const configuredId = this.config.notionActivityTrackerId;
    try {
      await notionJson(this.config, `/v1/data_sources/${configuredId}`, "GET");
      this.activityTrackerDataSourceId = configuredId;
      return configuredId;
    } catch {
      const database = await notionJson<NotionDatabase>(this.config, `/v1/databases/${configuredId}`, "GET");
      const dataSourceId = database.data_sources?.[0]?.id;
      if (!dataSourceId) {
        throw new Error(`Could not resolve data source id from Notion database ${configuredId}.`);
      }
      this.activityTrackerDataSourceId = dataSourceId;
      return dataSourceId;
    }
  }
}

export function submittedActivityFromInput(activity: Activity, quantity: number, notes?: string): SubmittedActivity {
  const normalizedQuantity = activity.requiresQuantity ? quantity : 1;
  return {
    activity,
    quantity: normalizedQuantity,
    baseCoins: calculateActivityCoins(activity, quantity),
    notes
  };
}
