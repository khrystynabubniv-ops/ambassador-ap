import type { Activity, MonthlySummary, SubmittedActivity } from "./types.js";

export type CoinRules = {
  bonusThreshold: number;
  bonusCoins: number;
  bonusDistinctBy: "activity" | "category";
};

export function normalizeQuantity(activity: Activity, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 1) {
    return 1;
  }

  return activity.requiresQuantity ? Math.floor(quantity) : 1;
}

export function calculateActivityCoins(activity: Activity, quantity: number): number {
  return normalizeQuantity(activity, quantity) * activity.coinsPerUnit;
}

export function calculateMonthlySummary(
  month: string,
  slackNickname: string,
  slackUserId: string | undefined,
  submittedActivities: SubmittedActivity[],
  rules: CoinRules
): MonthlySummary {
  const baseCoins = submittedActivities.reduce((total, item) => total + item.baseCoins, 0);
  const distinctValues = new Set(
    submittedActivities
      .filter((item) => item.baseCoins > 0)
      .map((item) => (rules.bonusDistinctBy === "category" ? item.activity.category : item.activity.key))
  );
  const distinctCompleted = distinctValues.size;
  const bonusCoins = distinctCompleted >= rules.bonusThreshold ? rules.bonusCoins : 0;
  const totalCoins = baseCoins + bonusCoins;
  const handle = slackNickname.startsWith("@") ? slackNickname : `@${slackNickname}`;

  return {
    month,
    slackNickname,
    slackUserId,
    baseCoins,
    distinctCompleted,
    bonusCoins,
    totalCoins,
    reportLine: `${handle} - ${totalCoins} coins`
  };
}
