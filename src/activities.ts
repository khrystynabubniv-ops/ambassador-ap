import type { Activity } from "./types.js";

export const DEFAULT_ACTIVITIES: Activity[] = [
  {
    key: "vacancy_student_chats",
    title: "Поширення вакансії Universe у студентських чатах",
    category: "Поширення",
    coinsPerUnit: 5,
    requiresQuantity: true,
    requiresProof: true,
    active: true,
    order: 1
  },
  {
    key: "events_internships_student_chats",
    title: "Поширення анонсу івентів / стажувань в студентських чатах",
    category: "Поширення",
    coinsPerUnit: 5,
    requiresQuantity: true,
    requiresProof: true,
    active: true,
    order: 2
  },
  {
    key: "teacher_contact",
    title: "Контакт викладача, який потенційно зацікавлений у співпраці",
    category: "Партнерства",
    coinsPerUnit: 10,
    requiresQuantity: true,
    requiresProof: true,
    active: true,
    order: 3
  },
  {
    key: "own_university_lecture",
    title: "Самостійний виступ / лекція у своєму університеті",
    category: "Виступи",
    coinsPerUnit: 50,
    requiresQuantity: false,
    requiresProof: false,
    active: true,
    order: 4
  },
  {
    key: "guest_lecture_coorganization",
    title: "Співорганізація гостьової лекції у твоєму університеті від колег з Universe",
    category: "Виступи",
    coinsPerUnit: 20,
    requiresQuantity: false,
    requiresProof: false,
    active: true,
    order: 5
  },
  {
    key: "career_center_channel",
    title: "Поширення вакансії через канал кар'єрного центру / факультету / студради",
    category: "Поширення",
    coinsPerUnit: 10,
    requiresQuantity: true,
    requiresProof: true,
    active: true,
    order: 6
  },
  {
    key: "telegram_uni_career_hub_post",
    title: "Написання поста для Telegram community / Uni Career Hub",
    category: "Контент",
    coinsPerUnit: 12,
    requiresQuantity: true,
    requiresProof: true,
    active: true,
    order: 7
  },
  {
    key: "office_tour",
    title: "Проведення екскурсії офісом Universe для своїх одногрупників",
    category: "Екскурсії",
    coinsPerUnit: 15,
    requiresQuantity: false,
    requiresProof: false,
    active: true,
    order: 8
  }
];
