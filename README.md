# Program Coins Automation

Polished version для студентської ambassador-програми + EGC у спільному Railway service і спільному Slack bot:

- кастомна форма для monthly activity report;
- Notion як приватна база даних і адмін-панель;
- proof / screenshots як файли в Notion;
- Slack bot для нагадувань, admin-пушів і репортів;
- Railway service для 24/7 scheduler.
- multi-program routing: `/ambassador` і `/egc`.

## Останні зміни в `main`

- Форма перероблена в одну робочу сторінку з бренд-кольорами Universe, live coins summary, динамічними рядками активностей і повідомленням про результат тільки після submit/error.
- Місяць у формі підставляється автоматично: з `?month=YYYY-MM` у лінку або як попередній місяць за `TIMEZONE`.
- Proof-файли обов'язкові тільки для активностей, де це позначено в правилах; для лекцій, гостьових лекцій і офіс-туру поле proof ховається.
- Slack name тепер можна вводити з пробілами, наприклад `Diana Bondarenko`; зайві пробіли й початковий `@` нормалізуються.
- Slack App Home відправляє report у Messages, показує notice після дії, має confirm перед ручним reminder і розділяє Ambassador/EGC блоки divider-ом.
- Monthly report показує тільки учасників з активністю, а tracker має поле `Є активність` для фільтрів/linked views.
- Додані `npm run test`, `npm run typecheck` і maintenance-скрипт `npm run rebuild:yearly-tracker`.
- Slack app перейменовано на `Program Coins`.

## Multi-program режим

Один Railway process піднімає дві програми:

- `https://ambassador-ap-production.up.railway.app/ambassador` - Ambassador form;
- `https://ambassador-ap-production.up.railway.app/egc` - EGC form;
- root `/` лишається сумісним зі старою Ambassador form.

У коді це два окремі program configs. Спільні: GitHub repo, Railway service, Slack bot token/signing secret. Окремі для кожної програми: Notion data source / channels / schedule і тексти форми/Slack.

Ambassador лишається activity-based програмою з власними Notion таблицями. EGC не створює нову аналітику: `/egc` є веб-версією поточної Notion форми й пише напряму в існуючу data source `EGC турнір`, щоб сторінка `EGC аналітика` продовжувала наповнюватися.

## Як працює

### Ambassador

1. Амбасадор відкриває форму, місяць уже підставлений із лінка або як попередній місяць.
2. Амбасадор додає одну або кілька активностей, кількість, коментар за потреби і proof-файли там, де вони потрібні.
3. Форма рахує попередній total у браузері, але фінальний розрахунок робить backend.
4. Кожна активність створюється окремим рядком у Notion `Activity Submissions`.
5. Backend оновлює `Monthly Summary` для людини й місяця, включно з activity columns, proofs, bonus і total coins.
6. Backend оновлює `Є активність` у tracker-таблиці для manager views.
7. Тобі приходить Slack notification про новий activity report.
8. 1-го числа сервіс надсилає reminder у `student-ambassador-program` з лінком на форму за попередній місяць.
9. 5-го числа сервіс надсилає monthly report тільки по учасниках, у яких є активність.
10. У Slack App Home є кнопки: відкрити форму, отримати report у Messages і надіслати reminder.

### EGC

1. Учасник відкриває `/egc`; форма повторює поля поточної Notion форми `EGC Reports`.
2. Числові поля пишуться в ті самі колонки `EGC турнір`: сторіз, сторіз з вакансією, рілз, Instagram posts, LinkedIn posts, LinkedIn vacancy posts.
3. Додане поле `К-ть серій сторіз в Instagram`: серія = 3+ сторіз за один день про одну тему/подію. Загальна к-ть сторіз все одно заповнюється окремо.
4. Скріншоти постів і рілз завантажуються в існуючу files-колонку `Додай скріншоти постів і рілз`.
5. Backend додає `Slack`, `Дні серій сторіз` і `Коіни до видачі`, щоб менеджер міг швидко видати коіни.
6. 3-го числа Slack report надсилає список усіх, хто заповнив EGC форму за попередній місяць, і скільки коінів видати.

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
- `Activity Catalog` зберігає seed-список правил активностей;
- `Ambassadors` зберігає людей;
- `Automation Log` не дає reminder/report дублюватися після рестарту Railway.

Їх можна сховати в Notion page і щодня працювати лише з `Monthly Summary`.

Activity Catalog сідається поточними правилами активностей:

| Активність | Coins | Proof |
| --- | ---: | --- |
| Поширення вакансії Universe у студентських чатах | 5 за 1 | так |
| Поширення анонсу івентів / стажувань в студентських чатах | 5 за 1 | так |
| Контакт викладача, який потенційно зацікавлений у співпраці | 10 за 1 | так |
| Самостійний виступ / лекція у своєму університеті | 50 | ні |
| Співорганізація гостьової лекції у твоєму університеті від колег з Universe | 20 | ні |
| Поширення вакансії через канал кар'єрного центру / факультету / студради | 10 за 1 | так |
| Написання поста для Telegram community / Uni Career Hub | 12 за 1 | так |
| Проведення екскурсії офісом Universe для своїх одногрупників | 15 | ні |

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

Для EGC не запускай `setup:notion`: замовник просив продовжувати існуючу аналітику. Дай Notion integration доступ до сторінки `EGC аналітика` / data source `EGC турнір` і вкажи:

```bash
EGC_NOTION_REPORTS_DATA_SOURCE_ID=2e8ce989-9cb7-809d-83df-000b244a691e
```

Якщо app бачить помилку Notion `object_not_found` для цього ID, це майже завжди означає, що ця сторінка/база не додана в `Connections` для integration, ключ якої стоїть у `NOTION_API_KEY` або `EGC_NOTION_API_KEY`.

Якщо треба додати службові колонки для веб-форми вручну, запусти:

```bash
npm run update:notion-summary -- --program egc
```

### 2. Slack app

1. Відкрий [Slack app manifests](https://api.slack.com/apps?new_app=1).
2. Створи app from manifest і встав `slack/manifest.yaml`.
3. Manifest уже налаштований на Railway URLs:
   - `https://ambassador-ap-production.up.railway.app/slack/events` для App Home;
   - `https://ambassador-ap-production.up.railway.app/slack/interactions` для кнопок.
4. Install app to workspace.
5. App називається `Program Coins`. Після зміни manifest перевстанови app, щоб Slack підтягнув нову назву.
6. Скопіюй:
   - `SLACK_BOT_TOKEN` з OAuth tokens;
   - `SLACK_SIGNING_SECRET` з Basic Information.
7. Додай бота в канал `student-ambassador-program`.
8. Скопіюй channel ID цього каналу в `SLACK_AMBASSADOR_CHANNEL_ID`.
9. Для EGC додай бота в потрібний EGC channel і скопіюй ID в `EGC_SLACK_COMMUNITY_CHANNEL_ID`.
10. Створи або вибери приватний admin channel для пушів і репортів, додай туди бота, скопіюй ID в:
   - `SLACK_ADMIN_CHANNEL_ID`
   - `SLACK_REPORT_CHANNEL_ID`
11. Для EGC можна використати ті самі admin/report channels або окремі:
   - `EGC_SLACK_ADMIN_CHANNEL_ID`
   - `EGC_SLACK_REPORT_CHANNEL_ID`
12. Після оновлення manifest перевстанови app у workspace, щоб Slack підтягнув App Home, Messages, Events і Interactivity.

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

Required for EGC production:

```bash
EGC_PROGRAM_DETAILS_URL=https://app.notion.com/p/UGC-aka-Universe-Generated-Content-176ce9899cb780d3ab12d4b76ba14334?source=copy_link
EGC_NOTION_REPORTS_DATA_SOURCE_ID=2e8ce989-9cb7-809d-83df-000b244a691e
EGC_NOTION_AUTOMATION_LOG_DATA_SOURCE_ID=
EGC_SLACK_COMMUNITY_CHANNEL_ID=
EGC_SLACK_ADMIN_CHANNEL_ID=
EGC_SLACK_REPORT_CHANNEL_ID=
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
EGC_REMINDER_DAY=1
EGC_REMINDER_HOUR=9
EGC_REPORT_DAY=3
EGC_REPORT_HOUR=9
EGC_COIN_RATES_JSON=
```

`BONUS_DISTINCT_BY=activity` означає 3 різні активності. Якщо треба рахувати 3 різні категорії, постав `category`.

Якщо `Monthly Summary` вже існує, після деплою/перед наступними сабмітами запусти:

```bash
npm run update:notion-summary
```

Скрипт додасть `Є активність` у tracker-таблицю і backfill-ить існуючі рядки на основі coins/кількостей.

Для EGC ця команда додає службові колонки в існуючу `EGC турнір`, а не створює нові таблиці:

```bash
npm run update:notion-summary -- --program egc
```

Якщо треба перебудувати чистий yearly tracker на 2026 рік:

```bash
npm run rebuild:yearly-tracker
```

Цей скрипт бере учасників із наявних Notion таблиць, архівує дочірні блоки на hub-сторінці, створює новий `Ambassador Program Tracker 2026`, переносить quantities і оновлює `.env` значенням `NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID`, якщо `.env` існує.

Для EGC не використовуй `rebuild:yearly-tracker`: EGC працює на існуючій сторінці `EGC аналітика`.

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

## Checks

```bash
npm run typecheck
npm run test
npm run build
```

## Report format

```text
Ambassador coins report - April 2026

@anna - 120 coins
@maksym - 95 coins
@ira - 80 coins
```

У Notion це також зберігається в `Monthly Summary` у полі `Report Line`.
