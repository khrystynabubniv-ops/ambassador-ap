import crypto from "node:crypto";
import { WebClient } from "@slack/web-api";
import type { AppConfig } from "./config.js";
import { monthDisplayName } from "./dates.js";
import type { SubmittedActivity } from "./types.js";
import { displaySlackNickname } from "./text.js";

const HOME_ACTIONS = {
  getReport: "ambassador_get_report",
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
  notice?: string;
};

export function monthlyReminderText(monthToReport: string, formUrl: string, detailsUrl: string): string {
  return [
    "Привіт, амбасадори! ✨",
    "",
    `Новий місяць уже почався, а це значить, що час заповнити чекліст за *${monthDisplayName(monthToReport)}* 💚`,
    "",
    `📝 <${formUrl}|Заповнити чекліст>`,
    "📸 Додавайте скріншоти виконаних активностей та отримуйте юнікоіни за свою залученість.",
    "",
    `Деталі програми тут: <${detailsUrl}|Ambassador Program for Students> 🌟`
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

  async sendReportToUser(userId: string, month: string, reportText: string): Promise<void> {
    await this.postMessage(
      userId,
      [`Ось report за *${monthDisplayName(month)}* 📊`, "", `\`\`\`${reportText}\`\`\``].join("\n")
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
        text: "Ambassador Coins"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `Привіт! Тут можна швидко керувати амбасадорськими коінами за *${monthDisplayName(params.month)}*.`,
          "Період підставляю автоматично за попередній місяць, щоб тобі не доводилося шукати його вручну."
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
          text: "Отримати звіт"
        },
        action_id: HOME_ACTIONS.getReport,
        value: params.month,
        style: "primary"
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Надіслати нагадування"
        },
        action_id: HOME_ACTIONS.sendReminder,
        value: params.month,
        confirm: confirmDialog(
          "Надіслати нагадування?",
          "Я напишу в ambassador channel м'яке нагадування, якщо за цей місяць воно ще не відправлялося."
        )
      }
    ]
  });

  blocks.push(
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Хочеш звірити правила? Ось деталі програми: <${params.detailsUrl}|Ambassador Program for Students>`
        }
      ]
    },
    {
      type: "divider"
    }
  );

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "Потрібен звіт? Натисни *Отримати звіт*, і я одразу надішлю його тобі в *Messages*."
    }
  });

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
