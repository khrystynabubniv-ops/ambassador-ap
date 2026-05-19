# Ambassador Program Automation

Polished version для студентської ambassador-програми:

- кастомна форма для monthly activity report;
- Notion як приватна база даних і адмін-панель;
- proof / screenshots як файли в Notion;
- Slack bot для нагадувань, admin-пушів і репортів;
- Railway service для 24/7 scheduler.

## Як працює

1. Амбасадор відкриває форму, обирає місяць і додає одну або кілька активностей.
2. Форма рахує subtotal у браузері, але фінальний розрахунок робить backend.
3. Кожна активність створюється окремим рядком у Notion `Activity Submissions`.
4. Backend оновлює `Monthly Summary` для людини й місяця.
5. Тобі приходить Slack notification про новий activity report.
6. 1-го числа сервіс надсилає reminder у `student-ambassador-program` з лінком на форму за попередній місяць.
7. 5-го числа сервіс надсилає monthly report.
8. У Slack App Home є кнопки: відкрити форму, показати report, надіслати reminder і запостити monthly report.

## Notion бази

`npm run setup:notion` створює:

- `Ambassador Program - Ambassadors`
- `Ambassador Program - Activity Catalog`
- `Ambassador Program - Activity Submissions`
- `Ambassador Program - Monthly Summary`
- `Ambassador Program - Automation Log`

Головна робоча таблиця для менеджера: `Ambassador Program - Monthly Summary`.
У ній є один рядок на людину й місяць: ім'я, Slack, місяць, кількість по кожному типу активності, activity breakdown, base coins, bonus і total coins.

Поле `Є активність` додається не в технічну `Monthly Summary` schema, а в tracker-таблицю `Ambassador Program Tracker 2026`: `https://www.notion.so/66083f8f35264eeca6229a341e21be82?v=364ce9899cb781f99d45000c1ca22b6b&source=copy_link`.
Для додаткового блоку/вʼю з активними учасниками створи linked view цієї tracker-таблиці, згрупуй або відфільтруй за `Місяць`, і додай filter `Є активність is checked`.

Інші таблиці технічні:

- `Activity Submissions` зберігає кожну окрему активність і proof-файли;
- `Activity Catalog` зберігає правила коінів, щоб не хардкодити їх у формі;
- `Ambassadors` зберігає людей;
- `Automation Log` не дає reminder/report дублюватися після рестарту Railway.

Їх можна сховати в Notion page і щодня працювати лише з `Monthly Summary`.

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
3. Manifest уже налаштований на Railway URLs:
   - `https://ambassador-ap-production.up.railway.app/slack/events` для App Home;
   - `https://ambassador-ap-production.up.railway.app/slack/interactions` для кнопок.
4. Install app to workspace.
5. Скопіюй:
   - `SLACK_BOT_TOKEN` з OAuth tokens;
   - `SLACK_SIGNING_SECRET` з Basic Information.
6. Додай бота в канал `student-ambassador-program`.
7. Скопіюй channel ID цього каналу в `SLACK_AMBASSADOR_CHANNEL_ID`.
8. Створи або вибери приватний admin channel для пушів і репортів, додай туди бота, скопіюй ID в:
   - `SLACK_ADMIN_CHANNEL_ID`
   - `SLACK_REPORT_CHANNEL_ID`
9. Після оновлення manifest перевстанови app у workspace, щоб Slack підтягнув App Home, Events і Interactivity.

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
NOTION_ACTIVITY_TRACKER_ID=66083f8f-3526-4eec-a622-9a341e21be82
NOTION_AUTOMATION_LOG_DATA_SOURCE_ID=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_AMBASSADOR_CHANNEL_ID=
SLACK_ADMIN_CHANNEL_ID=
SLACK_REPORT_CHANNEL_ID=
```

Optional:

```bash
PROGRAM_DETAILS_URL=https://www.notion.so/Ambassador-program-for-students-2cbce9899cb78073b0b7f3e9df2bf82b?source=copy_link
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

Якщо `Monthly Summary` вже існує, після деплою/перед наступними сабмітами запусти:

```bash
npm run update:notion-summary
```

Скрипт додасть `Є активність` у tracker-таблицю і backfill-ить існуючі рядки на основі coins/кількостей.

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
