import type { AppConfig } from "./config.js";
import { calculateMonthlySummary, normalizeQuantity } from "./coins.js";
import { monthDisplayName, previousMonth } from "./dates.js";
import { NotionService, submittedActivityFromInput } from "./notionService.js";
import { SlackService } from "./slackService.js";
import { displaySlackNickname, normalizeSlackNickname } from "./text.js";
import type { MonthlySummary, SubmissionInput, SubmittedActivity } from "./types.js";

export class AmbassadorProgram {
  constructor(
    private readonly config: AppConfig,
    private readonly notion: NotionService,
    private readonly slack: SlackService
  ) {}

  async getFormConfig() {
    return {
      currentMonth: previousMonth(this.config.timezone),
      months: await import("./dates.js").then((dates) => dates.recentMonths(this.config.timezone, 6)),
      bonusThreshold: this.config.bonusThreshold,
      bonusCoins: this.config.bonusCoins,
      activities: await this.notion.listActivities()
    };
  }

  async submit(input: SubmissionInput, filesByActivityIndex: Map<number, Express.Multer.File[]>): Promise<MonthlySummary> {
    if (!this.notion.isConfigured()) {
      throw new Error("Notion data sources are not configured yet.");
    }

    const activities = await this.notion.listActivities();
    const activityByKey = new Map(activities.map((activity) => [activity.key, activity]));
    const normalizedInput: SubmissionInput = {
      ...input,
      slackNickname: normalizeSlackNickname(input.slackNickname)
    };

    await this.notion.ensureAmbassador(normalizedInput);

    const submitted: SubmittedActivity[] = [];
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

      await this.notion.createSubmissionActivity(normalizedInput, submittedActivity, filesByActivityIndex.get(index) ?? []);
      submitted.push(submittedActivity);
    }

    const allMonthlyActivities = await this.notion.listSubmittedActivities(
      normalizedInput.month,
      normalizedInput.slackNickname
    );
    const summary = calculateMonthlySummary(
      normalizedInput.month,
      normalizedInput.ambassadorName,
      normalizedInput.slackNickname,
      normalizedInput.slackUserId,
      allMonthlyActivities,
      {
        bonusThreshold: this.config.bonusThreshold,
        bonusCoins: this.config.bonusCoins,
        bonusDistinctBy: this.config.bonusDistinctBy
      }
    );

    await this.notion.upsertMonthlySummary(summary);
    await this.slack.sendSubmissionNotification({
      month: normalizedInput.month,
      slackNickname: normalizedInput.slackNickname,
      activities: submitted,
      totalCoins: summary.totalCoins
    });

    return summary;
  }

  async buildMonthlyReport(month: string): Promise<string> {
    const summaries = await this.notion.listMonthlySummaries(month);
    const lines = summaries.length
      ? summaries
          .sort((a, b) => b.totalCoins - a.totalCoins || a.slackNickname.localeCompare(b.slackNickname))
          .map((summary) => summary.reportLine || `${displaySlackNickname(summary.slackNickname)} - ${summary.totalCoins} coins`)
      : ["No submissions yet."];

    return [`Ambassador coins report - ${monthDisplayName(month)}`, "", ...lines].join("\n");
  }

  async sendReminderIfDue(monthToReport: string, key: string): Promise<boolean> {
    if (!this.config.slackAmbassadorChannelId) {
      return false;
    }
    if (await this.notion.hasAutomationLog("reminder", key)) {
      return false;
    }

    const formUrl = this.config.publicBaseUrl
      ? `${this.config.publicBaseUrl}?month=${monthToReport}`
      : `Form URL is not configured. Set PUBLIC_BASE_URL.`;
    await this.slack.sendMonthlyReminder(monthToReport, formUrl);
    await this.notion.logAutomationEvent("reminder", key, monthToReport, this.config.slackAmbassadorChannelId, formUrl);
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
    await this.slack.sendMonthlyReport(month, report);
    await this.notion.logAutomationEvent("report", key, month, channel, report);
    return true;
  }
}
