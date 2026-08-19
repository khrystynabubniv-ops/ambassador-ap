import cron from "node-cron";
import { DateTime } from "luxon";
import type { AppConfig } from "./config.js";
import { previousMonth } from "./dates.js";
import type { RewardsProgram } from "./ambassadorProgram.js";
import type { ProgramConfig } from "./types.js";

export function startSchedulers(config: AppConfig, programs: RewardsProgram[]): void {
  for (const program of programs) {
    startScheduler(config, program.config, program);
  }
}

function startScheduler(_config: AppConfig, programConfig: ProgramConfig, program: RewardsProgram): void {
  cron.schedule(
    `${programConfig.reminderMinute} ${programConfig.reminderHour} ${programConfig.reminderDay} * *`,
    async () => {
      const now = DateTime.now().setZone(programConfig.timezone);
      const monthToReport = previousMonth(programConfig.timezone, now);
      await program.sendReminderIfDue(monthToReport, `${programConfig.key}:reminder:${monthToReport}`).catch((error) => {
        console.error(`${programConfig.key} scheduled reminder failed`, error);
      });
    },
    { timezone: programConfig.timezone }
  );

  cron.schedule(
    `0 ${programConfig.reportHour} ${programConfig.reportDay} * *`,
    async () => {
      const now = DateTime.now().setZone(programConfig.timezone);
      const monthToReport = previousMonth(programConfig.timezone, now);
      await program.sendReportIfDue(monthToReport, `${programConfig.key}:report:${monthToReport}`).catch((error) => {
        console.error(`${programConfig.key} scheduled report failed`, error);
      });
    },
    { timezone: programConfig.timezone }
  );

  runDueAutomations(programConfig, program).catch((error) => {
    console.error(`${programConfig.key} startup automation reconciliation failed`, error);
  });
}

export async function runDueAutomations(config: ProgramConfig, program: RewardsProgram): Promise<void> {
  const now = DateTime.now().setZone(config.timezone);
  const monthToReport = previousMonth(config.timezone, now);

  if (now.day === config.reminderDay && now.hour >= config.reminderHour) {
    await program.sendReminderIfDue(monthToReport, `${config.key}:reminder:${monthToReport}`);
  }

  if (now.day === config.reportDay && now.hour >= config.reportHour) {
    await program.sendReportIfDue(monthToReport, `${config.key}:report:${monthToReport}`);
  }
}
