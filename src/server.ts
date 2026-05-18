import express from "express";
import helmet from "helmet";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { AmbassadorProgram } from "./ambassadorProgram.js";
import { loadConfig } from "./config.js";
import { previousMonth } from "./dates.js";
import { NotionService } from "./notionService.js";
import { SlackService } from "./slackService.js";
import { startScheduler } from "./scheduler.js";

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
  ambassadorName: z.string().trim().min(2),
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

const SlackCommandSchema = z.object({
  text: z.string().optional(),
  response_url: z.string().url(),
  command: z.string().optional()
});

const config = loadConfig();
const notion = new NotionService(config);
const slack = new SlackService(config);
const program = new AmbassadorProgram(config, notion, slack);
const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"]
      }
    }
  })
);
app.use(express.static(publicDir));
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = Buffer.from(buf);
    }
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    notionConfigured: notion.isConfigured(),
    slackConfigured: slack.isConfigured()
  });
});

app.get("/api/form-config", async (_req, res, next) => {
  try {
    res.json(await program.getFormConfig());
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions", upload.any(), async (req, res, next) => {
  try {
    const parsed = SubmitSchema.parse({
      ambassadorName: req.body.ambassadorName,
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

    const summary = await program.submit(parsed, filesByActivityIndex);
    res.json({ ok: true, summary });
  } catch (error) {
    next(error);
  }
});

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
    const requested = command.text?.trim();
    const month = !requested || requested === "last" ? previousMonth(config.timezone) : requested;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.send("Use `/ambassador-report last` or `/ambassador-report YYYY-MM`.");
      return;
    }

    res.send(`Generating ambassador report for ${month}...`);
    const report = await program.buildMonthlyReport(month);
    await slack.respondToSlackResponseUrl(command.response_url, report);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "Unexpected error";
  res.status(400).json({ ok: false, error: message });
});

app.listen(config.port, () => {
  console.log(`Ambassador app listening on ${config.port}`);
  if (notion.isConfigured()) {
    startScheduler(config, program);
  } else {
    console.warn("Notion is not configured. Scheduler is disabled until env vars are set.");
  }
});
