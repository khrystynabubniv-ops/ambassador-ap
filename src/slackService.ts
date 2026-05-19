import crypto from "node:crypto";
import { WebClient } from "@slack/web-api";
import type { AppConfig } from "./config.js";
import { monthDisplayName } from "./dates.js";
import type { SubmittedActivity } from "./types.js";
import { displaySlackNickname } from "./text.js";

const HOME_ACTIONS = {
  refresh: "ambassador_home_refresh",
  previewReport: "ambassador_preview_report",
  postReport: "ambassador_post_report",
  sendReminder: "ambassador_send_reminder",
  openForm: "ambassador_open_form"
} as const;

export type SlackHomeAction = (typeof HOME_ACTIONS)[keyof typeof HOME_ACTIONS];

export const slackHomeActions = HOME_ACTIONS;

type HomeViewParams = {
  userId: string;
  month: string;
  formUrl?: string;
  detailsUrl: string;
  reportText?: string;
  notice?: string;
};

export function monthlyReminderText(monthToReport: string, formUrl: string, detailsUrl: string): string {
  return [
    `Привіт усім! Новий місяць уже почався — настав час заповнити чекліст за ${monthDisplayName(monthToReport)}: ${formUrl}`,
    "",
    `Додавайте скріншоти виконаних активностей та отримуйте юнікоіни за свою залученість! Детальніше можете прочитати тут ${detailsUrl}!`
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

  async sendSubmissionNotification(params: {
    month: string;
    slackNickname: string;
    activities: SubmittedActivity[];
    totalCoins: number;
  }): Promise<void> {
    const lines = params.activities
      .map((item) => `• ${item.activity.title}: ${item.quantity} × ${item.activity.coinsPerUnit} = ${item.baseCoins}`)
      .join("\n");
    const text = [
      `Новий ambassador activity report: ${displaySlackNickname(params.slackNickname)} за ${monthDisplayName(params.month)}.`,
      lines,
      `Поточний total за місяць: ${params.totalCoins} coins.`
    ].join("\n");

    await this.postMessage(this.config.slackAdminChannelId, text);
  }

  async sendMonthlyReminder(monthToReport: string, formUrl: string): Promise<void> {
    const text = monthlyReminderText(monthToReport, formUrl, this.config.programDetailsUrl);

    await this.postMessage(this.config.slackAmbassadorChannelId, text);
  }

  async publishHome(params: HomeViewParams): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.views.publish({
      user_id: params.userId,
      view: {
        type: "home",
        callback_id: "ambassador_home",
        private_metadata: JSON.stringify({ month: params.month }),
        blocks: buildHomeBlocks(params)
      }
    });
  }

  async sendMonthlyReport(month: string, reportText: string): Promise<void> {
    const channel = this.config.slackReportChannelId ?? this.config.slackAdminChannelId;
    await this.postMessage(channel, reportText);
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
        text: "Ambassador Coins"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Швидкі дії за *${monthDisplayName(params.month)}*.`
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

  blocks.push({
    type: "actions",
    block_id: "ambassador_home_actions",
    elements: [
      ...(params.formUrl
        ? [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Відкрити форму"
              },
              action_id: HOME_ACTIONS.openForm,
              value: params.month,
              url: params.formUrl
            }
          ]
        : []),
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Показати report"
        },
        action_id: HOME_ACTIONS.previewReport,
        value: params.month
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Надіслати reminder"
        },
        action_id: HOME_ACTIONS.sendReminder,
        value: params.month,
        confirm: confirmDialog(
          "Надіслати reminder?",
          "Бот надішле повідомлення в ambassador channel, якщо reminder за цей місяць ще не відправлявся."
        )
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Запостити report"
        },
        action_id: HOME_ACTIONS.postReport,
        value: params.month,
        style: "primary",
        confirm: confirmDialog(
          "Запостити report?",
          "Бот надішле monthly report у report channel, якщо report за цей місяць ще не відправлявся."
        )
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Оновити"
        },
        action_id: HOME_ACTIONS.refresh,
        value: params.month
      }
    ]
  });

  blocks.push(
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Деталі програми: ${params.detailsUrl}`
        }
      ]
    },
    {
      type: "divider"
    }
  );

  if (params.reportText) {
    blocks.push(...reportBlocks(params.reportText));
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Натисни *Показати report*, щоб побачити список учасників із активністю за місяць."
      }
    });
  }

  return blocks;
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

function reportBlocks(reportText: string) {
  const chunks = chunkText(reportText, 2800);
  return chunks.map((chunk, index) => ({
    type: "section",
    block_id: `report_${index}`,
    text: {
      type: "mrkdwn",
      text: `\`\`\`${chunk}\`\`\``
    }
  }));
}

function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength / 2) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
