import crypto from "node:crypto";
import { WebClient } from "@slack/web-api";
import type { AppConfig } from "./config.js";
import { monthDisplayName } from "./dates.js";
import type { MonthlySummary, SubmittedActivity } from "./types.js";
import { displaySlackNickname } from "./text.js";

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
      `Новий ambassador checklist: ${displaySlackNickname(params.slackNickname)} за ${monthDisplayName(params.month)}.`,
      lines,
      `Поточний total за місяць: ${params.totalCoins} coins.`
    ].join("\n");

    await this.postMessage(this.config.slackAdminChannelId, text);
  }

  async sendMonthlyReminder(monthToReport: string, formUrl: string): Promise<void> {
    const text = [
      `Нагадування: заповніть ambassador checklist за ${monthDisplayName(monthToReport)}.`,
      `Форма: ${formUrl}`
    ].join("\n");

    await this.postMessage(this.config.slackAmbassadorChannelId, text);
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
