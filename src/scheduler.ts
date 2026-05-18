import cron from "node-cron";
import { DateTime } from "luxon";
import type { AppConfig } from "./config.js";
import { previousMonth } from "./dates.js";
import type { AmbassadorProgram } from "./ambassadorProgram.js";

export function startScheduler(config: AppConfig, program: AmbassadorProgram): void {
  cron.schedule(
    "*/30 * * * *",
    async () => {
      await runDueAutomations(config, program).catch((error) => {
        console.error("Scheduled automation failed", error);
      });
    },
    { timezone: config.timezone }
  );

  runDueAutomations(config, program).catch((error) => {
    console.error("Startup automation reconciliation failed", error);
  });
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
