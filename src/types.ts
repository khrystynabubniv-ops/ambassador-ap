export type Activity = {
  key: string;
  title: string;
  category: string;
  summaryProperty?: string;
  coinsPerUnit: number;
  requiresQuantity: boolean;
  requiresProof: boolean;
  active: boolean;
  order?: number;
};

export type ProgramKey = "ambassador" | "egc";
export type ProgramMode = "activity" | "egc-report";

export type BonusDistinctBy = "activity" | "category";

export type EgcCoinRates = {
  instagramStory: number;
  instagramVacancyStory: number;
  instagramReel: number;
  instagramPost: number;
  linkedinPost: number;
  linkedinVacancyPost: number;
  instagramStorySeries: number;
};

export type ProgramContent = {
  brandMark: string;
  formEyebrow: string;
  formTitle: string;
  deadlineNote: string;
  participantLabel: string;
  participantPlaceholder: string;
  participantHelp: string;
  summaryLabel: string;
  summaryNote: string;
  submitLabel: string;
  addActivityLabel: string;
};

export type ProgramSlackContent = {
  homeTitle: string;
  homeDescription: string;
  detailsLabel: string;
  reportTitle: string;
  notificationTitle: string;
  reminderGreeting: string;
  reminderIntro: string;
  reminderCta: string;
  reminderProofHint: string;
  reminderChannelLabel: string;
};

export type ProgramConfig = {
  key: ProgramKey;
  mode: ProgramMode;
  slug: string;
  displayName: string;
  shortName: string;
  notionDatabasePrefix: string;
  trackerTitle: string;
  createdVia: string;
  envPrefix?: string;
  publicBaseUrl?: string;
  notionApiKey?: string;
  notionParentPageId?: string;
  notionParticipantsDataSourceId?: string;
  notionActivityCatalogDataSourceId?: string;
  notionSubmissionsDataSourceId?: string;
  notionMonthlySummaryDataSourceId?: string;
  notionActivityTrackerId?: string;
  notionEgcReportsDataSourceId?: string;
  notionAutomationLogDataSourceId?: string;
  slackCommunityChannelId?: string;
  slackAdminChannelId?: string;
  slackReportChannelId?: string;
  slackReportMentionUserId?: string;
  programDetailsUrl: string;
  timezone: string;
  reminderDay: number;
  reminderHour: number;
  reportDay: number;
  reportHour: number;
  bonusThreshold: number;
  bonusCoins: number;
  bonusDistinctBy: BonusDistinctBy;
  activities: Activity[];
  egcCoinRates?: EgcCoinRates;
  content: ProgramContent;
  slackContent: ProgramSlackContent;
};

export type SubmissionActivityInput = {
  activityKey: string;
  quantity: number;
  notes?: string;
};

export type SubmissionInput = {
  participantName: string;
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

export type EgcReportInput = {
  participantName: string;
  slackNickname: string;
  slackUserId?: string;
  month: string;
  instagramStories: number;
  instagramVacancyStories: number;
  instagramReels: number;
  instagramPosts: number;
  linkedinPosts: number;
  linkedinVacancyPosts: number;
  instagramStorySeries: number;
  storySeriesDays: string[];
};

export type MonthlySummary = {
  participantName?: string;
  month: string;
  slackNickname: string;
  slackUserId?: string;
  hasActivity: boolean;
  baseCoins: number;
  distinctCompleted: number;
  bonusCoins: number;
  totalCoins: number;
  reportLine: string;
  activityQuantities: Record<string, number>;
  activityBreakdown: string;
};

export type AutomationKind = "reminder" | "report";
