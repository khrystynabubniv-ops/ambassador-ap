import type {
  Activity,
  AutomationKind,
  EgcReportInput,
  MonthlySummary,
  ProgramConfig,
  SubmissionInput,
  SubmittedActivity
} from "./types.js";
import { calculateActivityCoins, calculateEgcCoins } from "./coins.js";
import { monthDisplayName, monthEnd, monthFromUkrainianName, monthStart, monthUkrainianName } from "./dates.js";
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
import { activitySummaryProperties, TRACKER_PROPERTIES } from "./notionSchema.js";
import { MAX_PROOF_FILE_SIZE_BYTES, MAX_PROOF_FILE_SIZE_MB } from "./uploadLimits.js";

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

const EGC_PROPERTIES = {
  title: "Name",
  period: "За який період ти заповнюєш звіт?",
  instagramStories: "К-ть сторіз в Instagram",
  instagramVacancyStories: "К-ть сторіз з вакансією в Instagram",
  instagramReels: "К-ть рілз в Instagram",
  instagramPosts: "К-ть постів в Instagram",
  linkedinPosts: "К-ть постів в Лінкедін",
  linkedinVacancyPosts: "К-ть постів з вакансією в Лінкедін",
  proofFiles: "Додай скріншоти постів і рілз",
  formulaCoins: "К-ть коінів",
  slack: "Slack",
  storySeries: "К-ть серій сторіз в Instagram",
  storySeriesDays: "Дні серій сторіз",
  coinsToIssue: "Коіни до видачі"
} as const;

export class NotionService {
  private activityTrackerDataSourceId?: string;
  private activityTrackerSchemaReady = false;
  private egcReportsSchemaReady = false;
  private activityCatalogUnavailableLogged = false;

  constructor(private readonly config: ProgramConfig) {}

  isConfigured(): boolean {
    if (this.config.mode === "egc-report") {
      return Boolean(this.config.notionApiKey && this.config.notionEgcReportsDataSourceId);
    }

    return Boolean(
      this.config.notionApiKey &&
        this.config.notionParticipantsDataSourceId &&
        this.config.notionSubmissionsDataSourceId &&
        this.config.notionMonthlySummaryDataSourceId
    );
  }

  async listActivities(): Promise<Activity[]> {
    if (this.config.notionApiKey && this.config.notionActivityCatalogDataSourceId) {
      try {
        const pages = (await queryDataSource(this.config, this.config.notionActivityCatalogDataSourceId, {
          sorts: [{ property: "Order", direction: "ascending" }]
        })) as NotionPage[];
        const activities = pages.map((page) => this.activityFromPage(page)).filter((activity) => activity.active);
        if (activities.length) {
          return activities.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        }
      } catch {
        if (!this.activityCatalogUnavailableLogged) {
          console.warn(`${this.config.key} Activity Catalog is unavailable; using configured defaults.`);
          this.activityCatalogUnavailableLogged = true;
        }
      }
    }

    return this.config.activities.filter((activity) => activity.active).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  async createEgcReport(input: EgcReportInput, files: Express.Multer.File[]): Promise<MonthlySummary> {
    this.requireDataSource("notionEgcReportsDataSourceId");
    await this.ensureEgcReportsSchema();

    const normalizedInput: EgcReportInput = {
      ...input,
      participantName: input.participantName || normalizeSlackNickname(input.slackNickname),
      slackNickname: normalizeSlackNickname(input.slackNickname)
    };
    const proofs = await this.uploadProofFiles(files);
    const calculated = calculateEgcCoins(normalizedInput, this.config.egcCoinRates);
    const title = `${normalizedInput.participantName} - ${monthDisplayName(normalizedInput.month)}`;

    const response = await notionJson<NotionPage>(this.config, "/v1/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: this.config.notionEgcReportsDataSourceId },
      properties: {
        [EGC_PROPERTIES.title]: titleText(title),
        [EGC_PROPERTIES.period]: {
          date: {
            start: monthStart(normalizedInput.month),
            end: monthEnd(normalizedInput.month)
          }
        },
        [EGC_PROPERTIES.instagramStories]: { number: normalizedInput.instagramStories },
        [EGC_PROPERTIES.instagramVacancyStories]: { number: normalizedInput.instagramVacancyStories },
        [EGC_PROPERTIES.instagramReels]: { number: normalizedInput.instagramReels },
        [EGC_PROPERTIES.instagramPosts]: { number: normalizedInput.instagramPosts },
        [EGC_PROPERTIES.linkedinPosts]: { number: normalizedInput.linkedinPosts },
        [EGC_PROPERTIES.linkedinVacancyPosts]: { number: normalizedInput.linkedinVacancyPosts },
        [EGC_PROPERTIES.proofFiles]: {
          files: proofs.map((proof) => ({
            name: proof.name,
            type: "file_upload",
            file_upload: { id: proof.id }
          }))
        },
        [EGC_PROPERTIES.slack]: richText(normalizedInput.slackNickname),
        [EGC_PROPERTIES.storySeries]: { number: normalizedInput.instagramStorySeries },
        [EGC_PROPERTIES.storySeriesDays]: richText(normalizedInput.storySeriesDays.join(", ")),
        [EGC_PROPERTIES.coinsToIssue]: { number: calculated.totalCoins }
      }
    });

    return this.egcSummaryFromPage(response, normalizedInput.month, normalizedInput, calculated.totalCoins);
  }

  async ensureParticipant(input: SubmissionInput): Promise<void> {
    this.requireDataSource("notionParticipantsDataSourceId");
    const nickname = normalizeSlackNickname(input.slackNickname);
    const existing = await this.findFirst(this.config.notionParticipantsDataSourceId!, {
      property: "Slack Nickname",
      rich_text: { equals: nickname }
    });

    const properties = {
      Name: titleText(input.participantName),
      "Slack Nickname": richText(nickname),
      "Slack User ID": richText(input.slackUserId ?? ""),
      Active: { checkbox: true },
      "Created Via": richText(this.config.createdVia)
    };

    if (existing) {
      await notionJson(this.config, `/v1/pages/${existing.id}`, "PATCH", { properties });
      return;
    }

    await notionJson(this.config, "/v1/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: this.config.notionParticipantsDataSourceId },
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
        "Ambassador Name": richText(input.participantName),
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
    return existing ? this.summaryFromPage(existing, month, await this.listActivities()) : undefined;
  }

  async upsertMonthlySummary(summary: MonthlySummary, proofFiles: Express.Multer.File[] = []): Promise<void> {
    this.requireDataSource("notionMonthlySummaryDataSourceId");
    const existing = await this.findSummaryPage(summary.month, summary.slackNickname, summary.participantName);
    const proofs = await this.uploadProofFiles(proofFiles);
    const activities = await this.listActivities();

    const properties = {
      [TRACKER_PROPERTIES.title]: titleText(summary.participantName || displaySlackNickname(summary.slackNickname)),
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
        activitySummaryProperties(activities).map(({ key, property }) => [
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
      summary.participantName,
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
        [TRACKER_PROPERTIES.title]: titleText(summary.participantName || displaySlackNickname(summary.slackNickname)),
        [TRACKER_PROPERTIES.slack]: richText(normalizeSlackNickname(summary.slackNickname)),
        [TRACKER_PROPERTIES.month]: { select: { name: monthUkrainianName(summary.month) } },
        ...properties
      }
    });
  }

  async listMonthlySummaries(month: string): Promise<MonthlySummary[]> {
    if (this.config.mode === "egc-report") {
      return this.listEgcMonthlySummaries(month);
    }

    this.requireDataSource("notionMonthlySummaryDataSourceId");
    const activities = await this.listActivities();
    const pages = (await queryDataSource(this.config, this.config.notionMonthlySummaryDataSourceId!, {
      filter: { property: TRACKER_PROPERTIES.month, select: { equals: monthUkrainianName(month) } },
      sorts: [{ property: TRACKER_PROPERTIES.totalCoins, direction: "descending" }]
    })) as NotionPage[];

    return pages.map((page) => ({
      ...this.summaryFromPage(page, month, activities),
      month
    }));
  }

  async listEgcMonthlySummaries(month: string): Promise<MonthlySummary[]> {
    this.requireDataSource("notionEgcReportsDataSourceId");
    const pages = (await queryDataSource(this.config, this.config.notionEgcReportsDataSourceId!, {
      filter: {
        and: [
          { property: EGC_PROPERTIES.period, date: { on_or_after: monthStart(month) } },
          { property: EGC_PROPERTIES.period, date: { on_or_before: monthEnd(month) } }
        ]
      },
      sorts: [{ property: EGC_PROPERTIES.formulaCoins, direction: "descending" }]
    })) as NotionPage[];

    return pages.map((page) => this.egcSummaryFromPage(page, month));
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

  async ensureEgcReportsSchema(): Promise<void> {
    this.requireDataSource("notionEgcReportsDataSourceId");
    if (this.egcReportsSchemaReady) return;

    await notionJson(this.config, `/v1/data_sources/${this.config.notionEgcReportsDataSourceId}`, "PATCH", {
      properties: {
        [EGC_PROPERTIES.slack]: { rich_text: {} },
        [EGC_PROPERTIES.storySeries]: { number: { format: "number" } },
        [EGC_PROPERTIES.storySeriesDays]: { rich_text: {} },
        [EGC_PROPERTIES.coinsToIssue]: { number: { format: "number" } }
      }
    });

    this.egcReportsSchemaReady = true;
  }

  private activityFromPage(page: NotionPage): Activity {
    const key = propertyPlainText(page.properties.Key);
    const configured = this.config.activities.find((activity) => activity.key === key);
    return {
      key,
      title: propertyPlainText(page.properties.Activity),
      category: propertyPlainText(page.properties.Category),
      summaryProperty: propertyPlainText(page.properties["Summary Property"]) || configured?.summaryProperty,
      coinsPerUnit: propertyNumber(page.properties["Coins per Unit"]),
      requiresQuantity: propertyCheckbox(page.properties["Requires Quantity"]),
      requiresProof: propertyCheckbox(page.properties["Requires Proof"]),
      active: propertyCheckbox(page.properties.Active),
      order: propertyNumber(page.properties.Order)
    };
  }

  private summaryFromPage(page: NotionPage, fallbackMonth: string, activities = this.config.activities): MonthlySummary {
    const selectedMonth = propertyPlainText(page.properties[TRACKER_PROPERTIES.month]);
    const month =
      monthFromUkrainianName(selectedMonth, Number(fallbackMonth.slice(0, 4))) ||
      propertyDate(page.properties.Month).slice(0, 7) ||
      fallbackMonth;
    const participantName =
      propertyPlainText(page.properties[TRACKER_PROPERTIES.title]) ||
      propertyPlainText(page.properties["Participant Name"]) ||
      propertyPlainText(page.properties["Ambassador Name"]);
    const slackNickname =
      propertyPlainText(page.properties[TRACKER_PROPERTIES.slack]) ||
      propertyPlainText(page.properties["Slack Nickname"]);
    const totalCoins =
      propertyNumber(page.properties[TRACKER_PROPERTIES.totalCoins]) ||
      propertyNumber(page.properties["Total Coins"]);
    const activityQuantities = Object.fromEntries(
      activitySummaryProperties(activities).map(({ key, property }) => [key, propertyNumber(page.properties[property])])
    );
    const distinctCompleted = Object.values(activityQuantities).filter((quantity) => quantity > 0).length;
    const hasActivity =
      propertyCheckbox(page.properties[TRACKER_PROPERTIES.hasActivity]) ||
      distinctCompleted > 0 ||
      totalCoins > 0;
    const reportName = slackNickname ? displaySlackNickname(slackNickname) : participantName;
    return {
      participantName,
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

  private egcSummaryFromPage(
    page: NotionPage,
    fallbackMonth: string,
    input = this.egcInputFromPage(page, fallbackMonth),
    totalOverride?: number
  ): MonthlySummary {
    const calculated = calculateEgcCoins(input, this.config.egcCoinRates);
    const formulaCoins = propertyNumber(page.properties[EGC_PROPERTIES.formulaCoins]);
    const coinsToIssue = propertyNumber(page.properties[EGC_PROPERTIES.coinsToIssue]);
    const totalCoins = totalOverride ?? (coinsToIssue || formulaCoins || calculated.totalCoins);
    const slackNickname =
      normalizeSlackNickname(input.slackNickname) ||
      normalizeSlackNickname(propertyPlainText(page.properties[EGC_PROPERTIES.slack])) ||
      propertyPlainText(page.properties.Creator) ||
      propertyPlainText(page.properties[EGC_PROPERTIES.title]);
    const participantName = input.participantName || slackNickname;
    const activityQuantities = {
      instagramStories: input.instagramStories,
      instagramVacancyStories: input.instagramVacancyStories,
      instagramReels: input.instagramReels,
      instagramPosts: input.instagramPosts,
      linkedinPosts: input.linkedinPosts,
      linkedinVacancyPosts: input.linkedinVacancyPosts,
      instagramStorySeries: input.instagramStorySeries
    };

    return {
      participantName,
      month: input.month || fallbackMonth,
      slackNickname,
      hasActivity: Object.values(activityQuantities).some((quantity) => quantity > 0) || totalCoins > 0,
      baseCoins: totalCoins,
      distinctCompleted: Object.values(activityQuantities).filter((quantity) => quantity > 0).length,
      bonusCoins: 0,
      totalCoins,
      reportLine: `${displaySlackNickname(slackNickname || participantName)} - ${totalCoins} coins`,
      activityQuantities,
      activityBreakdown: calculated.breakdown
    };
  }

  private egcInputFromPage(page: NotionPage, fallbackMonth: string): EgcReportInput {
    const title = propertyPlainText(page.properties[EGC_PROPERTIES.title]);
    const slack =
      propertyPlainText(page.properties[EGC_PROPERTIES.slack]) ||
      propertyPlainText(page.properties.Creator) ||
      title.replace(/\s+-\s+.+$/, "");
    const period = propertyDate(page.properties[EGC_PROPERTIES.period]).slice(0, 7) || fallbackMonth;

    return {
      participantName: title.replace(/\s+-\s+.+$/, "") || slack,
      slackNickname: slack,
      month: period,
      instagramStories: propertyNumber(page.properties[EGC_PROPERTIES.instagramStories]),
      instagramVacancyStories: propertyNumber(page.properties[EGC_PROPERTIES.instagramVacancyStories]),
      instagramReels: propertyNumber(page.properties[EGC_PROPERTIES.instagramReels]),
      instagramPosts: propertyNumber(page.properties[EGC_PROPERTIES.instagramPosts]),
      linkedinPosts: propertyNumber(page.properties[EGC_PROPERTIES.linkedinPosts]),
      linkedinVacancyPosts: propertyNumber(page.properties[EGC_PROPERTIES.linkedinVacancyPosts]),
      instagramStorySeries: propertyNumber(page.properties[EGC_PROPERTIES.storySeries]),
      storySeriesDays: propertyPlainText(page.properties[EGC_PROPERTIES.storySeriesDays])
        .split(",")
        .map((day) => day.trim())
        .filter(Boolean)
    };
  }

  private async uploadProofFiles(files: Express.Multer.File[]): Promise<UploadedProof[]> {
    const uploads: UploadedProof[] = [];

    for (const file of files) {
      if (file.size > MAX_PROOF_FILE_SIZE_BYTES) {
        throw new Error(`${file.originalname} більший за ${MAX_PROOF_FILE_SIZE_MB} MB. Стисни файл або завантаж менший.`);
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
    participantName?: string,
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

    if (!participantName) return undefined;

    return this.findFirst(dataSourceId, {
      and: [
        monthFilter,
        { property: TRACKER_PROPERTIES.title, title: { equals: participantName } }
      ]
    });
  }

  private requireDataSource(key: keyof ProgramConfig): void {
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
