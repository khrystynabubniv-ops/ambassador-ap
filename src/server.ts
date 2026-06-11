import express from "express";
import helmet from "helmet";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { RewardsProgram } from "./ambassadorProgram.js";
import { loadConfig } from "./config.js";
import { monthDisplayName, previousMonth } from "./dates.js";
import { NotionService } from "./notionService.js";
import { parseActionValue, SlackService, slackHomeActions } from "./slackService.js";
import { startSchedulers } from "./scheduler.js";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const publicDir = path.join(process.cwd(), "public");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 50,
    fileSize: 20 * 1024 * 1024
  }
});

const SubmitSchema = z.object({
  participantName: z.string().trim().min(2),
  slackNickname: z.string().trim().min(2),
  slackUserId: z.string().trim().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  activities: z
    .array(
      z.object({
        activityKey: z.string().min(1),
        quantity: z.coerce.number().int().min(1).default(1),
        notes: z.string().trim().optional()
      })
    )
    .min(1)
    .max(20)
});

const EgcSubmitSchema = z.object({
  participantName: z.string().trim().min(2),
  slackNickname: z.string().trim().min(2),
  slackUserId: z.string().trim().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  instagramStories: z.coerce.number().int().min(0),
  instagramVacancyStories: z.coerce.number().int().min(0),
  instagramReels: z.coerce.number().int().min(0),
  instagramPosts: z.coerce.number().int().min(0),
  linkedinPosts: z.coerce.number().int().min(0),
  linkedinVacancyPosts: z.coerce.number().int().min(0),
  instagramStorySeries: z.coerce.number().int().min(0),
  storySeriesDays: z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }, z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]))
});

const SlackCommandSchema = z.object({
  text: z.string().optional(),
  response_url: z.string().url(),
  command: z.string().optional()
});

const SlackEventSchema = z.object({
  type: z.string(),
  challenge: z.string().optional(),
  event: z
    .object({
      type: z.string(),
      user: z.string().optional(),
      tab: z.string().optional()
    })
    .passthrough()
    .optional()
});

const SlackInteractionSchema = z.object({
  type: z.string(),
  user: z.object({
    id: z.string()
  }),
  actions: z
    .array(
      z
        .object({
          action_id: z.string(),
          value: z.string().optional()
        })
        .passthrough()
    )
    .optional()
});

const config = loadConfig();
const slack = new SlackService(config);
const programs = config.programs.map((programConfig) => {
  const notion = new NotionService(programConfig);
  return {
    config: programConfig,
    notion,
    program: new RewardsProgram(programConfig, notion, slack)
  };
});
const defaultProgram = programs[0];
const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"]
      }
    }
  })
);
app.use(express.static(publicDir));
app.get(["/ambassador", "/egc"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = Buffer.from(buf);
    }
  })
);
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = Buffer.from(buf);
    }
  })
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    slackConfigured: slack.isConfigured(),
    programs: programs.map((item) => ({
      key: item.config.key,
      slug: item.config.slug,
      notionConfigured: item.notion.isConfigured()
    }))
  });
});

app.get("/api/programs", (_req, res) => {
  res.json({
    programs: programs.map((item) => ({
      key: item.config.key,
      slug: item.config.slug,
      displayName: item.config.displayName,
      shortName: item.config.shortName,
      configured: item.notion.isConfigured()
    }))
  });
});

app.get("/api/form-config", async (_req, res, next) => {
  await sendFormConfig(defaultProgram.config.slug, res, next);
});

app.get("/api/programs/:program/form-config", async (req, res, next) => {
  await sendFormConfig(req.params.program, res, next);
});

async function sendFormConfig(programSlug: string, res: express.Response, next: express.NextFunction) {
  try {
    const runtime = findProgram(programSlug);
    if (!runtime) {
      res.status(404).json({ ok: false, error: "Unknown program." });
      return;
    }
    res.json(await runtime.program.getFormConfig());
  } catch (error) {
    next(error);
  }
}

app.post("/api/submissions", upload.any(), async (req, res, next) => {
  await receiveSubmission(defaultProgram.config.slug, req, res, next);
});

app.post("/api/programs/:program/submissions", upload.any(), async (req, res, next) => {
  await receiveSubmission(String(req.params.program), req, res, next);
});

async function receiveSubmission(
  programSlug: string,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const runtime = findProgram(programSlug);
    if (!runtime) {
      res.status(404).json({ ok: false, error: "Unknown program." });
      return;
    }

    if (runtime.config.mode === "egc-report") {
      const parsed = EgcSubmitSchema.parse({
        participantName: req.body.participantName ?? req.body.slackNickname,
        slackNickname: req.body.slackNickname,
        slackUserId: req.body.slackUserId,
        month: req.body.month,
        instagramStories: req.body.instagramStories,
        instagramVacancyStories: req.body.instagramVacancyStories,
        instagramReels: req.body.instagramReels,
        instagramPosts: req.body.instagramPosts,
        linkedinPosts: req.body.linkedinPosts,
        linkedinVacancyPosts: req.body.linkedinVacancyPosts,
        instagramStorySeries: req.body.instagramStorySeries,
        storySeriesDays: req.body.storySeriesDays
      });
      const proofFiles = ((req.files ?? []) as Express.Multer.File[]).filter((file) => file.fieldname === "egcProofs");
      const summary = await runtime.program.submitEgcReport(
        { ...parsed, instagramStorySeries: parsed.storySeriesDays.length },
        proofFiles
      );
      res.json({ ok: true, summary });
      return;
    }

    const parsed = SubmitSchema.parse({
      participantName: req.body.participantName ?? req.body.ambassadorName,
      slackNickname: req.body.slackNickname,
      slackUserId: req.body.slackUserId,
      month: req.body.month,
      activities: JSON.parse(req.body.activities ?? "[]")
    });

    const filesByActivityIndex = new Map<number, Express.Multer.File[]>();
    for (const file of (req.files ?? []) as Express.Multer.File[]) {
      const match = /^proof_(\d+)$/.exec(file.fieldname);
      if (!match) continue;
      const index = Number(match[1]);
      filesByActivityIndex.set(index, [...(filesByActivityIndex.get(index) ?? []), file]);
    }

    const summary = await runtime.program.submit(parsed, filesByActivityIndex);
    res.json({ ok: true, summary });
  } catch (error) {
    next(error);
  }
}

app.post("/slack/commands", async (req, res, next) => {
  try {
    const valid = slack.verifyRequest(
      req.rawBody,
      req.header("x-slack-request-timestamp"),
      req.header("x-slack-signature")
    );

    if (!valid) {
      res.status(401).send("Invalid Slack signature");
      return;
    }

    const command = SlackCommandSchema.parse(req.body);
    const parts = command.text?.trim().split(/\s+/).filter(Boolean) ?? [];
    const requestedProgram = parts[0] && findProgram(parts[0]) ? parts.shift()! : defaultProgram.config.slug;
    const runtime = findProgram(requestedProgram) ?? defaultProgram;
    const requestedMonth = parts[0];
    const month = !requestedMonth || requestedMonth === "last"
      ? previousMonth(runtime.config.timezone)
      : requestedMonth;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.send("Use `/program-report ambassador last`, `/program-report egc last`, or `/program-report egc YYYY-MM`.");
      return;
    }

    res.send(`Generating ${runtime.config.shortName} report for ${month}...`);
    const report = await runtime.program.buildMonthlyReport(month);
    await slack.respondToSlackResponseUrl(command.response_url, report);
  } catch (error) {
    next(error);
  }
});

app.post("/slack/events", async (req, res, next) => {
  try {
    const valid = slack.verifyRequest(
      req.rawBody,
      req.header("x-slack-request-timestamp"),
      req.header("x-slack-signature")
    );

    if (!valid) {
      res.status(401).send("Invalid Slack signature");
      return;
    }

    const payload = SlackEventSchema.parse(req.body);
    if (payload.type === "url_verification") {
      res.send(payload.challenge ?? "");
      return;
    }

    res.sendStatus(200);
    if (payload.type === "event_callback" && payload.event?.type === "app_home_opened" && payload.event.user) {
      void publishSlackHome(payload.event.user).catch((error) => {
        console.error("Failed to publish Slack App Home", error);
      });
    }
  } catch (error) {
    next(error);
  }
});

app.post("/slack/interactions", async (req, res, next) => {
  try {
    const valid = slack.verifyRequest(
      req.rawBody,
      req.header("x-slack-request-timestamp"),
      req.header("x-slack-signature")
    );

    if (!valid) {
      res.status(401).send("Invalid Slack signature");
      return;
    }

    const payload = SlackInteractionSchema.parse(JSON.parse(req.body.payload ?? "{}"));
    res.sendStatus(200);
    void handleSlackInteraction(payload).catch((error) => {
      console.error("Failed to handle Slack interaction", error);
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "Unexpected error";
  res.status(400).json({ ok: false, error: message });
});

async function handleSlackInteraction(payload: z.infer<typeof SlackInteractionSchema>): Promise<void> {
  const action = payload.actions?.[0];
  if (!action) return;

  const parsed = parseActionValue(action.value);
  const runtime = findProgram(parsed.programKey ?? defaultProgram.config.slug) ?? defaultProgram;
  const month = parsed.month && /^\d{4}-\d{2}$/.test(parsed.month)
    ? parsed.month
    : previousMonth(runtime.config.timezone);

  if (action.action_id === slackHomeActions.getReport) {
    if (!runtime.notion.isConfigured()) {
      await publishSlackHome(payload.user.id, {
        notice: `${runtime.config.shortName} ще не налаштована в Notion, тому звіт поки недоступний.`
      });
      return;
    }
    const report = await runtime.program.buildMonthlyReport(month);
    await slack.sendReportToUser(runtime.config, payload.user.id, month, report);
    await publishSlackHome(payload.user.id, {
      notice: `Готово, ${runtime.config.shortName} звіт за ${monthDisplayName(month)} вже чекає на тебе в Messages.`
    });
    return;
  }

  if (action.action_id === slackHomeActions.sendReminder) {
    if (!runtime.notion.isConfigured()) {
      await publishSlackHome(payload.user.id, {
        notice: `${runtime.config.shortName} ще не налаштована в Notion, тому reminder поки недоступний.`
      });
      return;
    }
    const sent = await runtime.program.sendReminderIfDue(month, `${runtime.config.key}:reminder:${month}`);
    await publishSlackHome(payload.user.id, {
      notice: sent
        ? `Готово, ${runtime.config.shortName} нагадування за ${monthDisplayName(month)} відправлено.`
        : `${runtime.config.shortName} нагадування за ${monthDisplayName(month)} не відправила: воно вже було надіслане або channel ще не налаштований.`
    });
    return;
  }

  if (action.action_id === slackHomeActions.openForm) {
    await publishSlackHome(payload.user.id);
  }
}

async function publishSlackHome(
  userId: string,
  options: { notice?: string } = {}
): Promise<void> {
  await slack.publishHome({
    userId,
    programs: programs.map((runtime) => {
      const month = previousMonth(runtime.config.timezone);
      return {
        program: runtime.config,
        month,
        formUrl: runtime.config.publicBaseUrl ? runtime.program.formUrlForMonth(month) : undefined,
        configured: runtime.notion.isConfigured()
      };
    }),
    notice: options.notice
  });
}

app.listen(config.port, () => {
  console.log(`Program coins app listening on ${config.port}`);
  const configuredPrograms = programs.filter((item) => item.notion.isConfigured()).map((item) => item.program);
  if (configuredPrograms.length) {
    startSchedulers(config, configuredPrograms);
  }
  for (const item of programs) {
    if (!item.notion.isConfigured()) {
      console.warn(`${item.config.displayName} Notion is not configured. Scheduler is disabled for this program.`);
    }
  }
});

function findProgram(slugOrKey: string) {
  return programs.find((item) => item.config.slug === slugOrKey || item.config.key === slugOrKey);
}
