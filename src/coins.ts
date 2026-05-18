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
  ambassadorName: string | undefined,
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
  const activityQuantities = submittedActivities.reduce<Record<string, number>>((acc, item) => {
    acc[item.activity.key] = (acc[item.activity.key] ?? 0) + item.quantity;
    return acc;
  }, {});
  const activityBreakdown = Object.values(
    submittedActivities.reduce<Record<string, { title: string; quantity: number; coins: number }>>((acc, item) => {
      acc[item.activity.key] ??= { title: item.activity.title, quantity: 0, coins: 0 };
      acc[item.activity.key].quantity += item.quantity;
      acc[item.activity.key].coins += item.baseCoins;
      return acc;
    }, {})
  )
    .map((item) => `${item.title}: ${item.quantity} (${item.coins} coins)`)
    .join("; ");

  return {
    ambassadorName,
    month,
    slackNickname,
    slackUserId,
    baseCoins,
    distinctCompleted,
    bonusCoins,
    totalCoins,
    reportLine: `${handle} - ${totalCoins} coins`,
    activityQuantities,
    activityBreakdown
  };
}
