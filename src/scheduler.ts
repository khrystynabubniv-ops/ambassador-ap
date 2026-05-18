import cron from "node-cron";
import { DateTime } from "luxon";
import type { AppConfig } from "./config.js";
import { previousMonth } from "./dates.js";
import type { AmbassadorProgram } from "./ambassadorProgram.js";

export function startScheduler(config: AppConfig, program: AmbassadorProgram): void {
  cron.schedule(
    `0 ${config.reminderHour} ${config.reminderDay} * *`,
    async () => {
      const now = DateTime.now().setZone(config.timezone);
      const monthToReport = previousMonth(config.timezone, now);
      await program.sendReminderIfDue(monthToReport, `reminder:${monthToReport}`).catch((error) => {
        console.error("Scheduled reminder failed", error);
      });
    },
    { timezone: config.timezone }
  );

  cron.schedule(
    `0 ${config.reportHour} ${config.reportDay} * *`,
    async () => {
      const now = DateTime.now().setZone(config.timezone);
      const monthToReport = previousMonth(config.timezone, now);
      await program.sendReportIfDue(monthToReport, `report:${monthToReport}`).catch((error) => {
        console.error("Scheduled report failed", error);
      });
    },
    { timezone: config.timezone }
  );
}

export async function runDueAutomations(config: AppConfig, program: AmbassadorProgram): Promise<void> {
  const now = DateTime.now().setZone(config.timezone);
  const monthToReport = previousMonth(config.timezone, now);

  if (now.day === config.reminderDay && now.hour >= config.reminderHour) {
    await program.sendReminderIfDue(monthToReport, `reminder:${monthToReport}`);
  }

  if (now.day === config.reportDay && now.hour >= config.reportHour) {
    await program.sendReportIfDue(monthToReport, `report:${monthToReport}`);
  }
}
