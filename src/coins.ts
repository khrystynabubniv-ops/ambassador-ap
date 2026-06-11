import type { Activity, EgcCoinRates, EgcReportInput, MonthlySummary, SubmittedActivity } from "./types.js";
import { displaySlackNickname } from "./text.js";

export const DEFAULT_EGC_COIN_RATES: EgcCoinRates = {
  instagramStory: 1,
  instagramVacancyStory: 3,
  instagramReel: 13,
  instagramPost: 12,
  linkedinPost: 12,
  linkedinVacancyPost: 12,
  instagramStorySeries: 3
};

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
  participantName: string | undefined,
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
  const hasActivity = distinctCompleted > 0;
  const bonusCoins = distinctCompleted >= rules.bonusThreshold ? rules.bonusCoins : 0;
  const totalCoins = baseCoins + bonusCoins;
  const handle = displaySlackNickname(slackNickname);
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
    participantName,
    month,
    slackNickname,
    slackUserId,
    hasActivity,
    baseCoins,
    distinctCompleted,
    bonusCoins,
    totalCoins,
    reportLine: `${handle} - ${totalCoins} coins`,
    activityQuantities,
    activityBreakdown
  };
}

export function calculateEgcCoins(input: EgcReportInput, rates: EgcCoinRates = DEFAULT_EGC_COIN_RATES) {
  const items = [
    {
      key: "instagramStories",
      label: "Сторіз зі згадкою Universe в Instagram",
      quantity: input.instagramStories,
      rate: rates.instagramStory
    },
    {
      key: "instagramVacancyStories",
      label: "Сторіз з вакансією в Instagram",
      quantity: input.instagramVacancyStories,
      rate: rates.instagramVacancyStory
    },
    {
      key: "instagramReels",
      label: "Рілз/TikTok в Instagram",
      quantity: input.instagramReels,
      rate: rates.instagramReel
    },
    {
      key: "instagramPosts",
      label: "Пости в Instagram",
      quantity: input.instagramPosts,
      rate: rates.instagramPost
    },
    {
      key: "linkedinPosts",
      label: "Пости в LinkedIn",
      quantity: input.linkedinPosts,
      rate: rates.linkedinPost
    },
    {
      key: "linkedinVacancyPosts",
      label: "Пости з вакансією в LinkedIn",
      quantity: input.linkedinVacancyPosts,
      rate: rates.linkedinVacancyPost
    },
    {
      key: "instagramStorySeries",
      label: "Дні з серією сторіз в Instagram",
      quantity: input.instagramStorySeries,
      rate: rates.instagramStorySeries
    }
  ].map((item) => ({
    ...item,
    coins: Math.max(0, Math.floor(item.quantity || 0)) * item.rate
  }));

  return {
    totalCoins: items.reduce((total, item) => total + item.coins, 0),
    items,
    breakdown: items
      .filter((item) => item.quantity > 0)
      .map((item) => `${item.label}: ${item.quantity} (${item.coins} coins)`)
      .join("; ")
  };
}
