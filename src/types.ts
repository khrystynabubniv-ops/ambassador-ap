export type Activity = {
  key: string;
  title: string;
  category: string;
  coinsPerUnit: number;
  requiresQuantity: boolean;
  requiresProof: boolean;
  active: boolean;
  order?: number;
};

export type SubmissionActivityInput = {
  activityKey: string;
  quantity: number;
  notes?: string;
};

export type SubmissionInput = {
  ambassadorName: string;
  slackNickname: string;
  slackUserId?: string;
  month: string;
  activities: SubmissionActivityInput[];
};

export type SubmittedActivity = {
  activity: Activity;
  quantity: number;
  baseCoins: number;
  notes?: string;
};

export type MonthlySummary = {
  month: string;
  slackNickname: string;
  slackUserId?: string;
  baseCoins: number;
  distinctCompleted: number;
  bonusCoins: number;
  totalCoins: number;
  reportLine: string;
};

export type AutomationKind = "reminder" | "report";
