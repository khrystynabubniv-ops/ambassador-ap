import type { AppConfig } from "./config.js";
import type { Activity, AutomationKind, MonthlySummary, SubmissionInput, SubmittedActivity } from "./types.js";
import { DEFAULT_ACTIVITIES } from "./activities.js";
import { calculateActivityCoins } from "./coins.js";
import { monthStart } from "./dates.js";
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

type NotionPage = {
  id: string;
  properties: Record<string, any>;
};

type UploadedProof = {
  id: string;
  name: string;
};

export class NotionService {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.notionApiKey &&
        this.config.notionAmbassadorsDataSourceId &&
        this.config.notionActivityCatalogDataSourceId &&
        this.config.notionSubmissionsDataSourceId &&
        this.config.notionMonthlySummaryDataSourceId &&
        this.config.notionAutomationLogDataSourceId
    );
  }

  async listActivities(): Promise<Activity[]> {
    if (!this.config.notionActivityCatalogDataSourceId || !this.config.notionApiKey) {
      return DEFAULT_ACTIVITIES;
    }

    const pages = (await queryDataSource(this.config, this.config.notionActivityCatalogDataSourceId, {
      sorts: [{ property: "Order", direction: "ascending" }]
    })) as NotionPage[];

    const activities = pages
      .map((page) => this.activityFromPage(page))
      .filter((activity) => activity.active)
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    return activities.length ? activities : DEFAULT_ACTIVITIES;
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

  async upsertMonthlySummary(summary: MonthlySummary): Promise<void> {
    this.requireDataSource("notionMonthlySummaryDataSourceId");
    const existing = await this.findFirst(this.config.notionMonthlySummaryDataSourceId!, {
      and: [
        { property: "Month", date: { equals: monthStart(summary.month) } },
        { property: "Slack Nickname", rich_text: { equals: normalizeSlackNickname(summary.slackNickname) } }
      ]
    });

    const properties = {
      Summary: titleText(`${summary.month} ${displaySlackNickname(summary.slackNickname)}`),
      Month: { date: { start: monthStart(summary.month) } },
      "Slack Nickname": richText(normalizeSlackNickname(summary.slackNickname)),
      "Slack User ID": richText(summary.slackUserId ?? ""),
      "Base Coins": { number: summary.baseCoins },
      "Completed Count": { number: summary.distinctCompleted },
      "Bonus Coins": { number: summary.bonusCoins },
      "Total Coins": { number: summary.totalCoins },
      "Report Line": richText(summary.reportLine),
      "Generated At": { date: { start: new Date().toISOString() } }
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

  async listMonthlySummaries(month: string): Promise<MonthlySummary[]> {
    this.requireDataSource("notionMonthlySummaryDataSourceId");
    const pages = (await queryDataSource(this.config, this.config.notionMonthlySummaryDataSourceId!, {
      filter: { property: "Month", date: { equals: monthStart(month) } },
      sorts: [{ property: "Total Coins", direction: "descending" }]
    })) as NotionPage[];

    return pages.map((page) => ({
      month,
      slackNickname: propertyPlainText(page.properties["Slack Nickname"]),
      slackUserId: propertyPlainText(page.properties["Slack User ID"]),
      baseCoins: propertyNumber(page.properties["Base Coins"]),
      distinctCompleted: propertyNumber(page.properties["Completed Count"]),
      bonusCoins: propertyNumber(page.properties["Bonus Coins"]),
      totalCoins: propertyNumber(page.properties["Total Coins"]),
      reportLine: propertyPlainText(page.properties["Report Line"])
    }));
  }

  async hasAutomationLog(kind: AutomationKind, key: string): Promise<boolean> {
    this.requireDataSource("notionAutomationLogDataSourceId");
    const existing = await this.findFirst(this.config.notionAutomationLogDataSourceId!, {
      and: [
        { property: "Kind", select: { equals: kind } },
        { property: "Key", rich_text: { equals: key } }
      ]
    });
    return Boolean(existing);
  }

  async logAutomationEvent(kind: AutomationKind, key: string, month: string, channel: string, payload: string): Promise<void> {
    this.requireDataSource("notionAutomationLogDataSourceId");
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

  private requireDataSource(key: keyof AppConfig): void {
    if (!this.config.notionApiKey || !this.config[key]) {
      throw new Error(`Notion is not configured. Missing ${String(key)}.`);
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
