# Ambassador Program Automation

Polished version для студентської ambassador-програми:

- кастомна форма для monthly checklist;
- Notion як приватна база даних і адмін-панель;
- proof / screenshots як файли в Notion;
- Slack bot для нагадувань, admin-пушів і репортів;
- Railway service для 24/7 scheduler.

## Як працює

1. Амбасадор відкриває форму, обирає місяць і додає одну або кілька активностей.
2. Форма рахує subtotal у браузері, але фінальний розрахунок робить backend.
3. Кожна активність створюється окремим рядком у Notion `Activity Submissions`.
4. Backend оновлює `Monthly Summary` для людини й місяця.
5. Тобі приходить Slack notification про новий checklist.
6. 1-го числа сервіс надсилає reminder у `student-ambassador-program`.
7. 5-го числа сервіс надсилає monthly report.
8. Slash command `/ambassador-report last` або `/ambassador-report 2026-04` генерує copy-ready report.

## Notion бази

`npm run setup:notion` створює:

- `Ambassador Program - Ambassadors`
- `Ambassador Program - Activity Catalog`
- `Ambassador Program - Activity Submissions`
- `Ambassador Program - Monthly Summary`
- `Ambassador Program - Automation Log`

Activity Catalog сідається активностями зі скріну:

| Активність | Coins |
| --- | ---: |
| Поширення вакансії Universe у студентських чатах | 5 за 1 |
| Поширення анонсу івентів / стажувань в студентських чатах | 5 за 1 |
| Контакт викладача | 10 за 1 |
| Самостійний виступ / лекція | 50 |
| Співорганізація гостьової лекції | 20 |
| Поширення через кар'єрний центр / факультет / студраду | 10 за 1 |
| Пост для Telegram community / Uni Career Hub | 12 за 1 |
| Екскурсія офісом Universe | 15 |

Бонус: `+10 coins`, якщо за місяць є 3+ різні активності. Це можна змінити через env vars.

## Що треба від тебе

### 1. Notion

1. Створи приватну сторінку в Notion, наприклад `Ambassador Program Automation`.
2. Створи Notion integration: [Notion integrations](https://www.notion.so/profile/integrations).
3. Скопіюй internal integration secret у `NOTION_API_KEY`.
4. На приватній сторінці натисни `...` -> `Connections` і додай цю integration.
5. Скопіюй page ID цієї сторінки у `NOTION_PARENT_PAGE_ID`.

Локально:

```bash
cp .env.example .env
npm install
npm run setup:notion
```

Скрипт надрукує `NOTION_*_DATA_SOURCE_ID`. Додай їх у `.env` і потім у Railway variables.

### 2. Slack app

1. Відкрий [Slack app manifests](https://api.slack.com/apps?new_app=1).
2. Створи app from manifest і встав `slack/manifest.yaml`.
3. Manifest уже налаштований на Railway URL: `https://ambassador-ap-production.up.railway.app/slack/commands`.
4. Install app to workspace.
5. Скопіюй:
   - `SLACK_BOT_TOKEN` з OAuth tokens;
   - `SLACK_SIGNING_SECRET` з Basic Information.
6. Додай бота в канал `student-ambassador-program`.
7. Скопіюй channel ID цього каналу в `SLACK_AMBASSADOR_CHANNEL_ID`.
8. Створи або вибери приватний admin channel для пушів і репортів, додай туди бота, скопіюй ID в:
   - `SLACK_ADMIN_CHANNEL_ID`
   - `SLACK_REPORT_CHANNEL_ID`

Для `SLACK_ADMIN_CHANNEL_ID` і `SLACK_REPORT_CHANNEL_ID` можна також використовувати Slack user ID формату `U...`; бот відкриє DM і надішле повідомлення напряму.

### 3. Railway

1. Створи Railway service з GitHub repo.
2. Додай env vars з `.env.example` і значення, які отримала з Notion/Slack.
3. Railway domain уже згенерований:

```text
https://ambassador-ap-production.up.railway.app
```

4. `PUBLIC_BASE_URL` уже встановлено на цей URL.
5. Після додавання secret env vars зроби redeploy service.

Scheduler працює тільки поки Railway service живий, тому цей сервіс має бути постійно запущений.

## Env vars

Required for production:

```bash
PUBLIC_BASE_URL=
NOTION_API_KEY=
NOTION_PARENT_PAGE_ID=
NOTION_AMBASSADORS_DATA_SOURCE_ID=
NOTION_ACTIVITY_CATALOG_DATA_SOURCE_ID=
NOTION_SUBMISSIONS_DATA_SOURCE_ID=
NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID=
NOTION_AUTOMATION_LOG_DATA_SOURCE_ID=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_AMBASSADOR_CHANNEL_ID=
SLACK_ADMIN_CHANNEL_ID=
SLACK_REPORT_CHANNEL_ID=
```

Optional:

```bash
TIMEZONE=Europe/Kyiv
REMINDER_DAY=1
REMINDER_HOUR=9
REPORT_DAY=5
REPORT_HOUR=9
BONUS_THRESHOLD=3
BONUS_COINS=10
BONUS_DISTINCT_BY=activity
```

`BONUS_DISTINCT_BY=activity` означає 3 різні активності. Якщо треба рахувати 3 різні категорії, постав `category`.

## Local run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Healthcheck:

```text
http://localhost:3000/health
```

## Report format

```text
Ambassador coins report - April 2026

@anna - 120 coins
@maksym - 95 coins
@ira - 80 coins
```

У Notion це також зберігається в `Monthly Summary` у полі `Report Line`.
