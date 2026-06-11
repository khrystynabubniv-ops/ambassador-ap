import { calculateMonthlySummary, normalizeQuantity } from "./coins.js";
import { monthDisplayName, monthsOfYear, previousMonth } from "./dates.js";
import { NotionService, submittedActivityFromInput } from "./notionService.js";
import { SlackService } from "./slackService.js";
import { displaySlackNickname, normalizeSlackNickname } from "./text.js";
import type { EgcReportInput, MonthlySummary, ProgramConfig, SubmissionInput, SubmittedActivity } from "./types.js";

export const EGC_MAX_PROOF_FILES = 10;

export class RewardsProgram {
  constructor(
    readonly config: ProgramConfig,
    private readonly notion: NotionService,
    private readonly slack: SlackService
  ) {}

  async getFormConfig() {
    const year = Number(previousMonth(this.config.timezone).slice(0, 4));
    return {
      program: {
        key: this.config.key,
        mode: this.config.mode,
        slug: this.config.slug,
        displayName: this.config.displayName,
        shortName: this.config.shortName,
        content: this.config.content
      },
      currentMonth: previousMonth(this.config.timezone),
      months: monthsOfYear(year),
      bonusThreshold: this.config.bonusThreshold,
      bonusCoins: this.config.bonusCoins,
      egcCoinRates: this.config.egcCoinRates,
      activities: await this.notion.listActivities()
    };
  }

  async submit(input: SubmissionInput, filesByActivityIndex: Map<number, Express.Multer.File[]>): Promise<MonthlySummary> {
    if (this.config.mode !== "activity") {
      throw new Error(`${this.config.displayName} uses a dedicated report form.`);
    }
    if (!this.notion.isConfigured()) {
      throw new Error(`${this.config.displayName} Notion data sources are not configured yet.`);
    }

    const activities = await this.notion.listActivities();
    const activityByKey = new Map(activities.map((activity) => [activity.key, activity]));
    const normalizedInput: SubmissionInput = {
      ...input,
      slackNickname: normalizeSlackNickname(input.slackNickname)
    };

    const submitted: SubmittedActivity[] = [];
    const submittedFiles: Express.Multer.File[] = [];
    for (let index = 0; index < normalizedInput.activities.length; index += 1) {
      const activityInput = normalizedInput.activities[index];
      const activity = activityByKey.get(activityInput.activityKey);
      if (!activity) {
        throw new Error(`Unknown activity: ${activityInput.activityKey}`);
      }

      const quantity = normalizeQuantity(activity, activityInput.quantity);
      const submittedActivity = submittedActivityFromInput(activity, quantity, activityInput.notes);
      if (activity.requiresProof && !(filesByActivityIndex.get(index)?.length)) {
        throw new Error(`Proof files are required for: ${activity.title}`);
      }

      submittedFiles.push(...(filesByActivityIndex.get(index) ?? []));
      submitted.push(submittedActivity);
    }

    const existingSummary = await this.notion.getMonthlySummary(normalizedInput.month, normalizedInput.slackNickname);
    const mergedQuantities = { ...(existingSummary?.activityQuantities ?? {}) };
    for (const item of submitted) {
      mergedQuantities[item.activity.key] = (mergedQuantities[item.activity.key] ?? 0) + item.quantity;
    }

    const allMonthlyActivities = activities
      .map((activity) => {
        const quantity = mergedQuantities[activity.key] ?? 0;
        return quantity > 0
          ? {
              activity,
              quantity,
              baseCoins: quantity * activity.coinsPerUnit
            }
          : undefined;
      })
      .filter((item): item is SubmittedActivity => Boolean(item));

    const summary = calculateMonthlySummary(
      normalizedInput.month,
      normalizedInput.participantName,
      normalizedInput.slackNickname,
      normalizedInput.slackUserId,
      allMonthlyActivities,
      {
        bonusThreshold: this.config.bonusThreshold,
        bonusCoins: this.config.bonusCoins,
        bonusDistinctBy: this.config.bonusDistinctBy
      }
    );

    await this.notion.ensureParticipant(normalizedInput);
    for (let index = 0; index < submitted.length; index += 1) {
      await this.notion.createSubmissionActivity(normalizedInput, submitted[index], filesByActivityIndex.get(index) ?? []);
    }
    await this.ensureYearRows(normalizedInput, activities);
    await this.notion.upsertMonthlySummary(summary, submittedFiles);
    await this.notion.upsertActivityTrackerFlag(summary);
    await this.slack.sendSubmissionNotification(this.config, {
      month: normalizedInput.month,
      slackNickname: normalizedInput.slackNickname,
      activities: submitted,
      totalCoins: summary.totalCoins
    });

    return summary;
  }

  async submitEgcReport(input: EgcReportInput, files: Express.Multer.File[]): Promise<MonthlySummary> {
    if (this.config.mode !== "egc-report") {
      throw new Error(`${this.config.displayName} does not accept EGC reports.`);
    }
    if (!this.notion.isConfigured()) {
      throw new Error(`${this.config.displayName} Notion EGC reports data source is not configured yet.`);
    }
    if (files.length > EGC_MAX_PROOF_FILES) {
      throw new Error(`Можна додати максимум ${EGC_MAX_PROOF_FILES} файлів до EGC форми.`);
    }

    const normalizedInput: EgcReportInput = {
      ...input,
      participantName: input.participantName || input.slackNickname,
      slackNickname: normalizeSlackNickname(input.slackNickname)
    };
    const summary = await this.notion.createEgcReport(normalizedInput, files);
    await this.slack.sendEgcSubmissionNotification(this.config, summary);

    return summary;
  }

  async buildMonthlyReport(month: string): Promise<string> {
    const activeSummaries = (await this.notion.listMonthlySummaries(month)).filter((summary) => summary.hasActivity);
    const lines = activeSummaries.length
      ? activeSummaries
          .sort((a, b) => b.totalCoins - a.totalCoins || a.slackNickname.localeCompare(b.slackNickname))
          .map((summary) => summary.reportLine || `${displaySlackNickname(summary.slackNickname)} - ${summary.totalCoins} coins`)
      : ["No submissions yet."];

    return [`${this.config.slackContent.reportTitle} - ${monthDisplayName(month)}`, "", ...lines].join("\n");
  }

  async sendReminderIfDue(monthToReport: string, key: string): Promise<boolean> {
    if (!this.config.slackCommunityChannelId) {
      return false;
    }
    if (await this.notion.hasAutomationLog("reminder", key)) {
      return false;
    }

    const formUrl = this.config.publicBaseUrl
      ? this.formUrlForMonth(monthToReport)
      : `Form URL is not configured. Set PUBLIC_BASE_URL.`;
    await this.slack.sendMonthlyReminder(this.config, monthToReport, formUrl);
    await this.notion.logAutomationEvent("reminder", key, monthToReport, this.config.slackCommunityChannelId, formUrl);
    return true;
  }

  async sendReportIfDue(month: string, key: string): Promise<boolean> {
    const channel = this.config.slackReportChannelId ?? this.config.slackAdminChannelId;
    if (!channel) {
      return false;
    }
    if (await this.notion.hasAutomationLog("report", key)) {
      return false;
    }

    const report = await this.buildMonthlyReport(month);
    await this.slack.sendMonthlyReport(this.config, month, report);
    await this.notion.logAutomationEvent("report", key, month, channel, report);
    return true;
  }

  private async ensureYearRows(input: SubmissionInput, activities: Awaited<ReturnType<NotionService["listActivities"]>>): Promise<void> {
    const year = Number(input.month.slice(0, 4));
    for (const month of monthsOfYear(year)) {
      const existing = await this.notion.getMonthlySummary(month, input.slackNickname);
      if (existing) continue;

      const summary = calculateMonthlySummary(month, input.participantName, input.slackNickname, input.slackUserId, [], {
        bonusThreshold: this.config.bonusThreshold,
        bonusCoins: this.config.bonusCoins,
        bonusDistinctBy: this.config.bonusDistinctBy
      });

      summary.activityQuantities = Object.fromEntries(activities.map((activity) => [activity.key, 0]));
      await this.notion.upsertMonthlySummary(summary);
    }
  }

  formUrlForMonth(month: string): string {
    const url = new URL(this.config.publicBaseUrl!);
    url.pathname = `/${this.config.slug}`;
    url.searchParams.set("month", month);
    return url.toString();
  }
}

export { RewardsProgram as AmbassadorProgram };
