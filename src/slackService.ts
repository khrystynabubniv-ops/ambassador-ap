import crypto from "node:crypto";
import { WebClient } from "@slack/web-api";
import type { AppConfig } from "./config.js";
import { monthDisplayName } from "./dates.js";
import type { MonthlySummary, ProgramConfig, SubmittedActivity } from "./types.js";
import { displaySlackNickname } from "./text.js";

const HOME_ACTIONS = {
  getReport: "program_get_report",
  sendReminder: "program_send_reminder",
  openForm: "program_open_form"
} as const;

export type SlackHomeAction = (typeof HOME_ACTIONS)[keyof typeof HOME_ACTIONS];

export const slackHomeActions = HOME_ACTIONS;

type HomeViewParams = {
  userId: string;
  programs: Array<{
    program: ProgramConfig;
    month: string;
    formUrl?: string;
    configured: boolean;
  }>;
  notice?: string;
};

export function monthlyReminderText(program: ProgramConfig, monthToReport: string, formUrl: string): string {
  return [
    program.slackContent.reminderGreeting,
    "",
    `${program.slackContent.reminderIntro} за *${monthDisplayName(monthToReport)}*.`,
    "",
    `📝 <${formUrl}|${program.slackContent.reminderCta}>`,
    `📎 ${program.slackContent.reminderProofHint}`,
    "",
    `Деталі програми тут: <${program.programDetailsUrl}|${program.slackContent.detailsLabel}>`
  ].join("\n");
}

export function monthlyReportText(program: ProgramConfig, month: string, reportText: string): string {
  if (!program.slackReportMentionUserId) {
    return reportText;
  }

  return [
    `<@${program.slackReportMentionUserId}>, нагадування: видай ${program.shortName} коіни за *${monthDisplayName(month)}*.`,
    "",
    `\`\`\`${reportText}\`\`\``
  ].join("\n");
}

export class SlackService {
  private readonly client?: WebClient;

  constructor(private readonly config: AppConfig) {
    this.client = config.slackBotToken ? new WebClient(config.slackBotToken) : undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  verifyRequest(rawBody: Buffer | undefined, timestamp: string | undefined, signature: string | undefined): boolean {
    if (!this.config.slackSigningSecret) {
      return true;
    }

    if (!rawBody || !timestamp || !signature) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 60 * 5) {
      return false;
    }

    const base = `v0:${timestamp}:${rawBody.toString("utf8")}`;
    const expected = `v0=${crypto
      .createHmac("sha256", this.config.slackSigningSecret)
      .update(base)
      .digest("hex")}`;

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async postMessage(channel: string | undefined, text: string): Promise<void> {
    if (!this.client || !channel) {
      return;
    }

    const targetChannel = await this.resolveChannel(channel);
    await this.client.chat.postMessage({
      channel: targetChannel,
      text,
      unfurl_links: false,
      unfurl_media: false
    });
  }

  async sendSubmissionNotification(program: ProgramConfig, params: {
    month: string;
    slackNickname: string;
    activities: SubmittedActivity[];
    totalCoins: number;
  }): Promise<void> {
    const lines = params.activities
      .map((item) => `• ${item.activity.title}: ${item.quantity} × ${item.activity.coinsPerUnit} = ${item.baseCoins}`)
      .join("\n");
    const text = [
      `${program.slackContent.notificationTitle}: ${displaySlackNickname(params.slackNickname)} за ${monthDisplayName(params.month)}.`,
      lines,
      `Поточний total за місяць: ${params.totalCoins} coins.`
    ].join("\n");

    await this.postMessage(program.slackAdminChannelId, text);
  }

  async sendEgcSubmissionNotification(program: ProgramConfig, summary: MonthlySummary): Promise<void> {
    const text = [
      `${program.slackContent.notificationTitle}: ${displaySlackNickname(summary.slackNickname)} за ${monthDisplayName(summary.month)}.`,
      summary.activityBreakdown || "Без деталізації активностей.",
      `До видачі: ${summary.totalCoins} coins.`
    ].join("\n");

    await this.postMessage(program.slackAdminChannelId, text);
  }

  async sendMonthlyReminder(program: ProgramConfig, monthToReport: string, formUrl: string): Promise<void> {
    const text = monthlyReminderText(program, monthToReport, formUrl);

    await this.postMessage(program.slackCommunityChannelId, text);
  }

  async publishHome(params: HomeViewParams): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.views.publish({
      user_id: params.userId,
      view: {
        type: "home",
        callback_id: "program_home",
        blocks: buildHomeBlocks(params)
      }
    });
  }

  async sendMonthlyReport(program: ProgramConfig, month: string, reportText: string): Promise<void> {
    const channel = program.slackReportChannelId ?? program.slackAdminChannelId;
    await this.postMessage(channel, monthlyReportText(program, month, reportText));
  }

  async sendReportToUser(program: ProgramConfig, userId: string, month: string, reportText: string): Promise<void> {
    await this.postMessage(
      userId,
      [`Ось ${program.shortName} report за *${monthDisplayName(month)}*`, "", `\`\`\`${reportText}\`\`\``].join("\n")
    );
  }

  async respondToSlackResponseUrl(responseUrl: string, text: string): Promise<void> {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text
      })
    });
  }

  private async resolveChannel(channel: string): Promise<string> {
    if (!this.client || !channel.startsWith("U")) {
      return channel;
    }

    const response = await this.client.conversations.open({
      users: channel
    });

    const dmChannel = response.channel?.id;
    if (!dmChannel) {
      throw new Error(`Could not open Slack DM for user ${channel}.`);
    }

    return dmChannel;
  }
}

function buildHomeBlocks(params: HomeViewParams) {
  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Program Coins"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "Привіт! Тут можна керувати коінами для кількох програм з одного Slack bot.",
          "Період підставляю автоматично за попередній місяць, а програми розділяю нижче."
        ].join("\n")
      }
    }
  ];

  if (params.notice) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: params.notice
        }
      ]
    });
  }

  params.programs.forEach((item, index) => {
    if (index > 0) {
      blocks.push({ type: "divider" });
    }

    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*${item.program.slackContent.homeTitle}*`,
            `${item.program.slackContent.homeDescription}`,
            item.configured
              ? `Поточний період: *${monthDisplayName(item.month)}*.`
              : "_Notion data sources ще не налаштовані для цієї програми._"
          ].join("\n")
        }
      },
      {
        type: "actions",
        block_id: `${item.program.key}_home_actions`,
        elements: [
          ...(item.formUrl
            ? [
                {
                  type: "button",
                  text: {
                    type: "plain_text",
                    text: "Відкрити форму"
                  },
                  action_id: HOME_ACTIONS.openForm,
                  value: actionValue(item.program.key, item.month),
                  url: item.formUrl
                }
              ]
            : []),
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Отримати звіт"
            },
            action_id: HOME_ACTIONS.getReport,
            value: actionValue(item.program.key, item.month),
            style: "primary"
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Надіслати нагадування"
            },
            action_id: HOME_ACTIONS.sendReminder,
            value: actionValue(item.program.key, item.month),
            confirm: confirmDialog(
              "Надіслати нагадування?",
              `Я напишу в ${item.program.slackContent.reminderChannelLabel}, якщо за цей місяць воно ще не відправлялося.`
            )
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Деталі: <${item.program.programDetailsUrl}|${item.program.slackContent.detailsLabel}>`
          }
        ]
      }
    );
  });

  return blocks;
}

export function actionValue(programKey: string, month: string): string {
  return `${programKey}:${month}`;
}

export function parseActionValue(value: string | undefined): { programKey?: string; month?: string } {
  const match = /^(?<programKey>[a-z0-9_-]+):(?<month>\d{4}-\d{2})$/.exec(value ?? "");
  return {
    programKey: match?.groups?.programKey,
    month: match?.groups?.month
  };
}

function confirmDialog(title: string, text: string) {
  return {
    title: {
      type: "plain_text",
      text: title
    },
    text: {
      type: "mrkdwn",
      text
    },
    confirm: {
      type: "plain_text",
      text: "Так"
    },
    deny: {
      type: "plain_text",
      text: "Скасувати"
    }
  };
}
