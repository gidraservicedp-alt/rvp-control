import { makeServiceWorkflow, authorizeServiceOffice } from "./service_workflow.ts";
import { resolveActFiles } from "./act_files.ts";
import { notifyPublished } from "./workflow_notifications.ts";
import { handleWebPortal } from './web_portal.ts';
import { CUSTOMER_ADMIN_MENU, makeCustomerCabinet } from "./customer_cabinet.ts";
import { makeCustomerTelegram } from "./customer_telegram.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, GET, OPTIONS",
};

// =====================================================
// НАСТРОЙКИ
// =====================================================

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SB_SECRET_KEY = Deno.env.get("SB_SECRET_KEY");
const ORDER_PARSER_SECRET = Deno.env.get("ORDER_PARSER_SECRET");
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET");
const PUSH_NOTIFY_ENDPOINT = `${SUPABASE_URL}/functions/v1/push-notify`;



const CUSTOMER_GROUP_CHAT_ID =
  -1004391653101;

const CUSTOMER_TOPIC_ID =
  124;

const GROUP_CHAT_ID = -1004408679793; // Тест Рабочая группа

const REGION_DEFINITIONS: Record<string, {
  name: string;
  lat: number;
  lon: number;
}> = {
  kyiv: {
    name: "Київ",
    lat: 50.4501,
    lon: 30.5234,
  },
  dnipro: {
    name: "Дніпро",
    lat: 48.4647,
    lon: 35.0462,
  },
};

const REGION_MAX_DISTANCE_KM = 180;

const ADMIN_IDS = [
  6597795844,
  592329920,
];

// =====================================================
// ENV
// =====================================================

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing");
}

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is missing");
}

if (!SB_SECRET_KEY) {
  throw new Error("SB_SECRET_KEY is missing");
}

// =====================================================
// SUPABASE
// =====================================================

const supabase = createClient(
  SUPABASE_URL,
  SB_SECRET_KEY,
);

// =====================================================
// TELEGRAM
// =====================================================

const TELEGRAM_API =
  `https://api.telegram.org/bot${BOT_TOKEN}`;

async function telegram(
  method: string,
  body: Record<string, unknown>,
) {
  try {
    const response = await fetch(
      `${TELEGRAM_API}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const result = await response.json();

    console.log(
      `Telegram ${method}:`,
      JSON.stringify(result),
    );

    return result;
  } catch (error) {
    console.error(
      `Telegram ${method} ERROR:`,
      error,
    );

    return {
      ok: false,
      error: String(error),
    };
  }
}

// =====================================================
// HTML ESCAPE
// =====================================================

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// =====================================================
// ADMIN
// =====================================================

const dynamicAdminIds = new Set<number>();

function isAdmin(
  telegramId: number,
): boolean {
  return (
    ADMIN_IDS.includes(
      telegramId,
    ) ||
    dynamicAdminIds.has(
      telegramId,
    )
  );
}

async function refreshDynamicAdmins() {
  const {
    data,
    error,
  } = await supabase
    .from("contractors")
    .select(
      "telegram_id,is_admin,status",
    )
    .eq(
      "is_admin",
      true,
    )
    .eq(
      "status",
      "active",
    )
    .not(
      "telegram_id",
      "is",
      null,
    );

  if (error) {
    console.error(
      "ADMIN REFRESH ERROR:",
      error,
    );
    return;
  }

  dynamicAdminIds.clear();

  for (
    const row of
      data || []
  ) {
    const telegramId =
      Number(
        row.telegram_id,
      );

    if (
      Number.isFinite(
        telegramId,
      )
    ) {
      dynamicAdminIds.add(
        telegramId,
      );
    }
  }
}


// =====================================================
// MESSAGE
// =====================================================

async function sendMessage(
  chatId: number,
  text: string,
  keyboard?: unknown,
) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };

  if (keyboard) {
    body.reply_markup = keyboard;
  }

  return telegram(
    "sendMessage",
    body,
  );
}


async function sendMessageToTopic(
  chatId: number,
  topicId: number,
  text: string,
  keyboard?: unknown,
) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_thread_id: topicId,
    text,
    parse_mode: "HTML",
  };

  if (keyboard) {
    body.reply_markup = keyboard;
  }

  return telegram(
    "sendMessage",
    body,
  );
}

async function deleteTelegramMessage(
  chatId: number,
  messageId: number,
) {
  if (
    !Number.isFinite(chatId) ||
    !Number.isFinite(messageId) ||
    !messageId
  ) {
    return;
  }

  const result =
    await telegram(
      "deleteMessage",
      {
        chat_id: chatId,
        message_id: messageId,
      },
    );

  if (!result?.ok) {
    console.warn(
      "DELETE MESSAGE FAILED:",
      chatId,
      messageId,
      result,
    );
  }
}

function scheduleTelegramCleanup(
  chatId: number,
  messageIds: Array<number | null | undefined>,
  delayMs = 10000,
) {
  const ids = [
    ...new Set(
      messageIds
        .map((id) => Number(id))
        .filter(
          (id) =>
            Number.isFinite(id) &&
            id > 0,
        ),
    ),
  ];

  if (!ids.length) {
    return;
  }

  const cleanupTask = (async () => {
    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          delayMs,
        ),
    );

    await Promise.all(
      ids.map(
        (messageId) =>
          deleteTelegramMessage(
            chatId,
            messageId,
          ),
      ),
    );
  })();

  const edgeRuntime =
    (globalThis as any)
      .EdgeRuntime;

  if (
    edgeRuntime?.waitUntil
  ) {
    edgeRuntime.waitUntil(
      cleanupTask,
    );
  } else {
    cleanupTask.catch(
      (error) =>
        console.error(
          "CLEANUP ERROR:",
          error,
        ),
    );
  }
}

// =====================================================
// MENUS
// =====================================================

function mainMenu(telegramId?: number) {
  const keyboard: any[] = [
    [{ text: "📋 Мої заявки" }],
    [{ text: "🌐 Відкрити вебкабінет" }],
    [{ text: "📄 Історія робіт" }, { text: "🛟 Підтримка" }],
  ];

  if (telegramId && isAdmin(telegramId)) {
    keyboard.push([{ text: "👑 Адмін панель" }]);
  }

  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Оберіть заявку — решту зробить бот…",
  };
}

function adminMenu() {
  return {
    keyboard: [
      [
        { text: "➕ Створити заявку" },
        { text: "🔎 Пошук заявки" },
      ],
      [
        { text: "📋 Заявки" },
        { text: "📑 Акти" },
      ],
      [
        { text: "👥 Підрядники" },
        { text: CUSTOMER_ADMIN_MENU },
      ],
      [
        { text: "📊 Статистика" },
        { text: "📤 Експорт CSV" },
      ],
      [
        { text: "📚 Історія робіт" },
      ],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Адмін-панель • оберіть розділ…",
  };
}

function contractorAdminMenu() {
  return {
    ...adminMenu(),
    keyboard: [
      [{ text: "⏳ Нові підрядники" }, { text: "📋 Список підрядників" }],
      [{ text: "🔎 Пошук підрядника" }, { text: "🗑 Видалені підрядники" }],
      [{ text: "🌍 Регіони" }, { text: "🗺 Регіон підрядника" }],
      [{ text: "💰 Виплати" }, { text: "📢 Розсилка" }],
      [{ text: "👷 Панель підрядника" }],
      [{ text: "👑 Адмін панель" }],
    ],
    input_field_placeholder: "Підрядники • оберіть дію…",
  };
}

function cancelMenu() {
  return {
    keyboard: [
      [
        { text: "❌ Скасувати" },
      ],
    ],
    resize_keyboard: true,
    input_field_placeholder: "Введіть дані або скасуйте…",
  };
}

function actUploadMenu() {
  return {
    keyboard: [
      [
        { text: "✅ Завершити завантаження" },
      ],
      [
        { text: "❌ Скасувати" },
      ],
    ],
    resize_keyboard: true,
    input_field_placeholder: "Надішліть фото/PDF або завершіть…",
  };
}


function departureLocationMenu() {
  return {
    keyboard: [
      [
        {
          text: "📍 Надіслати геолокацію",
          request_location: true,
        },
      ],
      [
        {
          text: "⏭ Пропустити",
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder:
      "Надішліть геолокацію або пропустіть…",
  };
}

const CUSTOMER_CABINET = "Кабінет менеджера АЗК";
const CONTRACTOR_CABINET = "Кабінет виконавця";
const CHOOSE_CABINET = "Оберіть кабінет";

function cabinetMenu() {
  return {
    keyboard: [
      [{ text: CUSTOMER_CABINET }],
      [{ text: CONTRACTOR_CABINET }],
    ],
    resize_keyboard: true,
  };
}

async function showCabinetChoice(chatId: number, telegramId: number) {
  if (await setSession(telegramId, "choosing_cabinet")) {
    await sendMessage(chatId, CHOOSE_CABINET, cabinetMenu());
  } else {
    await sendMessage(chatId, "Не вдалося відкрити вибір кабінету. Спробуйте ще раз через /start.");
  }
}

function contactRequestMenu() {
  return {
    keyboard: [
      [
        {
          text: "📱 Надіслати номер телефону",
          request_contact: true,
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Натисніть кнопку нижче 👇",
  };
}


function regionSelectionMenu() {
  return {
    inline_keyboard: [
      [
        {
          text: "🏙 Київ",
          callback_data: "registerregion:kyiv",
        },
        {
          text: "🏙 Дніпро",
          callback_data: "registerregion:dnipro",
        },
      ],
    ],
  };
}

function locationRequestMenu() {
  return {
    keyboard: [
      [
        {
          text: "📍 Надіслати геолокацію",
          request_location: true,
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Надішліть свою геолокацію 👇",
  };
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusKm * 2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a),
    );
}

function detectRegionFromLocation(
  latitude: number,
  longitude: number,
) {
  let best:
    | {
        code: string;
        name: string;
        distance: number;
      }
    | null = null;

  for (
    const [code, region] of
      Object.entries(REGION_DEFINITIONS)
  ) {
    const distance =
      distanceKm(
        latitude,
        longitude,
        region.lat,
        region.lon,
      );

    if (
      !best ||
      distance < best.distance
    ) {
      best = {
        code,
        name: region.name,
        distance,
      };
    }
  }

  if (
    !best ||
    best.distance >
      REGION_MAX_DISTANCE_KM
  ) {
    return null;
  }

  return best;
}

function normalizeRegionCode(
  raw: string,
): string | null {
  const value =
    raw
      .trim()
      .toLowerCase();

  if (
    [
      "kyiv",
      "kiev",
      "київ",
      "киев",
    ].includes(value)
  ) {
    return "kyiv";
  }

  if (
    [
      "dnipro",
      "dnepr",
      "дніпро",
      "днепр",
    ].includes(value)
  ) {
    return "dnipro";
  }

  return null;
}

async function getRegionTopic(
  regionCode: string | null | undefined,
) {
  if (!regionCode) {
    return null;
  }

  const { data, error } =
    await supabase
      .from("region_topics")
      .select("*")
      .eq("code", regionCode)
      .maybeSingle();

  if (error) {
    console.error(
      "getRegionTopic:",
      error,
    );

    return null;
  }

  return data;
}


async function startContractorRegionAssignment(
  chatId: number,
  adminId: number,
) {
  await setSession(
    adminId,
    "admin_region_contractor_search",
  );

  await sendMessage(
    chatId,
    "🗺 <b>Регіон підрядника</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      "Знайдіть підрядника за:\n" +
      "📱 номером або останніми цифрами\n" +
      "👤 ім'ям / прізвищем\n" +
      "🔹 @username\n\n" +
      "Наприклад: <code>5140</code>, <code>Анатолий</code> або <code>@username</code>",
    cancelMenu(),
  );
}

async function searchContractorForRegion(
  chatId: number,
  rawQuery: string,
) {
  const query =
    String(
      rawQuery ||
        "",
    ).trim();

  if (!query) {
    await sendMessage(
      chatId,
      "❗ Введіть номер, ім'я або @username.",
      cancelMenu(),
    );
    return;
  }

  const queryLower =
    query
      .replace(/^@/, "")
      .toLowerCase();

  const queryDigits =
    query.replace(
      /\D/g,
      "",
    );

  const {
    data,
    error,
  } = await supabase
    .from("contractors")
    .select(`
      id,
      first_name,
      last_name,
      username,
      phone,
      status,
      region_code,
      region_name
    `)
    .in(
      "status",
      [
        "active",
        "pending"
      ],
    )
    .order(
      "created_at",
      {
        ascending: false,
      },
    )
    .limit(500);

  if (error) {
    await sendMessage(
      chatId,
      "❌ Не вдалося знайти підрядника.\n\n" +
        `<code>${escapeHtml(
          error.message,
        )}</code>`,
      adminMenu(),
    );
    return;
  }

  const matches =
    (data || [])
      .filter(
        (c: any) => {
          const phoneDigits =
            String(
              c.phone ||
                "",
            ).replace(
              /\D/g,
              "",
            );

          const first =
            String(
              c.first_name ||
                "",
            ).toLowerCase();

          const last =
            String(
              c.last_name ||
                "",
            ).toLowerCase();

          const fullName =
            `${first} ${last}`.trim();

          const username =
            String(
              c.username ||
                "",
            )
              .replace(/^@/, "")
              .toLowerCase();

          return (
            (
              queryDigits.length >
                0 &&
              phoneDigits.includes(
                queryDigits,
              )
            ) ||
            first.includes(
              queryLower,
            ) ||
            last.includes(
              queryLower,
            ) ||
            fullName.includes(
              queryLower,
            ) ||
            username.includes(
              queryLower,
            )
          );
        },
      )
      .slice(
        0,
        30,
      );

  if (
    matches.length ===
    0
  ) {
    await sendMessage(
      chatId,
      "🔎 <b>Підрядника не знайдено</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `Запит: <code>${escapeHtml(
          query,
        )}</code>\n\n` +
        "Спробуйте іншу частину номера, ім'я або username.",
      cancelMenu(),
    );
    return;
  }

  const buttons: any[][] =
    [];

  for (const c of matches) {
    const name =
      `${c.first_name || ""} ${c.last_name || ""}`.trim() ||
      "Без імені";

    const regionText =
      c.region_name ||
      "без регіону";

    let label =
      `👤 ${name} • ${c.phone || "без номера"} • ${regionText}`;

    if (
      label.length >
      62
    ) {
      label =
        label.slice(
          0,
          59,
        ) + "...";
    }

    buttons.push([
      {
        text:
          label,
        callback_data:
          `regioncontractor:${c.id}`,
      },
    ]);
  }

  await sendMessage(
    chatId,
    "🗺 <b>Оберіть підрядника</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `Знайдено: <b>${matches.length}</b>\n\n` +
      "Після вибору вкажіть потрібний регіон.",
    {
      inline_keyboard:
        buttons,
    },
  );
}

async function showContractorRegionPicker(
  chatId: number,
  contractorId: string,
) {
  const {
    data: contractor,
    error,
  } = await supabase
    .from("contractors")
    .select(`
      id,
      telegram_id,
      first_name,
      last_name,
      username,
      phone,
      status,
      region_code,
      region_name
    `)
    .eq(
      "id",
      contractorId,
    )
    .maybeSingle();

  if (
    error ||
    !contractor
  ) {
    await sendMessage(
      chatId,
      "❌ Підрядника не знайдено.",
      adminMenu(),
    );
    return;
  }

  const name =
    `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
    "Без імені";

  await sendMessage(
    chatId,
    "🗺 <b>Призначити регіон</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `👤 <b>${escapeHtml(
        name,
      )}</b>\n` +
      `📱 ${escapeHtml(
        contractor.phone ||
          "Номер не вказано",
      )}\n` +
      `📊 ${escapeHtml(
        contractor.status ||
          "—",
      )}\n` +
      `🌍 Поточний регіон: <b>${escapeHtml(
        contractor.region_name ||
          "Не призначено",
      )}</b>\n\n` +
      "Оберіть новий регіон:",
    {
      inline_keyboard: [
        [
          {
            text:
              "🏙 Київ",
            callback_data:
              `adminassignregion:${contractor.id}:kyiv`,
          },
          {
            text:
              "🏙 Дніпро",
            callback_data:
              `adminassignregion:${contractor.id}:dnipro`,
          },
        ],
        [
          {
            text:
              "🔎 Інший підрядник",
            callback_data:
              "adminregionsearchagain",
          },
        ],
      ],
    },
  );
}

async function showRegions(
  chatId: number,
) {
  const { data, error } =
    await supabase
      .from("region_topics")
      .select(
        "code,name,message_thread_id",
      )
      .order("name", {
        ascending: true,
      });

  if (error) {
    await sendMessage(
      chatId,
      "❌ Не вдалося отримати налаштування регіонів.\\n\\n" +
        `<code>${escapeHtml(
          error.message,
        )}</code>`,
      contractorAdminMenu(),
    );
    return;
  }

  const topicMap =
    new Map(
      (data || []).map(
        (row: any) => [
          row.code,
          row,
        ],
      ),
    );

  let body =
    "🌍 <b>Регіони та теми</b>\\n" +
    "━━━━━━━━━━━━━━━━\\n\\n";

  for (
    const [code, region] of
      Object.entries(
        REGION_DEFINITIONS,
      )
  ) {
    const topic =
      topicMap.get(code);

    body +=
      `${topic ? "✅" : "⚪️"} <b>${escapeHtml(
        region.name,
      )}</b>`;

    if (topic) {
      body +=
        ` — тема ID <code>${escapeHtml(
          topic.message_thread_id,
        )}</code>`;
    }

    body += "\\n";
  }

  body +=
    "\\n<b>Як прив'язати тему:</b>\\n" +
    "1. Відкрийте потрібну тему в робочій групі.\\n" +
    "2. Для Києва надішліть <code>/bindregion kyiv</code>\\n" +
    "3. Для Дніпра надішліть <code>/bindregion dnipro</code>\\n\\n" +
    "Бот сам збереже ID теми.";

  await sendMessage(
    chatId,
    body,
    contractorAdminMenu(),
  );
}

async function handleRegionBinding(
  message: any,
) {
  const userId =
    message?.from?.id;

  const text =
    typeof message?.text ===
      "string"
      ? message.text.trim()
      : "";

  if (
    !userId ||
    !isAdmin(userId) ||
    message?.chat?.id !==
      GROUP_CHAT_ID ||
    !text.startsWith(
      "/bindregion",
    )
  ) {
    return false;
  }

  const rawRegion =
    text
      .split(/\s+/)
      .slice(1)
      .join(" ");

  const regionCode =
    normalizeRegionCode(
      rawRegion,
    );

  const threadId =
    message?.message_thread_id;

  if (!regionCode) {
    await telegram(
      "sendMessage",
      {
        chat_id:
          GROUP_CHAT_ID,
        ...(threadId
          ? {
              message_thread_id:
                threadId,
            }
          : {}),
        text:
          "❌ Невідомий регіон.\\n\\n" +
          "Використовуйте:\\n" +
          "/bindregion kyiv\\n" +
          "/bindregion dnipro",
      },
    );

    return true;
  }

  if (!threadId) {
    await telegram(
      "sendMessage",
      {
        chat_id:
          GROUP_CHAT_ID,
        text:
          "❌ Команду потрібно надіслати саме всередині теми Telegram.",
      },
    );

    return true;
  }

  const region =
    REGION_DEFINITIONS[
      regionCode
    ];

  const {
    error,
  } = await supabase
    .from("region_topics")
    .upsert(
      {
        code:
          regionCode,
        name:
          region.name,
        chat_id:
          GROUP_CHAT_ID,
        message_thread_id:
          threadId,
        updated_by:
          userId,
        updated_at:
          new Date()
            .toISOString(),
      },
      {
        onConflict:
          "code",
      },
    );

  if (error) {
    await telegram(
      "sendMessage",
      {
        chat_id:
          GROUP_CHAT_ID,
        message_thread_id:
          threadId,
        text:
          "❌ Не вдалося прив'язати тему.\\n\\n" +
          error.message,
      },
    );

    return true;
  }

  await telegram(
    "sendMessage",
    {
      chat_id:
        GROUP_CHAT_ID,
      message_thread_id:
        threadId,
      parse_mode:
        "HTML",
      text:
        `✅ <b>${escapeHtml(
          region.name,
        )}</b> прив'язано до цієї теми.\\n\\n` +
        `🧵 Thread ID: <code>${escapeHtml(
          threadId,
        )}</code>`,
    },
  );

  return true;
}

// =====================================================
// CONTRACTOR
// =====================================================

async function getContractor(
  telegramId: number,
) {
  const {
    data,
    error,
  } = await supabase
    .from("contractors")
    .select("*")
    .eq(
      "telegram_id",
      telegramId,
    )
    .maybeSingle();

  if (error) {
    console.error(
      "getContractor:",
      error,
    );

    return null;
  }

  return data;
}

async function registerContractor(
  user: any,
  status: "pending" | "active" = "pending",
  phone: string | null = null,
) {
  const existing =
    await getContractor(
      user.id,
    );

  if (existing) {
    return existing;
  }

  const {
    data,
    error,
  } = await supabase
    .from("contractors")
    .insert({
      telegram_id: user.id,
      first_name:
        user.first_name ?? null,
      last_name:
        user.last_name ?? null,
      username:
        user.username ?? null,
      phone,
      status,
    })
    .select()
    .single();

  if (error) {
    console.error(
      "registerContractor:",
      error,
    );

    return null;
  }

  return data;
}

// =====================================================
// CONTRACTOR APPROVAL
// =====================================================

async function notifyAdminsAboutContractor(
  contractor: any,
) {
  const name =
    `${contractor.first_name || ""} ${
      contractor.last_name || ""
    }`.trim() || "Без імені";

  let text =
    "🆕 <b>Новий підрядник</b>\n━━━━━━━━━━━━━━━━\n\n" +
    `👤 Ім'я: <b>${escapeHtml(name)}</b>\n` +
    `📱 Телефон: <b>${escapeHtml(
      contractor.phone || "Не вказано",
    )}</b>\n`;

  if (contractor.username) {
    text += `🔹 Username: @${escapeHtml(
      contractor.username,
    )}\n`;
  }

  if (contractor.region_name) {
    text +=
      `🌍 Регіон: <b>${escapeHtml(
        contractor.region_name,
      )}</b>\n`;
  }

  text +=
    "\n⏳ Статус: <b>Очікує підтвердження</b>";

  for (const adminId of ADMIN_IDS) {
    await sendMessage(
      adminId,
      text,
      {
        inline_keyboard: [
          [
            {
              text: "✅ Підтвердити",
              callback_data:
                `approvecontractor:${contractor.id}`,
            },
            {
              text: "❌ Відхилити",
              callback_data:
                `rejectcontractor:${contractor.id}`,
            },
          ],
        ],
      },
    );
  }
}

async function approveContractor(
  chatId: number,
  contractorId: string,
) {
  const {
    data: existing,
    error: findError,
  } = await supabase
    .from("contractors")
    .select("*")
    .eq(
      "id",
      contractorId,
    )
    .maybeSingle();

  if (
    findError ||
    !existing
  ) {
    await sendMessage(
      chatId,
      "❌ Підрядника не знайдено.",
      adminMenu(),
    );
    return;
  }

  // ВАЖЛИВО:
  // Підрядник не активується без регіону,
  // бо саме region_code визначає тему для його актів.
  if (
    !existing.region_code
  ) {
    const name =
      `${existing.first_name || ""} ${existing.last_name || ""}`.trim() ||
      "Без імені";

    await sendMessage(
      chatId,
      "🌍 <b>Оберіть регіон підрядника</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `👤 <b>${escapeHtml(
          name,
        )}</b>\n` +
        `📱 ${escapeHtml(
          existing.phone ||
            "Номер не вказано",
        )}\n\n` +
        "Регіон потрібен для автоматичного направлення актів у правильну тему.",
      {
        inline_keyboard: [
          [
            {
              text:
                "✅ Київ",
              callback_data:
                `approvewithregion:${existing.id}:kyiv`,
            },
            {
              text:
                "✅ Дніпро",
              callback_data:
                `approvewithregion:${existing.id}:dnipro`,
            },
          ],
          [
            {
              text:
                "❌ Відхилити",
              callback_data:
                `rejectcontractor:${existing.id}`,
            },
          ],
        ],
      },
    );

    return;
  }

  const regionCode =
    normalizeRegionCode(
      existing.region_code,
    ) ||
    existing.region_code;

  const region =
    REGION_DEFINITIONS[
      regionCode
    ];

  const {
    data: contractor,
    error,
  } = await supabase
    .from("contractors")
    .update({
      status:
        "active",
      ...(region
        ? {
            region_code:
              regionCode,
            region_name:
              region.name,
          }
        : {}),
    })
    .eq(
      "id",
      contractorId,
    )
    .select("*")
    .maybeSingle();

  if (
    error ||
    !contractor
  ) {
    console.error(
      "approveContractor:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося підтвердити підрядника." +
        (error?.message
          ? `\n\n<code>${escapeHtml(
              error.message,
            )}</code>`
          : ""),
      adminMenu(),
    );

    return;
  }

  const name =
    `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
    "Без імені";

  await sendMessage(
    chatId,
    "✅ <b>Підрядника підтверджено</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `👤 ${escapeHtml(
        name,
      )}\n` +
      `🌍 ${escapeHtml(
        contractor.region_name ||
          contractor.region_code ||
          "Не вказано",
      )}`,
    adminMenu(),
  );

  if (
    contractor.telegram_id
  ) {
    await sendMessage(
      contractor.telegram_id,
      "✅ <b>Доступ підтверджено</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `🌍 Робочий регіон: <b>${escapeHtml(
          contractor.region_name ||
            contractor.region_code ||
            "Не вказано",
        )}</b>\n\n` +
        "Тепер ви можете користуватися панеллю підрядника.",
      mainMenu(
        contractor.telegram_id,
      ),
    );
  }
}

async function rejectContractor(
  chatId: number,
  contractorId: string,
) {
  const { data: contractor, error } =
    await supabase
      .from("contractors")
      .update({ status: "rejected" })
      .eq("id", contractorId)
      .select("*")
      .maybeSingle();

  if (error || !contractor) {
    await sendMessage(
      chatId,
      "❌ Не вдалося відхилити підрядника.",
      adminMenu(),
    );
    return;
  }

  const name =
    `${contractor.first_name || ""} ${
      contractor.last_name || ""
    }`.trim() || "Без імені";

  await sendMessage(
    chatId,
    "❌ <b>Підрядника відхилено</b>\n━━━━━━━━━━━━━━━━\n\n" +
      `👤 ${escapeHtml(name)}`,
    adminMenu(),
  );

  if (contractor.telegram_id) {
    await sendMessage(
      contractor.telegram_id,
      "❌ <b>Доступ не підтверджено</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Адміністратор відхилив заявку на доступ.",
    );
  }
}

// =====================================================
// DELETE CONTRACTOR
// =====================================================

async function askDeleteContractor(
  chatId: number,
  contractorId: string,
) {
  const { data: contractor, error } =
    await supabase
      .from("contractors")
      .select(`
        id,
        telegram_id,
        first_name,
        last_name,
        username,
        status
      `)
      .eq("id", contractorId)
      .maybeSingle();

  if (error || !contractor) {
    await sendMessage(
      chatId,
      "❌ Підрядника не знайдено.",
      adminMenu(),
    );
    return;
  }

  const name =
    `${contractor.first_name || ""} ${
      contractor.last_name || ""
    }`.trim() || "Без імені";

  await sendMessage(
    chatId,
    "⚠️ <b>Видалити підрядника?</b>\n━━━━━━━━━━━━━━━━\n\n" +
      `👤 <b>${escapeHtml(name)}</b>\n` +
      `🆔 <code>${escapeHtml(contractor.telegram_id)}</code>\n\n` +
      "Після видалення доступ до бота буде закрито.\n" +
      "📚 Заявки, акти та історія робіт залишаться збереженими.",
    {
      inline_keyboard: [
        [
          {
            text: "🗑 Так, видалити",
            callback_data:
              `confirmdeletecontractor:${contractor.id}`,
          },
        ],
        [
          {
            text: "↩️ Скасувати",
            callback_data: "canceldeletecontractor",
          },
        ],
      ],
    },
  );
}

async function deleteContractor(
  chatId: number,
  contractorId: string,
) {
  // М'яке видалення: запис зберігається для старих заявок,
  // актів та історії, але доступ до бота закривається.
  const { data: contractor, error } =
    await supabase
      .from("contractors")
      .update({ status: "deleted" })
      .eq("id", contractorId)
      .select(`
        id,
        telegram_id,
        first_name,
        last_name
      `)
      .maybeSingle();

  if (error || !contractor) {
    console.error("deleteContractor:", error);

    const details = error?.message
      ? `\n\n<code>${escapeHtml(error.message)}</code>`
      : "";

    await sendMessage(
      chatId,
      "❌ Не вдалося видалити підрядника." + details,
      adminMenu(),
    );
    return;
  }

  // Прибираємо незавершену сесію користувача.
  if (contractor.telegram_id) {
    await clearSession(contractor.telegram_id);
  }

  const name =
    `${contractor.first_name || ""} ${
      contractor.last_name || ""
    }`.trim() || "Без імені";

  await sendMessage(
    chatId,
    "🗑 <b>Підрядника видалено</b>\n━━━━━━━━━━━━━━━━\n\n" +
      `👤 ${escapeHtml(name)}\n\n` +
      "Доступ до бота закрито. Історію робіт збережено.",
    adminMenu(),
  );

  if (contractor.telegram_id) {
    await sendMessage(
      contractor.telegram_id,
      "⛔ <b>Доступ до бота закрито</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Ваш обліковий запис підрядника було видалено адміністратором.",
    );
  }
}

// =====================================================
// RESTORE CONTRACTOR
// =====================================================

async function showDeletedContractors(
  chatId: number,
) {
  const { data, error } = await supabase
    .from("contractors")
    .select(`
      id,
      telegram_id,
      first_name,
      last_name,
      username,
      phone,
      region_code,
      region_name,
      status
    `)
    .eq("status", "deleted")
    .order("created_at", {
      ascending: false,
    })
    .limit(100);

  if (error) {
    console.error("showDeletedContractors:", error);

    await sendMessage(
      chatId,
      "❌ Не вдалося отримати видалених підрядників.\n\n" +
        `<code>${escapeHtml(error.message)}</code>`,
      adminMenu(),
    );
    return;
  }

  if (!data || data.length === 0) {
    await sendMessage(
      chatId,
      "🗑 <b>Видалені підрядники</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Список порожній.",
      adminMenu(),
    );
    return;
  }

  await sendMessage(
    chatId,
    `🗑 <b>ВИДАЛЕНІ ПІДРЯДНИКИ: ${data.length}</b>\n\n` +
      "Натисніть «♻️ Відновити», щоб повернути доступ:",
  );

  for (const contractor of data) {
    const name =
      `${contractor.first_name || ""} ${
        contractor.last_name || ""
      }`.trim() || "Без імені";

    let text =
      `🗑 <b>${escapeHtml(name)}</b>\n` +
      `🆔 <code>${escapeHtml(contractor.telegram_id)}</code>`;

    if (contractor.username) {
      text += `\n🔹 @${escapeHtml(contractor.username)}`;
    }

    await sendMessage(
      chatId,
      text,
      {
        inline_keyboard: [
          [
            {
              text: "♻️ Відновити",
              callback_data:
                `restorecontractor:${contractor.id}`,
            },
          ],
        ],
      },
    );
  }

  await sendMessage(
    chatId,
    "Оберіть підрядника для відновлення.",
    adminMenu(),
  );
}

async function restoreContractor(
  chatId: number,
  contractorId: string,
) {
  const { data: contractor, error } =
    await supabase
      .from("contractors")
      .update({ status: "active" })
      .eq("id", contractorId)
      .eq("status", "deleted")
      .select(`
        id,
        telegram_id,
        first_name,
        last_name,
        username,
        status
      `)
      .maybeSingle();

  if (error || !contractor) {
    console.error("restoreContractor:", error);

    const details = error?.message
      ? `\n\n<code>${escapeHtml(error.message)}</code>`
      : "\n\nМожливо, підрядник уже відновлений.";

    await sendMessage(
      chatId,
      "❌ Не вдалося відновити підрядника." + details,
      adminMenu(),
    );
    return;
  }

  const name =
    `${contractor.first_name || ""} ${
      contractor.last_name || ""
    }`.trim() || "Без імені";

  await sendMessage(
    chatId,
    "♻️ <b>Підрядника відновлено</b>\n━━━━━━━━━━━━━━━━\n\n" +
      `👤 ${escapeHtml(name)}\n` +
      `🆔 <code>${escapeHtml(contractor.telegram_id)}</code>\n\n` +
      "✅ Доступ до бота знову відкрито.",
    adminMenu(),
  );

  if (contractor.telegram_id) {
    await clearSession(contractor.telegram_id);

    await sendMessage(
      contractor.telegram_id,
      "♻️ <b>Доступ відновлено</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Адміністратор знову відкрив вам доступ до бота.\n\n" +
        "Натисніть /start, щоб відкрити меню.",
    );
  }
}

// =====================================================
// SESSIONS
// =====================================================

async function getSession(
  telegramId: number,
) {
  const {
    data,
    error,
  } = await supabase
    .from("bot_sessions")
    .select("*")
    .eq(
      "telegram_id",
      telegramId,
    )
    .maybeSingle();

  if (error) {
    console.error(
      "getSession:",
      error,
    );

    return null;
  }

  return data;
}

async function setSession(
  telegramId: number,
  state: string,
) {
  const {
    error,
  } = await supabase
    .from("bot_sessions")
    .upsert(
      {
        telegram_id:
          telegramId,

        state,

        updated_at:
          new Date().toISOString(),
      },
      {
        onConflict:
          "telegram_id",
      },
    );

  if (error) {
    console.error(
      "setSession:",
      error,
    );
  }

  return !error;
}

async function clearSession(
  telegramId: number,
) {
  const {
    error,
  } = await supabase
    .from("bot_sessions")
    .delete()
    .eq(
      "telegram_id",
      telegramId,
    );

  if (error) {
    console.error(
      "clearSession:",
      error,
    );
  }
}

// =====================================================
// CONTRACTOR MODE FOR ADMIN
// =====================================================

async function resetContractorSession(
  telegramId: number,
) {
  if (isAdmin(telegramId)) {
    await setSession(
      telegramId,
      "admin_contractor_mode",
    );

    return;
  }

  await clearSession(
    telegramId,
  );
}

function isAdminContractorState(
  state?: string | null,
): boolean {
  return (
    state ===
      "admin_contractor_mode" ||
    state ===
      "manager_message" ||
    /^wf_(volume|date|note|upload|decline|problem):/.test(state || "") ||
    Boolean(
      state?.startsWith(
        "waiting_act:",
      ) ||
      state?.startsWith(
        "waiting_act_start:",
      ) ||
      state?.startsWith(
        "waiting_act_files:",
      ),
    )
  );
}

// =====================================================
// APPLICATION NUMBER
// =====================================================

function generateApplicationNumber(): string {
  const number =
    Math.floor(
      1000 +
        Math.random() *
          9000,
    );

  return `G-${number}`;
}

async function generateUniqueApplicationNumber(): Promise<string> {
  for (
    let i = 0;
    i < 20;
    i++
  ) {
    const number =
      generateApplicationNumber();

    const {
      data,
    } = await supabase
      .from("applications")
      .select("id")
      .eq(
        "application_number",
        number,
      )
      .maybeSingle();

    if (!data) {
      return number;
    }
  }

  return `G-${Date.now()
    .toString()
    .slice(-4)}`;
}

// =====================================================
// STATUS
// =====================================================

function getApplicationStatusText(
  status: string,
): string {
  switch (status) {
    case "completed":
      return "✅ Виконана";

    case "assigned":
      return "🆕 Нова";

    case "in_progress":
      return "🔵 В роботі";

    case "new":
      return "🆕 Нова";

    default:
      return `📊 ${status}`;
  }
}

function getActStatusText(
  status: string,
): string {
  switch (status) {
    case "approved":
      return "✅ Підтверджено";

    case "rejected":
      return "❌ Відхилено";

    case "pending":
      return "⏳ Очікує перевірки";

    default:
      return `📊 ${status}`;
  }
}

// =====================================================
// ACT BUTTONS
// =====================================================

function actPendingKeyboard(
  actId: string,
) {
  console.log(
    "Creating act keyboard. actId:",
    actId,
  );

  if (!actId) {
    console.error(
      "CRITICAL: EMPTY ACT ID",
    );
  }

  return {
    inline_keyboard: [
      [
        {
          text: "✅ Підтвердити",
          callback_data:
            `approveact:${actId}`,
        },
        {
          text: "❌ Відхилити",
          callback_data:
            `rejectact:${actId}`,
        },
      ],
    ],
  };
}

function emptyInlineKeyboard() {
  return {
    inline_keyboard: [],
  };
}


type ParsedOrderCard = {
  azkCode: string;
  location: string;
  need: string;
  orderDate?: string;
};

function parseOrderCard(
  rawText: string,
): ParsedOrderCard | null {
  const source =
    String(rawText || "")
      .replace(/\r/g, "")
      .trim();

  if (!source) {
    return null;
  }

  const lines =
    source
      .split("\n")
      .map(
        (line) =>
          line
            .replace(/\*\*/g, "")
            .trim(),
      )
      .filter(Boolean);

  const fullText =
    lines.join("\n");

  // 1. Код АЗК / АЗС.
  // Підтримує:
  // "Код АЗК: 189"
  // "АЗС 189"
  // "АЗК №189"
  let azkCode = "";

  const codePatterns = [
    /(?:код\s*)?(?:азк|азс)\s*(?:№|#|:|-)?\s*([A-Za-zА-Яа-яІіЇїЄє0-9_-]+)/i,
    /\b(?:азк|азс)\s+([0-9]{1,8})\b/i,
  ];

  for (
    const pattern of
      codePatterns
  ) {
    const match =
      fullText.match(
        pattern,
      );

    if (match?.[1]) {
      azkCode =
        match[1].trim();
      break;
    }
  }

  // 2. Дата заявки / виконання.
  // Наприклад "на 25.07.2026".
  let orderDate = "";

  const dateMatch =
    fullText.match(
      /\b([0-3]?\d[.\-/][01]?\d[.\-/](?:20)?\d{2})\b/,
    );

  if (dateMatch?.[1]) {
    orderDate =
      dateMatch[1]
        .replace(/\//g, ".")
        .replace(/-/g, ".");
  }

  // 3. Потреба.
  // Шукаємо рядок із ключовими словами робіт.
  let need = "";

  const needKeywords =
    /(викач|відкач|откач|жбо|рпв|жиролов|жировлов|каналіз|септик|куб\.?\s*м|куб\.?м|м3|м³)/i;

  for (
    const line of
      lines
  ) {
    if (
      needKeywords.test(
        line,
      )
    ) {
      // Не беремо заголовок, якщо там лише "заявка на викачку".
      if (
        /заявк[аи]\s+на\s+(?:викач|відкач|откач)/i.test(
          line,
        ) &&
        lines.length > 1
      ) {
        continue;
      }

      need = line;
      break;
    }
  }

  // Якщо конкретний рядок не знайдено, беремо заголовок із потребою.
  if (!need) {
    const needMatch =
      fullText.match(
        /(?:потреба|потребность|робота|работа|що\s+потрібно|что\s+нужно)\s*[:\-–—]\s*([^\n]+)/i,
      );

    need =
      needMatch?.[1]?.trim() ||
      "";
  }

  // 4. Локація / адреса.
  // Спочатку шукаємо підписану адресу.
  let location = "";

  const locationMatch =
    fullText.match(
      /(?:локац(?:ія|ия)|адреса?|адрес)\s*[:\-–—]\s*([^\n]+)/i,
    );

  if (locationMatch?.[1]) {
    location =
      locationMatch[1].trim();
  }

  // Якщо підпису немає, визначаємо найбільш схожий на адресу рядок.
  if (!location) {
    const addressKeywords =
      /(област|обл\.|район|р-н|місто|м\.|село|с\.|смт|вул\.|вулиц|улиц|просп|пров|шосе|буд\.|будинок|дом|,\s*\d+[а-яА-Я]?)/i;

    for (
      const line of
        lines
    ) {
      if (
        line === need ||
        /(?:азк|азс)\s*(?:№|#)?\s*\d+/i.test(
          line,
        ) ||
        /заявк[аи]\s+на/i.test(
          line,
        )
      ) {
        continue;
      }

      if (
        addressKeywords.test(
          line,
        )
      ) {
        location =
          line;
        break;
      }
    }
  }

  // 5. Якщо потреба містить об'єм, залишаємо його у тексті.
  // Наприклад: "Викачка ЖБО 6 куб.м".
  // Це дозволяє одразу бачити обсяг у заявці.

  if (
    !azkCode ||
    !location ||
    !need
  ) {
    return null;
  }

  return {
    azkCode,
    location,
    need,
    ...(orderDate
      ? {
          orderDate,
        }
      : {}),
  } as ParsedOrderCard & {
    orderDate?: string;
  };
}


// =====================================================
// CREATE APPLICATION
// =====================================================

async function startCreateApplication(
  chatId: number,
  adminId: number,
) {
  await setSession(
    adminId,
    "admin_create_application_contractor",
  );

  await sendMessage(
    chatId,
    "➕ <b>Створення заявки</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      "🔎 <b>Знайдіть підрядника</b>\n\n" +
      "Введіть будь-що з цього:\n" +
      "📱 повний номер: <code>+380671234567</code>\n" +
      "📱 частину номера: <code>067</code>\n" +
      "📱 останні 4 цифри: <code>4567</code>\n" +
      "👤 ім'я / прізвище: <code>Анатолий</code>\n" +
      "🔹 username: <code>@username</code>\n\n" +
      "Бот покаже всі відповідні збіги.",
    cancelMenu(),
  );
}

async function showContractorsForApplication(
  chatId: number,
) {
  const {
    data,
    error,
  } = await supabase
    .from("contractors")
    .select(`
      id,
      first_name,
      last_name,
      username,
      status
    `)
    .eq(
      "status",
      "active",
    )
    .order("created_at", {
      ascending: false,
    })
    .limit(50);

  if (error) {
    console.error(
      "showContractorsForApplication:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося отримати список підрядників.",
      adminMenu(),
    );

    return;
  }

  if (
    !data ||
    data.length === 0
  ) {
    await sendMessage(
      chatId,
      "👥 Активних підрядників поки немає.",
      adminMenu(),
    );

    return;
  }

  const buttons: any[] = [];

  for (
    const contractor of data
  ) {
    const name =
      `${contractor.first_name || ""} ${
        contractor.last_name || ""
      }`.trim() ||
      "Без імені";

    buttons.push([
      {
        text:
          `👤 ${name}`,

        callback_data:
          `newappcontractor:${contractor.id}`,
      },
    ]);
  }

  await sendMessage(
    chatId,
    "👥 <b>Оберіть підрядника</b>\n━━━━━━━━━━━━━━━━",
    {
      inline_keyboard:
        buttons,
    },
  );
}

async function createApplicationStartObject(
  chatId: number,
  adminId: number,
  contractorId: string,
) {
  const {
    data: contractor,
    error,
  } = await supabase
    .from("contractors")
    .select(`
      id,
      first_name,
      last_name,
      phone
    `)
    .eq(
      "id",
      contractorId,
    )
    .maybeSingle();

  if (
    error ||
    !contractor
  ) {
    await sendMessage(
      chatId,
      "❌ Підрядника не знайдено.",
      adminMenu(),
    );

    return;
  }

  const name =
    `${contractor.first_name || ""} ${
      contractor.last_name || ""
    }`.trim() ||
    "Без імені";

  await setSession(
    adminId,
    `admin_create_application_object:${contractor.id}`,
  );

  await sendMessage(
    chatId,
    "📋 <b>Дані заявки</b>\n━━━━━━━━━━━━━━━━\n\n" +
      `Підрядник: <b>${escapeHtml(
        name,
      )}</b>\n` +
      `📱 ${escapeHtml(
        contractor.phone ||
          "Номер не вказано",
      )}\n\n` +
      "Вставте картку замовлення одним повідомленням. Можна навіть без підписів:\n\n" +
      "<code>Заявка на викачку на 25.07.2026 АЗС 189\n" +
      "Дніпропетровська область, Криворізький р-н, с. Мар'янівка, Пляжна 2а\n" +
      "Викачка ЖБО 6 куб.м</code>\n\n" +
      "Бот автоматично знайде <b>Код АЗК, Локацію, Потребу та дату</b>.\n\n" +
      "Або просто напишіть назву об'єкта — тоді продовжимо покроково.",
    cancelMenu(),
  );
}

async function askApplicationWork(
  chatId: number,
  adminId: number,
  objectName: string,
  contractorId: string,
) {
  await setSession(
    adminId,
    `admin_create_application_work:${contractorId}:${encodeURIComponent(
      objectName,
    )}`,
  );

  await sendMessage(
    chatId,
    "🔧 <b>Вид роботи</b>\n━━━━━━━━━━━━━━━━\n\n" +
      "Напишіть, що потрібно виконати.\n\n" +
      "Наприклад:\n" +
      "<code>Викачення РПВ</code>",
    cancelMenu(),
  );
}

async function askApplicationAddress(
  chatId: number,
  adminId: number,
  contractorId: string,
  objectName: string,
  workName: string,
) {
  await setSession(
    adminId,
    `admin_create_application_address:${contractorId}:${encodeURIComponent(
      objectName,
    )}:${encodeURIComponent(
      workName,
    )}`,
  );

  await sendMessage(
    chatId,
    "📍 <b>Адреса об’єкта</b>\n━━━━━━━━━━━━━━━━\n\n" +
      "Напишіть адресу об'єкта.\n\n" +
      "Якщо адреса не потрібна — напишіть <b>пропуск</b>.",
    cancelMenu(),
  );
}

async function askApplicationDeadline(
  chatId: number,
  adminId: number,
  contractorId: string,
  objectName: string,
  workName: string,
  address: string | null,
) {
  const payload = [
    contractorId,
    encodeURIComponent(objectName),
    encodeURIComponent(workName),
    encodeURIComponent(address || ""),
  ].join("|");

  await setSession(
    adminId,
    `admin_create_application_deadline:${payload}`,
  );

  await sendMessage(
    chatId,
    "⏰ <b>Дедлайн заявки</b>\n━━━━━━━━━━━━━━━━\n\n" +
      "Введіть дату і час у форматі:\n" +
      "<code>25.08.2026 18:00</code>\n\n" +
      "Або напишіть <b>пропуск</b>.",
    cancelMenu(),
  );
}

async function askApplicationComment(
  chatId: number,
  adminId: number,
  contractorId: string,
  objectName: string,
  workName: string,
  address: string | null,
  deadlineAt: string | null,
) {
  const payload = [
    contractorId,
    encodeURIComponent(objectName),
    encodeURIComponent(workName),
    encodeURIComponent(address || ""),
    encodeURIComponent(deadlineAt || ""),
  ].join("|");

  await setSession(
    adminId,
    `admin_create_application_comment:${payload}`,
  );

  await sendMessage(
    chatId,
    "📝 <b>Коментар менеджера</b>\n━━━━━━━━━━━━━━━━\n\n" +
      "Додайте важливе уточнення для підрядника.\n\n" +
      "Наприклад:\n<code>Перед приїздом зателефонувати керуючому.</code>\n\n" +
      "Або напишіть <b>пропуск</b>.",
    cancelMenu(),
  );
}

async function createApplication(
  chatId: number,
  adminId: number,
  contractorId: string,
  objectName: string,
  workName: string,
  address: string | null,
  deadlineAt: string | null = null,
  managerComment: string | null = null,
) {
  const applicationNumber =
    await generateUniqueApplicationNumber();

  const objectParts =
    objectName.split(
      "||ORDERMETA||",
    );

  const cleanObjectName =
    objectParts[0] ||
    objectName;

  let azkCode:
    string | null =
      null;

  let orderDateText:
    string | null =
      null;

  if (objectParts[1]) {
    const metaParts =
      objectParts[1].split(
        "||",
      );

    azkCode =
      metaParts[0]
        ? decodeURIComponent(
            metaParts[0],
          )
        : null;

    orderDateText =
      metaParts[1]
        ? decodeURIComponent(
            metaParts[1],
          )
        : null;
  }

  const title =
    `${cleanObjectName} — ${workName}`;

  const {
    data: application,
    error,
  } = await supabase
    .from("applications")
    .insert({
      application_number:
        applicationNumber,

      contractor_id:
        contractorId,

      manager_id:
        null,

      title,

      description:
        workName,

      address,

      azk_code:
        azkCode,

      order_date_text:
        orderDateText,

      deadline_at:
        deadlineAt,

      manager_comment:
        managerComment,

      scheduled_at:
        deadlineAt,

      status:
        "assigned",

      contractor_stage:
        "offered",

      updated_at:
        new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error(
      "CREATE APPLICATION ERROR:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ <b>Не вдалося створити заявку.</b>\n\n" +
        `<code>${escapeHtml(
          error.message,
        )}</code>`,
      adminMenu(),
    );

    return;
  }

  const {
    data: contractor,
  } = await supabase
    .from("contractors")
    .select(
      "telegram_id",
    )
    .eq(
      "id",
      contractorId,
    )
    .maybeSingle();

  const assignedToSelf =
    Boolean(
      contractor?.telegram_id &&
      Number(
        contractor.telegram_id,
      ) ===
        Number(
          adminId,
        ),
    );

  // Якщо адміністратор призначив заявку самому собі,
  // одразу переводимо його в режим підрядника.
  if (
    assignedToSelf &&
    isAdmin(
      adminId,
    )
  ) {
    await setSession(
      adminId,
      "admin_contractor_mode",
    );
  } else {
    await clearSession(
      adminId,
    );
  }

  await sendMessage(
    chatId,
    "✅ <b>ЗАЯВКУ СТВОРЕНО</b>\n\n" +
      `🔢 Номер: <b>${escapeHtml(
        application.application_number,
      )}</b>\n` +
      `🏢 Об'єкт: <b>${escapeHtml(
        objectName,
      )}</b>\n` +
      `🔧 Робота: <b>${escapeHtml(
        workName,
      )}</b>\n` +
      `📍 Адреса: <b>${escapeHtml(
        address ||
          "Не вказана",
      )}</b>\n` +
      `⏰ Дедлайн: <b>${escapeHtml(
        formatKyivDate(deadlineAt),
      )}</b>` +
      (managerComment
        ? `\n📝 Коментар: ${escapeHtml(managerComment)}`
        : "") +
      (
        assignedToSelf
          ? "\n\n👷 Ви призначили заявку собі. Увімкнено режим підрядника."
          : ""
      ),
    assignedToSelf
      ? mainMenu(
          adminId,
        )
      : adminMenu(),
  );

  if (
    contractor?.telegram_id
  ) {
    await sendMessage(
      contractor.telegram_id,
      "📋 <b>НОВА ЗАЯВКА</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `🔢 <b>${escapeHtml(
          application.application_number,
        )}</b>\n` +
        `🏢 ${escapeHtml(
          cleanObjectName,
        )}\n` +
        `🔧 ${escapeHtml(
          workName,
        )}\n` +
        `📍 ${escapeHtml(
          address ||
            "Адресу не вказано",
        )}\n` +
        `⏰ ${escapeHtml(
          formatKyivDate(
            deadlineAt,
          ),
        )}` +
        (managerComment
          ? `\n📝 ${escapeHtml(
              managerComment,
            )}`
          : "") +
        "\n\nГотові виконати цю заявку?",
      {
        inline_keyboard: [
          [
            {
              text: "✅ Прийняти",
              callback_data:
                `contractoraccept:${application.id}`,
            },
            {
              text: "❌ Відмовитися",
              callback_data:
                `contractordecline:${application.id}`,
            },
          ],
        ],
      },
    );
  }
}



function formatOriginalOrderBlock(
  app: any,
): string {
  const orderDate =
    app?.order_date_text ||
    "Дата не вказана";

  const azsCode =
    app?.azk_code ||
    String(
      app?.title ||
        "",
    )
      .match(
        /АЗ[КС]\s*([A-Za-zА-Яа-яІіЇїЄє0-9_-]+)/i,
      )?.[1] ||
    "—";

  const location =
    app?.address ||
    "Локація не вказана";

  const need =
    app?.description ||
    "Потреба не вказана";

  return (
    `<b>Заявка на викачку на ${escapeHtml(
      orderDate,
    )}</b>     <b>АЗС ${escapeHtml(
      azsCode,
    )}</b>\n\n` +
    `${escapeHtml(
      location,
    )}\n\n` +
    `${escapeHtml(
      need,
    )}`
  );
}

function formatWorkCardFields(
  app: any,
): string {
  let body =
    `🔢 Заявка: <b>${escapeHtml(
      app?.application_number ||
        "G-0000",
    )}</b>\n` +
    `🏢 Об'єкт: <b>${escapeHtml(
      app?.title ||
        "Без назви",
    )}</b>\n`;

  if (app?.description) {
    body +=
      `🔧 Потреба: <b>${escapeHtml(
        app.description,
      )}</b>\n`;
  }

  if (app?.address) {
    body +=
      `📍 Локація: <b>${escapeHtml(
        app.address,
      )}</b>\n`;
  }

  if (
    app?.actual_volume !==
      null &&
    app?.actual_volume !==
      undefined &&
    String(
      app.actual_volume,
    ) !== ""
  ) {
    body +=
      `📦 Об'єм: <b>${escapeHtml(
        app.actual_volume,
      )} м³</b>\n`;
  }

  if (app?.deadline_at) {
    body +=
      `⏰ Дедлайн: <b>${escapeHtml(
        formatKyivDate(
          app.deadline_at,
        ),
      )}</b>\n`;
  }

  if (app?.manager_comment) {
    body +=
      `📝 Коментар: ${escapeHtml(
        app.manager_comment,
      )}\n`;
  }

  return body;
}

// =====================================================
// APPLICATIONS
// =====================================================

async function showApplications(
  chatId: number,
  telegramId: number,
) {
  const contractor =
    await getContractor(
      telegramId,
    );

  if (!contractor) {
    await sendMessage(
      chatId,
      "❗ Спочатку натисніть /start.",
      mainMenu(telegramId),
    );
    return;
  }

  const { data, error } =
    await supabase
      .from("applications")
      .select(`
        id,
        application_number,
        title,
        address,
        deadline_at,
        contractor_stage,
        status
      `)
      .eq(
        "contractor_id",
        contractor.id,
      )
      .neq(
        "status",
        "completed",
      )
      .in(
        "contractor_stage",
        [
          "offered",
          "accepted",
          "departed",
          "problem"
        ],
      )
      .order(
        "deadline_at",
        {
          ascending: true,
          nullsFirst: false,
        },
      )
      .limit(50);

  if (error) {
    console.error(
      "showApplications:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося отримати заявки.",
      mainMenu(telegramId),
    );
    return;
  }

  if (!data?.length) {
    await sendMessage(
      chatId,
      "📋 <b>Мої заявки</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        "Активних заявок зараз немає.",
      mainMenu(telegramId),
    );
    return;
  }

  const buttons: any[][] = [];

  for (const app of data) {
    const stageIcon =
      app.contractor_stage ===
        "departed"
        ? "🚗"
        : app.contractor_stage ===
            "problem"
        ? "⚠️"
        : "📋";

    const deadline =
      app.deadline_at
        ? new Date(
            app.deadline_at,
          ).toLocaleDateString(
            "uk-UA",
            {
              day: "2-digit",
              month: "2-digit",
            },
          )
        : "";

    buttons.push([
      {
        text:
          `${stageIcon} ${app.application_number || "G-0000"}` +
          (deadline
            ? ` • ${deadline}`
            : ""),
        callback_data:
          `contractorapp:${app.id}`,
      },
    ]);
  }

  await sendMessage(
    chatId,
    "📋 <b>Ваші активні заявки</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `Усього: <b>${data.length}</b>\n` +
      "Натисніть на заявку, щоб відкрити деталі 👇",
    {
      inline_keyboard:
        buttons,
    },
  );
}

async function showContractorApplicationCard(chatId: number,telegramId: number,applicationId: string) {
  try { await serviceWorkflow.card(chatId,telegramId,applicationId); }
  catch { await sendMessage(chatId,"Заявка недоступна. Оновіть список.",mainMenu(telegramId)); }
}

// =====================================================
// FINISH APPLICATION
// =====================================================

async function startFinishApplication(
  chatId: number,
  telegramId: number,
  applicationId: string,
) {
  const contractor =
    await getContractor(
      telegramId,
    );

  if (!contractor) {
    await sendMessage(
      chatId,
      "❌ Підрядника не знайдено.",
      mainMenu(telegramId),
    );

    return;
  }

  const {
    data: application,
    error,
  } = await supabase
    .from("applications")
    .select(`
      id,
      application_number,
      contractor_id,
      title,
      description,
      address,
      status
    `)
    .eq(
      "id",
      applicationId,
    )
    .maybeSingle();

  if (error) {
    console.error(
      "startFinishApplication:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося отримати заявку.",
      mainMenu(telegramId),
    );

    return;
  }

  if (!application) {
    await sendMessage(
      chatId,
      "❌ Заявку не знайдено.",
      mainMenu(telegramId),
    );

    return;
  }

  if (
    application.contractor_id !==
    contractor.id
  ) {
    await sendMessage(
      chatId,
      "⛔ Ця заявка не належить вам.",
      mainMenu(telegramId),
    );

    return;
  }

  if (
    application.status ===
    "completed"
  ) {
    await sendMessage(
      chatId,
      "ℹ️ Ця заявка вже завершена.",
      mainMenu(telegramId),
    );

    return;
  }

  await setSession(
    telegramId,
    `waiting_act:${application.id}`,
  );

  await sendMessage(
    chatId,
    "✅ <b>ЗАВЕРШЕННЯ РОБОТИ</b>\n\n" +
      `🔢 Заявка: <b>${escapeHtml(
        application.application_number ||
          "G-0000",
      )}</b>\n` +
      `🏢 Об'єкт: <b>${escapeHtml(
        application.title ||
          "Без назви",
      )}</b>\n` +
      `🔧 Робота: <b>${escapeHtml(
        application.description ||
          "",
      )}</b>\n\n` +
      "Тепер надішліть акт виконаних робіт.\n\n" +
      "📎 Можна PDF, документ або фото.\n\n" +
      "Після отримання акт буде переданий адміністратору.",
    cancelMenu(),
  );
}

// =====================================================
// SAVE ACT
// =====================================================

async function saveAct(
  message: any,
  contractor: any,
  applicationId: string,
) {
  let fileId: string | null =
    null;

  let fileType: string | null =
    null;

  let fileName: string | null =
    null;

  if (
    message.document
  ) {
    fileId =
      message.document.file_id;

    fileType =
      "document";

    fileName =
      message.document.file_name ||
      "document";
  }

  if (
    message.photo &&
    message.photo.length > 0
  ) {
    const photo =
      message.photo[
        message.photo.length - 1
      ];

    fileId =
      photo.file_id;

    fileType =
      "photo";

    fileName =
      "photo.jpg";
  }

  if (!fileId) {
    console.error(
      "saveAct: no fileId",
    );

    return null;
  }

  console.log(
    "saveAct applicationId:",
    applicationId,
  );

  const {
    data: application,
    error:
      applicationError,
  } = await supabase
    .from("applications")
    .select(`
      id,
      application_number,
      contractor_id,
      title,
      description,
      address,
      actual_volume,
      deadline_at,
      manager_comment,
      status
    `)
    .eq(
      "id",
      applicationId,
    )
    .maybeSingle();

  if (applicationError) {
    console.error(
      "saveAct application:",
      applicationError,
    );

    return null;
  }

  if (!application) {
    console.error(
      "saveAct: application not found",
    );

    return null;
  }

  if (
    application.contractor_id !==
    contractor.id
  ) {
    console.error(
      "saveAct: contractor mismatch",
    );

    return null;
  }

  if (
    application.status ===
    "completed"
  ) {
    console.error(
      "saveAct: application completed",
    );

    return null;
  }

  const {
    data,
    error,
  } = await supabase
    .from("acts")
    .insert({
      contractor_id:
        contractor.id,

      application_id:
        application.id,

      telegram_file_id:
        fileId,

      file_type:
        fileType,

      file_name:
        fileName,

      status:
        "pending",
    })
    .select(`
      id,
      contractor_id,
      application_id,
      telegram_file_id,
      file_type,
      file_name,
      status,
      created_at
    `)
    .single();

  if (error) {
    console.error(
      "saveAct DB ERROR:",
      error,
    );

    return null;
  }

  if (!data?.id) {
    console.error(
      "saveAct: ACT CREATED WITHOUT ID",
    );

    return null;
  }

  console.log(
    "ACT CREATED:",
    JSON.stringify(data),
  );

  return {
    ...data,

    application_number:
      application.application_number,

    application_title:
      application.title,

    application_description:
      application.description,

    application_address:
      application.address,

    application_actual_volume:
      application.actual_volume,

    application_deadline_at:
      application.deadline_at,

    application_manager_comment:
      application.manager_comment,
  };
}

// =====================================================
// SEND ACT TO GROUP
// =====================================================

async function sendActToGroup(
  act: any,
  contractor: any,
) {
  console.log(
    "sendActToGroup ACT:",
    JSON.stringify(act),
  );

  if (!act?.id) {
    console.error(
      "sendActToGroup: EMPTY ACT ID",
    );

    return false;
  }

  const name =
    `${contractor.first_name || ""} ${
      contractor.last_name || ""
    }`.trim() ||
    "Без імені";

  const actApplicationCard = {
    application_number:
      act.application_number,
    title:
      act.application_title,
    description:
      act.application_description,
    address:
      act.application_address,
    actual_volume:
      act.application_actual_volume,
    deadline_at:
      act.application_deadline_at,
    manager_comment:
      act.application_manager_comment,
  };

  let caption =
    `📑 <b>${escapeHtml(act.act_number || "Акт")}</b>` +
    ` • <b>${escapeHtml(act.application_number || "G-0000")}</b>\n`;
  if (act.application_title) caption += `🏢 ${escapeHtml(act.application_title)}\n`;
  if (act.application_address) caption += `📍 ${escapeHtml(act.application_address)}\n`;
  if (act.application_description) caption += `🔧 ${escapeHtml(act.application_description)}\n`;
  caption += `👤 ${escapeHtml(name)}\n`;
  caption += "⏳ <b>Очікує перевірки</b>";

  const replyMarkup =
    actPendingKeyboard(
      String(act.id),
    );

  const regionTopic =
    await getRegionTopic(
      contractor.region_code,
    );

  const topicPayload =
    regionTopic?.message_thread_id
      ? {
          message_thread_id:
            regionTopic.message_thread_id,
        }
      : {};

  let result;

  if (
    act.file_type ===
    "document"
  ) {
    result =
      await telegram(
        "sendDocument",
        {
          chat_id:
            GROUP_CHAT_ID,

          ...topicPayload,

          document:
            act.telegram_file_id,

          caption,

          parse_mode:
            "HTML",

          reply_markup:
            replyMarkup,
        },
      );
  } else {
    result =
      await telegram(
        "sendPhoto",
        {
          chat_id:
            GROUP_CHAT_ID,

          ...topicPayload,

          photo:
            act.telegram_file_id,

          caption,

          parse_mode:
            "HTML",

          reply_markup:
            replyMarkup,
        },
      );
  }

  if (!result?.ok) {
    console.error(
      "SEND ACT TO GROUP ERROR:",
      JSON.stringify(result),
    );

    return false;
  }

  const messageId =
    result?.result?.message_id;

  console.log(
    "GROUP MESSAGE ID:",
    messageId,
  );

  if (!messageId) {
    console.error(
      "No group message ID",
    );

    return false;
  }

  const {
    error:
      updateError,
  } = await supabase
    .from("acts")
    .update({
      group_chat_id:
        GROUP_CHAT_ID,

      group_message_id:
        messageId,
    })
    .eq(
      "id",
      act.id,
    );

  if (updateError) {
    console.error(
      "SAVE GROUP MESSAGE ID ERROR:",
      updateError,
    );

    // Сам акт уже отправлен.
  }

  return true;
}

// =====================================================
// HANDLE ACT
// =====================================================

async function handleAct(
  message: any,
  contractor: any,
  applicationId: string,
) {
  const act =
    await saveAct(
      message,
      contractor,
      applicationId,
    );

  if (!act) {
    return false;
  }

  const sentToGroup =
    await sendActToGroup(
      act,
      contractor,
    );

  if (!sentToGroup) {
    console.error(
      "ACT GROUP SEND FAILED:",
      act.id,
    );

    return false;
  }

  return true;
}

// =====================================================
// UPDATE GROUP ACT MESSAGE
// =====================================================

async function updateActGroupMessage(
  act: any,
  status:
    | "approved"
    | "rejected",
) {
  console.log(
    "updateActGroupMessage:",
    JSON.stringify({
      actId: act?.id,
      groupChatId:
        act?.group_chat_id,
      groupMessageId:
        act?.group_message_id,
      status,
    }),
  );

  if (
    !act?.group_chat_id ||
    !act?.group_message_id
  ) {
    console.log(
      "No group message information for act:",
      act?.id,
    );

    return false;
  }

  const statusText =
    getActStatusText(
      status,
    );

  const name =
    `${act.contractor_first_name || ""} ${
      act.contractor_last_name || ""
    }`.trim() ||
    "Без імені";

  const shortValue = (value: unknown, max = 180) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  let caption =
    `📑 <b>${escapeHtml(shortValue(act.act_number || "Акт", 60))}</b>` +
    ` • <b>${escapeHtml(shortValue(act.application_number || "G-0000", 40))}</b>\n`;

  if (act.application_title) caption += `🏢 ${escapeHtml(shortValue(act.application_title))}\n`;
  if (act.application_address) caption += `📍 ${escapeHtml(shortValue(act.application_address))}\n`;
  if (act.application_description) caption += `🔧 ${escapeHtml(shortValue(act.application_description))}\n`;
  if (act.application_order_date_text) caption += `📅 ${escapeHtml(shortValue(act.application_order_date_text, 100))}\n`;
  caption += `👤 ${escapeHtml(shortValue(name, 100))}\n`;
  caption += status === "approved"
    ? "✅ <b>Акт підтверджено</b>"
    : "❌ <b>Акт відхилено</b>";

  const result =
    await telegram(
      "editMessageCaption",
      {
        chat_id:
          act.group_chat_id,

        message_id:
          act.group_message_id,

        caption,

        parse_mode:
          "HTML",

        reply_markup:
          emptyInlineKeyboard(),
      },
    );

  if (result?.ok === true) {
    return true;
  }

  const textResult = await telegram(
    "editMessageText",
    {
      chat_id: act.group_chat_id,
      message_id: act.group_message_id,
      text: caption,
      parse_mode: "HTML",
      reply_markup: emptyInlineKeyboard(),
    },
  );

  return textResult?.ok === true;
}

// =====================================================
// OPEN ACT
// =====================================================

async function openAct(
  chatId: number,
  actId: string,
) {
  console.log(
    "OPEN ACT:",
    actId,
  );

  if (!actId) {
    await sendMessage(
      chatId,
      "❌ Некоректний ID акта.",
      adminMenu(),
    );

    return;
  }

  const {
    data: act,
    error,
  } = await supabase
    .from("acts")
    .select(`
      id,
      contractor_id,
      application_id,
      telegram_file_id,
      file_type,
      file_name,
      act_number,
      act_date,
      status,
      group_chat_id,
      group_message_id,
      service_report
    `)
    .eq(
      "id",
      actId,
    )
    .maybeSingle();

  console.log(
    "OPEN ACT RESULT:",
    JSON.stringify({
      act,
      error,
    }),
  );

  if (error) {
    await sendMessage(
      chatId,
      "❌ Помилка БД при відкритті акта.\n\n" +
        `<code>${escapeHtml(
          error.message,
        )}</code>`,
      adminMenu(),
    );

    return;
  }

  if (!act) {
    await sendMessage(
      chatId,
      "❌ Акт не знайдено.\n\n" +
        `ID: <code>${escapeHtml(
          actId,
        )}</code>`,
      adminMenu(),
    );

    return;
  }

  const {
    data: contractor,
  } = await supabase
    .from("contractors")
    .select(`
      first_name,
      last_name
    `)
    .eq(
      "id",
      act.contractor_id,
    )
    .maybeSingle();

  const name =
    contractor
      ? `${contractor.first_name || ""} ${
          contractor.last_name || ""
        }`.trim()
      : "Невідомий";

  let applicationNumber =
    "G-0000";

  let applicationData: any =
    null;

  if (
    act.application_id
  ) {
    const {
      data: application,
    } = await supabase
      .from("applications")
      .select(`
        application_number,
        title,
        description,
        address,
        azk_code,
        order_date_text
      `)
      .eq(
        "id",
        act.application_id,
      )
      .maybeSingle();

    if (application) {
      applicationNumber =
        application.application_number ||
        "G-0000";

      applicationData =
        application;
    }
  }

  let caption =
    "📑 <b>АКТ</b>\n\n" +
    `🧾 Номер: <b>${escapeHtml(
      act.act_number || "Без номера",
    )}</b>\n` +
    `📅 Дата: <b>${escapeHtml(
      formatKyivDate(act.act_date),
    )}</b>\n` +
    `👤 Підрядник: <b>${escapeHtml(
      name,
    )}</b>\n` +
    `🔢 Заявка: <b>${escapeHtml(
      applicationNumber,
    )}</b>\n\n` +
    formatOriginalOrderBlock(
      applicationData,
    ) +
    `\n\n📄 ${escapeHtml(
      act.file_name ||
        "Файл",
    )}\n` +
    `📊 Статус: <b>${escapeHtml(
      getActStatusText(
        act.status,
      ),
    )}</b>`;

  if(act.service_report) caption += `\n\n📊 Фактичний результат: ${act.service_report.volume===null?"без відкачки":`${act.service_report.volume} м³`}\n📅 Дата виконання: ${escapeHtml(act.service_report.work_date)}\n${escapeHtml(act.service_report.notes||"")}`;

  const files = await resolveActFiles(supabase, act);
  if (!files.length) {
    await sendMessage(chatId, "Файл акта недоступний.");
    return;
  }
  for (const [index, file] of files.entries()) {
    const photo = file.file_type === "photo";
    await telegram(photo ? "sendPhoto" : "sendDocument", {
      chat_id: chatId,
      [photo ? "photo" : "document"]: file.source,
      caption: index === 0 ? caption : `📎 Первинний акт · файл ${index + 1}/${files.length}`,
      parse_mode: "HTML",
    });
  }

  if (
    act.status ===
    "pending"
  ) {
    await sendMessage(
      chatId,
      "Що зробити з цим актом?",
      {
        inline_keyboard: [
          [
            {
              text:
                "✅ Підтвердити акт",

              callback_data:
                `approveact:${act.id}`,
            },
          ],
          [
            {
              text:
                "❌ Відхилити акт",

              callback_data:
                `rejectact:${act.id}`,
            },
          ],
        ],
      },
    );
  }
}

// =====================================================
// CONFIRM ACT
// =====================================================

async function reviewServiceAct(chatId:number,actId:string,decision:string,reason="",actor?:string) {
  const {data,error}=await supabase.rpc("rpv_service_review",{p_actor:actor || `telegram:${chatId}`,p_act:actId,p_decision:decision,p_reason:reason});
  if(error) { const message=['P2001','P2002'].includes(error.code)?error.message:"Не вдалося прийняти рішення. Перевірте акт, дату, обсяг та прив’язку АЗК. Оновіть список."; if(actor && !actor.startsWith('telegram:')) throw Object.assign(new Error(message),{status:error.code==='P2001'?400:error.code==='P2002'?409:500}); await sendMessage(chatId,message);return false; }
  if(!data?.changed) {await sendMessage(chatId,"Цей акт уже оброблено.");return true;}
  const {data:act}=await supabase.from("acts").select("*").eq("id",actId).maybeSingle();
  const {data:app}=await supabase.from("applications").select("*").eq("id",data.application_id).maybeSingle();
  const {data:c}=await supabase.from("contractors").select("first_name,last_name").eq("id",act?.contractor_id).maybeSingle();
  if(app) await syncWorkCardStatus(app);
  if(act) await updateActGroupMessage({...act,contractor_first_name:c?.first_name,contractor_last_name:c?.last_name,application_number:app?.application_number,application_title:app?.title,application_description:app?.description,application_address:app?.address,application_azk_code:app?.azk_code,application_order_date_text:app?.order_date_text},decision as "approved" | "rejected");
  await sendMessage(chatId,decision==="approved"?"✅ Акт підтверджено. Роботу додано до історії."+(data.publication?" Акт та обсяг опубліковано замовнику.":" Для старого акта без результату перевірте публікацію окремо."):"Акт повернуто підряднику на уточнення.");
  if(data.contractor_telegram_id) await sendMessage(data.contractor_telegram_id,decision==="approved"?`✅ Заявку ${escapeHtml(data.application_number)} підтверджено. Нарахування та стан виплати — у кабінеті.`:`❗ Акт за заявкою ${escapeHtml(data.application_number)} повернуто.\nПричина: ${escapeHtml(reason)}\nВідкрийте заявку та передайте виправлений результат.`,mainMenu(data.contractor_telegram_id));
  if(data.publication) {try{await notifyPublished(supabase,BOT_TOKEN!,data.publication);}catch{console.warn("Customer publication notification pending");}}
  return true;
}
async function confirmAct(chatId:number,actId:string,actor?:string){return reviewServiceAct(chatId,actId,"approved","",actor);}

// =====================================================
// REJECT ACT
// =====================================================

async function rejectAct(chatId:number,actId:string,reason="",actor?:string){return reviewServiceAct(chatId,actId,"rejected",reason,actor);}

// =====================================================
// ADMIN ACTS
// =====================================================

async function showAdminActs(
  chatId: number,
) {
  const {
    data,
    error,
  } = await supabase
    .from("acts")
    .select(`
      id,
      contractor_id,
      application_id,
      file_name,
      file_type,
      status,
      created_at
    `)
    .order("created_at", {
      ascending: false,
    })
    .limit(50);

  if (error) {
    console.error(
      "showAdminActs:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося отримати акти.",
      adminMenu(),
    );

    return;
  }

  if (
    !data ||
    data.length === 0
  ) {
    await sendMessage(
      chatId,
      "📑 <b>АКТИ</b>\n\nАктів поки немає.",
      adminMenu(),
    );

    return;
  }

  for (
    const act of data
  ) {
    const {
      data: contractor,
    } = await supabase
      .from("contractors")
      .select(`
        first_name,
        last_name
      `)
      .eq(
        "id",
        act.contractor_id,
      )
      .maybeSingle();

    const name =
      contractor
        ? `${contractor.first_name || ""} ${
            contractor.last_name || ""
          }`.trim()
        : "Невідомий";

    let applicationNumber =
      "G-0000";

    let applicationData: any =
      null;

    if (
      act.application_id
    ) {
      const {
        data: application,
      } = await supabase
        .from("applications")
        .select(`
          application_number,
          title,
          description,
          address,
          azk_code,
          order_date_text
        `)
        .eq(
          "id",
          act.application_id,
        )
        .maybeSingle();

      if (application) {
        applicationNumber =
          application.application_number ||
          "G-0000";

        applicationData =
          application;
      }
    }

    const buttons: any[] = [
      [
        {
          text:
            "📎 Відкрити акт",

          callback_data:
            `openact:${act.id}`,
        },
      ],
    ];

    if (
      act.status ===
      "pending"
    ) {
      buttons.push([
        {
          text:
            "✅ Підтвердити",

          callback_data:
            `approveact:${act.id}`,
        },
      ]);

      buttons.push([
        {
          text:
            "❌ Відхилити",

          callback_data:
            `rejectact:${act.id}`,
        },
      ]);
    }

    await sendMessage(
      chatId,
      "📑 <b>АКТ</b>\n\n" +
        `👤 Підрядник: <b>${escapeHtml(
          name,
        )}</b>\n` +
        `🔢 Заявка: <b>${escapeHtml(
          applicationNumber,
        )}</b>\n\n` +
        formatOriginalOrderBlock(
          applicationData,
        ) +
        `\n\n📄 ${escapeHtml(
          act.file_name ||
            "Файл",
        )}\n` +
        `📊 ${escapeHtml(
          getActStatusText(
            act.status,
          ),
        )}`,
      {
        inline_keyboard:
          buttons,
      },
    );
  }

  await sendMessage(
    chatId,
    "👑 <b>Адмін-панель</b>\n━━━━━━━━━━━━━━━━",
    adminMenu(),
  );
}

// =====================================================
// ADMIN APPLICATIONS
// =====================================================

async function showAdminApplications(
  chatId: number,
) {
  const {
    data,
    error,
  } = await supabase
    .from("applications")
    .select(`
      id,
      application_number,
      contractor_id,
      title,
      description,
      address,
      status,
      created_at
    `)
    .order("created_at", {
      ascending: false,
    })
    .limit(50);

  if (error) {
    console.error(
      "showAdminApplications:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося отримати заявки.",
      adminMenu(),
    );

    return;
  }

  if (
    !data ||
    data.length === 0
  ) {
    await sendMessage(
      chatId,
      "📋 <b>ЗАЯВКИ</b>\n\nЗаявок немає.",
      adminMenu(),
    );

    return;
  }

  for (
    const application of data
  ) {
    const {
      data: contractor,
    } = await supabase
      .from("contractors")
      .select(`
        first_name,
        last_name
      `)
      .eq(
        "id",
        application.contractor_id,
      )
      .maybeSingle();

    const contractorName =
      contractor
        ? `${contractor.first_name || ""} ${
            contractor.last_name || ""
          }`.trim()
        : "Не вказано";

    await sendMessage(
      chatId,
      "📋 <b>ЗАЯВКА</b>\n\n" +
        `🔢 Номер: <b>${escapeHtml(
          application.application_number ||
            "G-0000",
        )}</b>\n` +
        `🏢 <b>${escapeHtml(
          application.title ||
            "Без назви",
        )}</b>\n` +
        `🔧 ${escapeHtml(
          application.description ||
            "",
        )}\n` +
        `👤 Підрядник: <b>${escapeHtml(
          contractorName,
        )}</b>\n` +
        `📊 ${escapeHtml(
          getApplicationStatusText(
            application.status ||
              "new",
          ),
        )}`,
      {
        inline_keyboard: [
          [
            {
              text:
                "📑 Переглянути акти",

              callback_data:
                `applicationacts:${application.id}`,
            },
          ],
        ],
      },
    );
  }

  await sendMessage(
    chatId,
    "👑 <b>Адмін-панель</b>\n━━━━━━━━━━━━━━━━",
    adminMenu(),
  );
}

// =====================================================
// APPLICATION ACTS
// =====================================================

async function showApplicationActs(
  chatId: number,
  applicationId: string,
) {
  const {
    data: application,
  } = await supabase
    .from("applications")
    .select(`
      id,
      application_number,
      title
    `)
    .eq(
      "id",
      applicationId,
    )
    .maybeSingle();

  if (!application) {
    await sendMessage(
      chatId,
      "❌ Заявка не знайдена.",
      adminMenu(),
    );

    return;
  }

  const {
    data: acts,
    error,
  } = await supabase
    .from("acts")
    .select(`
      id,
      file_name,
      file_type,
      status,
      created_at
    `)
    .eq(
      "application_id",
      applicationId,
    )
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error(
      "showApplicationActs:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Помилка при отриманні актів.",
      adminMenu(),
    );

    return;
  }

  if (
    !acts ||
    acts.length === 0
  ) {
    await sendMessage(
      chatId,
      "📑 Для цієї заявки актів немає.",
      adminMenu(),
    );

    return;
  }

  for (
    const act of acts
  ) {
    const buttons: any[] = [
      [
        {
          text:
            "📎 Відкрити акт",

          callback_data:
            `openact:${act.id}`,
        },
      ],
    ];

    if (
      act.status ===
      "pending"
    ) {
      buttons.push([
        {
          text:
            "✅ Підтвердити",

          callback_data:
            `approveact:${act.id}`,
        },
      ]);

      buttons.push([
        {
          text:
            "❌ Відхилити",

          callback_data:
            `rejectact:${act.id}`,
        },
      ]);
    }

    await sendMessage(
      chatId,
      "📑 <b>АКТ ЗАЯВКИ</b>\n\n" +
        `🔢 ${escapeHtml(
          application.application_number ||
            "G-0000",
        )}\n` +
        `🏢 ${escapeHtml(
          application.title ||
            "Без назви",
        )}\n` +
        `📄 ${escapeHtml(
          act.file_name ||
            "Файл",
        )}\n` +
        `📊 ${escapeHtml(
          getActStatusText(
            act.status,
          ),
        )}`,
      {
        inline_keyboard:
          buttons,
      },
    );
  }
}

// =====================================================
// HISTORY
// =====================================================

async function showHistory(
  chatId: number,
  telegramId: number,
) {
  const contractor =
    await getContractor(
      telegramId,
    );

  if (!contractor) {
    return;
  }

  const { data, error } =
    await supabase
      .from("work_history")
      .select(`
        id,
        application_id,
        title,
        completed_at
      `)
      .eq(
        "contractor_id",
        contractor.id,
      )
      .order(
        "completed_at",
        {
          ascending: false,
        },
      )
      .limit(30);

  if (error) {
    await sendMessage(
      chatId,
      "❌ Не вдалося отримати історію.",
      mainMenu(telegramId),
    );
    return;
  }

  if (!data?.length) {
    await sendMessage(
      chatId,
      "📄 <b>Історія робіт</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        "Завершених робіт поки немає.",
      mainMenu(telegramId),
    );
    return;
  }

  const buttons: any[][] = [];

  for (const item of data) {
    const { data: app } =
      await supabase
        .from("applications")
        .select(
          "application_number",
        )
        .eq(
          "id",
          item.application_id,
        )
        .maybeSingle();

    const date =
      item.completed_at
        ? new Date(
            item.completed_at,
          ).toLocaleDateString(
            "uk-UA",
          )
        : "";

    buttons.push([
      {
        text:
          `📄 ${app?.application_number || "G-0000"}` +
          (date
            ? ` • ${date}`
            : ""),
        callback_data:
          `contractorhistory:${item.application_id}`,
      },
    ]);
  }

  await sendMessage(
    chatId,
    "📄 <b>Історія робіт</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      "Останні завершені заявки. Натисніть, щоб відкрити деталі:",
    {
      inline_keyboard:
        buttons,
    },
  );
}

async function showContractorHistoryCard(
  chatId: number,
  telegramId: number,
  applicationId: string,
) {
  const contractor =
    await getContractor(
      telegramId,
    );

  if (!contractor) {
    return;
  }

  const { data: app } =
    await supabase
      .from("applications")
      .select("*")
      .eq(
        "id",
        applicationId,
      )
      .eq(
        "contractor_id",
        contractor.id,
      )
      .maybeSingle();

  if (!app) {
    await sendMessage(
      chatId,
      "❌ Заявку не знайдено.",
      mainMenu(telegramId),
    );
    return;
  }

  const payout =
    Number(
      app.payout_amount ||
        0,
    );

  let body =
    `📄 <b>Заявка ${escapeHtml(
      app.application_number ||
        "G-0000",
    )}</b>\n` +
    "━━━━━━━━━━━━━━━━\n\n" +
    "✅ Статус: <b>Виконана</b>\n" +
    `🏢 ${escapeHtml(
      app.title ||
        "Без назви",
    )}\n`;

  if (app.address) {
    body +=
      `📍 ${escapeHtml(
        app.address,
      )}\n`;
  }

  if (app.actual_volume) {
    body +=
      `📦 Об'єм: <b>${escapeHtml(
        app.actual_volume,
      )} м³</b>\n`;
  }

  if (payout > 0) {
    body +=
      `💰 Нараховано: <b>${escapeHtml(
        payout.toFixed(2),
      )} грн</b>\n`;
  }

  if (app.updated_at) {
    body +=
      `📅 Завершено: ${escapeHtml(
        formatKyivDate(
          app.updated_at,
        ),
      )}`;
  }

  await sendMessage(
    chatId,
    body,
    {
      inline_keyboard: [
        [
          {
            text:
              "◀️ Назад до історії",
            callback_data:
              "contractorhistorylist",
          },
        ],
      ],
    },
  );
}

async function showContractorPayouts(
  chatId: number,
  telegramId: number,
) {
  const contractor =
    await getContractor(
      telegramId,
    );

  if (!contractor) {
    return;
  }

  const now =
    new Date();

  const monthStart =
    new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1,
      ),
    ).toISOString();

  const { data, error } =
    await supabase
      .from("applications")
      .select(
        "payout_amount,payout_status,status,updated_at",
      )
      .eq(
        "contractor_id",
        contractor.id,
      )
      .gte(
        "updated_at",
        monthStart,
      );

  if (error) {
    await sendMessage(
      chatId,
      "❌ Не вдалося отримати інформацію про виплати.",
      mainMenu(telegramId),
    );
    return;
  }

  let accrued = 0;
  let paid = 0;

  for (const app of data || []) {
    const amount =
      Number(
        app.payout_amount ||
          0,
      );

    if (
      app.status ===
      "completed"
    ) {
      accrued +=
        amount;
    }

    if (
      app.payout_status ===
      "paid"
    ) {
      paid +=
        amount;
    }
  }

  const due =
    Math.max(
      accrued - paid,
      0,
    );

  await sendMessage(
    chatId,
    "💰 <b>Виплати за поточний місяць</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `Нараховано: <b>${accrued.toFixed(2)} грн</b>\n` +
      `Виплачено: <b>${paid.toFixed(2)} грн</b>\n` +
      `До виплати: <b>${due.toFixed(2)} грн</b>\n\n` +
      "Сума формується після підтвердження виконаної роботи.",
    mainMenu(telegramId),
  );
}

async function showAdminHistory(
  chatId: number,
) {
  const {
    data,
    error,
  } = await supabase
    .from("work_history")
    .select(`
      id,
      application_id,
      contractor_id,
      title,
      description,
      completed_at
    `)
    .order("completed_at", {
      ascending: false,
    })
    .limit(50);

  if (error) {
    console.error(
      "showAdminHistory:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося отримати історію.",
      adminMenu(),
    );

    return;
  }

  if (
    !data ||
    data.length === 0
  ) {
    await sendMessage(
      chatId,
      "📚 <b>ІСТОРІЯ РОБІТ</b>\n\n" +
        "Історія порожня.",
      adminMenu(),
    );

    return;
  }

  let text =
    "📚 <b>ІСТОРІЯ ВСІХ РОБІТ</b>\n\n";

  for (
    const work of data
  ) {
    const {
      data: application,
    } = await supabase
      .from("applications")
      .select(
        "application_number",
      )
      .eq(
        "id",
        work.application_id,
      )
      .maybeSingle();

    const {
      data: contractor,
    } = await supabase
      .from("contractors")
      .select(`
        first_name,
        last_name
      `)
      .eq(
        "id",
        work.contractor_id,
      )
      .maybeSingle();

    const name =
      contractor
        ? `${contractor.first_name || ""} ${
            contractor.last_name || ""
          }`.trim()
        : "Невідомий";

    text +=
      "━━━━━━━━━━━━━━\n";

    text +=
      `🔢 <b>${escapeHtml(
        application?.application_number ||
          "G-0000",
      )}</b>\n`;

    text +=
      `👤 ${escapeHtml(
        name,
      )}\n`;

    text +=
      `🏢 ${escapeHtml(
        work.title ||
          "Без назви",
      )}\n`;

    if (
      work.completed_at
    ) {
      text +=
        `📅 ${escapeHtml(
          new Date(
            work.completed_at,
          ).toLocaleString(
            "uk-UA",
            {
              timeZone:
                "Europe/Kyiv",
            },
          ),
        )}\n`;
    }
  }

  await sendMessage(
    chatId,
    text,
    adminMenu(),
  );
}

// =====================================================
// CONTRACTORS
// =====================================================

async function showAdminContractors(
  chatId: number,
) {
  const { data, error } = await supabase
    .from("contractors")
    .select(`
      id,
      telegram_id,
      first_name,
      last_name,
      username,
      phone,
      status,
      region_code,
      region_name
    `)
    .order("created_at", {
      ascending: false,
    })
    .limit(100);

  if (error) {
    console.error(
      "showAdminContractors:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося отримати підрядників.",
      adminMenu(),
    );
    return;
  }

  if (!data || data.length === 0) {
    await sendMessage(
      chatId,
      "👥 Підрядників немає.",
      adminMenu(),
    );
    return;
  }

  const pending = data.filter(
    (contractor: any) =>
      contractor.status === "pending",
  );

  if (pending.length > 0) {
    await sendMessage(
      chatId,
      `🆕 <b>Нові підрядники • ${pending.length}</b>\n━━━━━━━━━━━━━━━━\n\n` +
        "Підтвердіть або відхиліть доступ:",
    );

    for (const contractor of pending) {
      const name =
        `${contractor.first_name || ""} ${
          contractor.last_name || ""
        }`.trim() || "Без імені";

      let text =
        `👤 <b>${escapeHtml(name)}</b>\n` +
        `🆔 <code>${escapeHtml(
          contractor.telegram_id,
        )}</code>\n`;

      if (contractor.username) {
        text += `🔹 @${escapeHtml(
          contractor.username,
        )}\n`;
      }

      text += "⏳ Очікує підтвердження";

      const pendingKeyboard =
        contractor.region_code
          ? {
              inline_keyboard: [
                [
                  {
                    text: "✅ Підтвердити",
                    callback_data:
                      `approvecontractor:${contractor.id}`,
                  },
                  {
                    text: "❌ Відхилити",
                    callback_data:
                      `rejectcontractor:${contractor.id}`,
                  },
                ],
                [
                  {
                    text: "🌍 Змінити регіон",
                    callback_data:
                      `changeregion:${contractor.id}`,
                  },
                  {
                    text: "🗑 Видалити",
                    callback_data:
                      `deletecontractor:${contractor.id}`,
                  },
                ],
              ],
            }
          : {
              inline_keyboard: [
                [
                  {
                    text: "✅ Київ",
                    callback_data:
                      `approvewithregion:${contractor.id}:kyiv`,
                  },
                  {
                    text: "✅ Дніпро",
                    callback_data:
                      `approvewithregion:${contractor.id}:dnipro`,
                  },
                ],
                [
                  {
                    text: "❌ Відхилити",
                    callback_data:
                      `rejectcontractor:${contractor.id}`,
                  },
                  {
                    text: "🗑 Видалити",
                    callback_data:
                      `deletecontractor:${contractor.id}`,
                  },
                ],
              ],
            };

      await sendMessage(
        chatId,
        text +
          (contractor.region_code
            ? `\n🌍 ${escapeHtml(
                contractor.region_name ||
                  contractor.region_code,
              )}`
            : "\n🌍 Оберіть регіон для підтвердження"),
        pendingKeyboard,
      );
    }
  }

  const active = data.filter(
    (contractor: any) =>
      contractor.status === "active",
  );
  const rejected = data.filter(
    (contractor: any) =>
      contractor.status === "rejected",
  );
  const deleted = data.filter(
    (contractor: any) =>
      contractor.status === "deleted",
  );

  await sendMessage(
    chatId,
    "👥 <b>Підрядники</b>\n━━━━━━━━━━━━━━━━\n\n" +
      `✅ Активні: <b>${active.length}</b>\n` +
      `⏳ Очікують: <b>${pending.length}</b>\n` +
      `❌ Відхилені: <b>${rejected.length}</b>\n` +
      `🗑 Видалені: <b>${deleted.length}</b>`,
  );

  for (const contractor of active) {
    const name =
      `${contractor.first_name || ""} ${
        contractor.last_name || ""
      }`.trim() || "Без імені";

    let contractorText =
      `✅ <b>${escapeHtml(name)}</b>\n` +
      `📱 ${escapeHtml(contractor.phone || "Номер не вказано")}\n` +
      `🌍 ${escapeHtml(contractor.region_name || "Регіон не вказано")}`;

    if (contractor.username) {
      contractorText += `\n🔹 @${escapeHtml(contractor.username)}`;
    }

    await sendMessage(
      chatId,
      contractorText,
      {
        inline_keyboard: [
          [
            {
              text: "🌍 Змінити регіон",
              callback_data:
                `changeregion:${contractor.id}`,
            },
          ],
          [
            {
              text: "🗑 Видалити",
              callback_data:
                `deletecontractor:${contractor.id}`,
            },
          ],
        ],
      },
    );
  }

  for (const contractor of rejected) {
    const name =
      `${contractor.first_name || ""} ${
        contractor.last_name || ""
      }`.trim() || "Без імені";

    let contractorText =
      `❌ <b>${escapeHtml(name)}</b>\n` +
      `🆔 <code>${escapeHtml(contractor.telegram_id)}</code>\n` +
      "Статус: відхилений";

    if (contractor.username) {
      contractorText += `\n🔹 @${escapeHtml(contractor.username)}`;
    }

    await sendMessage(
      chatId,
      contractorText,
      {
        inline_keyboard: [
          [
            {
              text: "🗑 Видалити",
              callback_data:
                `deletecontractor:${contractor.id}`,
            },
          ],
        ],
      },
    );
  }

  await sendMessage(
    chatId,
    "Оберіть потрібну дію.",
    adminMenu(),
  );
}

// =====================================================
// STATS
// =====================================================

async function showStats(
  chatId: number,
) {
  const contractors =
    await supabase
      .from("contractors")
      .select("*", {
        count:
          "exact",
        head: true,
      });

  const applications =
    await supabase
      .from("applications")
      .select("*", {
        count:
          "exact",
        head: true,
      });

  const acts =
    await supabase
      .from("acts")
      .select("*", {
        count:
          "exact",
        head: true,
      });

  const history =
    await supabase
      .from("work_history")
      .select("*", {
        count:
          "exact",
        head: true,
      });

  await sendMessage(
    chatId,
    "📊 <b>СТАТИСТИКА</b>\n\n" +
      `👥 Підрядників: <b>${
        contractors.count ?? 0
      }</b>\n` +
      `📋 Заявок: <b>${
        applications.count ?? 0
      }</b>\n` +
      `📑 Актів: <b>${
        acts.count ?? 0
      }</b>\n` +
      `📚 Виконаних робіт: <b>${
        history.count ?? 0
      }</b>`,
    adminMenu(),
  );
}

// =====================================================
// MANAGER
// =====================================================

async function saveManagerMessage(
  chatId: number,
  telegramId: number,
  text: string,
) {
  const contractor =
    await getContractor(
      telegramId,
    );

  if (!contractor) {
    return;
  }

  const {
    error,
  } = await supabase
    .from("manager_contacts")
    .insert({
      contractor_id:
        contractor.id,

      message:
        text,
    });

  if (error) {
    console.error(
      "manager_contacts:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося відправити повідомлення.",
      mainMenu(telegramId),
    );

    return;
  }

  await sendMessage(
    chatId,
    "✅ Повідомлення відправлено менеджеру.",
    mainMenu(telegramId),
  );
}


// =====================================================
// ADMIN PAYOUTS
// =====================================================

async function showAdminPayouts(
  chatId: number,
) {
  const { data, error } =
    await supabase
      .from("applications")
      .select(`
        id,
        application_number,
        contractor_id,
        title,
        actual_volume,
        unit_price,
        payout_amount,
        payout_status,
        paid_at,
        updated_at
      `)
      .eq(
        "status",
        "completed",
      )
      .order(
        "updated_at",
        {
          ascending: false,
        },
      )
      .limit(100);

  if (error) {
    await sendMessage(
      chatId,
      "❌ Не вдалося отримати виплати.\n\n" +
        `<code>${escapeHtml(
          error.message,
        )}</code>`,
      adminMenu(),
    );
    return;
  }

  const pending =
    (data || []).filter(
      (app: any) =>
        app.payout_status !==
        "paid",
    );

  const paid =
    (data || []).filter(
      (app: any) =>
        app.payout_status ===
        "paid",
    );

  const pendingSum =
    pending.reduce(
      (
        sum: number,
        app: any,
      ) =>
        sum +
        Number(
          app.payout_amount ||
            0,
        ),
      0,
    );

  const paidSum =
    paid.reduce(
      (
        sum: number,
        app: any,
      ) =>
        sum +
        Number(
          app.payout_amount ||
            0,
        ),
      0,
    );

  const buttons: any[][] = [];

  for (
    const app of
      pending.slice(0, 30)
  ) {
    const { data: c } =
      await supabase
        .from("contractors")
        .select(
          "first_name,last_name",
        )
        .eq(
          "id",
          app.contractor_id,
        )
        .maybeSingle();

    const name =
      c
        ? `${c.first_name || ""} ${c.last_name || ""}`.trim()
        : "Підрядник";

    buttons.push([
      {
        text:
          `${Number(
            app.payout_amount ||
              0,
          ) > 0 ? "🟡" : "✏️"} ${app.application_number || "G-0000"} • ${name} • ${
            Number(
              app.payout_amount ||
                0,
            ) > 0
              ? `${Number(
                  app.payout_amount ||
                    0,
                ).toFixed(2)} грн`
              : "вкажіть суму"
          }`,
        callback_data:
          `payoutcard:${app.id}`,
      },
    ]);
  }

  if (
    buttons.length === 0
  ) {
    buttons.push([
      {
        text:
          "✅ Немає виплат в очікуванні",
        callback_data:
          "noop",
      },
    ]);
  }

  await sendMessage(
    chatId,
    "💰 <b>Виплати підрядникам</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `🟡 Очікують: <b>${pending.length}</b>\n` +
      `💵 До виплати: <b>${pendingSum.toFixed(2)} грн</b>\n\n` +
      `✅ Виплачено: <b>${paid.length}</b>\n` +
      `💳 Сума виплат: <b>${paidSum.toFixed(2)} грн</b>\n\n` +
      "Оберіть заявку. Якщо сума ще не вказана — спочатку встановіть її:",
    {
      inline_keyboard:
        buttons,
    },
  );
}

async function showAdminPayoutCard(
  chatId: number,
  applicationId: string,
) {
  const { data: app, error } =
    await supabase
      .from("applications")
      .select("*")
      .eq(
        "id",
        applicationId,
      )
      .maybeSingle();

  if (
    error ||
    !app
  ) {
    await sendMessage(
      chatId,
      "❌ Заявку не знайдено.",
      adminMenu(),
    );
    return;
  }

  const { data: contractor } =
    await supabase
      .from("contractors")
      .select(
        "first_name,last_name,phone,telegram_id",
      )
      .eq(
        "id",
        app.contractor_id,
      )
      .maybeSingle();

  const name =
    contractor
      ? `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim()
      : "Без імені";

  const amount =
    Number(
      app.payout_amount ||
        0,
    );

  let body =
    "💰 <b>Виплата по заявці</b>\n" +
    "━━━━━━━━━━━━━━━━\n\n" +
    `🔢 Заявка: <b>${escapeHtml(
      app.application_number ||
        "G-0000",
    )}</b>\n` +
    `👤 Підрядник: <b>${escapeHtml(
      name,
    )}</b>\n` +
    `📱 ${escapeHtml(
      contractor?.phone ||
        "Номер не вказано",
    )}\n` +
    `🏢 ${escapeHtml(
      app.title ||
        "Без назви",
    )}\n`;

  if (app.actual_volume) {
    body +=
      `📦 Об'єм: <b>${escapeHtml(
        app.actual_volume,
      )} м³</b>\n`;
  }

  if (app.unit_price) {
    body +=
      `💵 Тариф: <b>${Number(
        app.unit_price,
      ).toFixed(2)} грн/м³</b>\n`;
  }

  body +=
    `💰 До виплати: <b>${amount.toFixed(2)} грн</b>\n` +
    `📊 Статус: <b>${
      app.payout_status ===
        "paid"
        ? "✅ Виплачено"
        : "🟡 Очікує виплати"
    }</b>`;

  if (app.paid_at) {
    body +=
      `\n📅 Виплачено: <b>${escapeHtml(
        formatKyivDate(
          app.paid_at,
        ),
      )}</b>`;
  }

  const buttons: any[][] = [];

  if (
    app.payout_status !==
    "paid"
  ) {
    buttons.push([
      {
        text:
          amount > 0
            ? "✏️ Змінити суму"
            : "✏️ Встановити суму",
        callback_data:
          `payoutsetamount:${app.id}`,
      },
    ]);
  }

  if (
    app.payout_status !==
      "paid" &&
    amount > 0
  ) {
    buttons.push([
      {
        text:
          "✅ Підтвердити виплату",
        callback_data:
          `payoutconfirm:${app.id}`,
      },
    ]);
  }

  if (
    app.payout_receipt_file_id
  ) {
    buttons.push([
      {
        text:
          "🧾 Показати квитанцію",
        callback_data:
          `payoutreceipt:${app.id}`,
      },
    ]);
  }

  buttons.push([
    {
      text:
        "◀️ До виплат",
      callback_data:
        "payoutslist",
    },
  ]);

  await sendMessage(
    chatId,
    body,
    {
      inline_keyboard:
        buttons,
    },
  );
}

async function sendPayoutReceipt(
  chatId: number,
  app: any,
  caption?: string,
) {
  if (
    !app?.payout_receipt_file_id
  ) {
    return null;
  }

  const common = {
    chat_id:
      chatId,
    caption:
      caption ||
      "🧾 <b>Квитанція про виплату</b>",
    parse_mode:
      "HTML",
  };

  if (
    app.payout_receipt_type ===
    "photo"
  ) {
    return telegram(
      "sendPhoto",
      {
        ...common,
        photo:
          app.payout_receipt_file_id,
      },
    );
  }

  return telegram(
    "sendDocument",
    {
      ...common,
      document:
        app.payout_receipt_file_id,
    },
  );
}

// =====================================================
// BROADCAST
// =====================================================

async function broadcast(
  chatId: number,
  adminId: number,
  text: string,
) {
  const {
    data,
    error,
  } = await supabase
    .from("contractors")
    .select(
      "telegram_id",
    )
    .eq(
      "status",
      "active",
    );

  if (error) {
    console.error(
      "broadcast:",
      error,
    );

    await sendMessage(
      chatId,
      "❌ Помилка розсилки.",
      contractorAdminMenu(),
    );

    return;
  }

  let success = 0;
  let failed = 0;

  for (
    const contractor of
    data || []
  ) {
    try {
      const result =
        await telegram(
          "sendMessage",
          {
            chat_id:
              contractor.telegram_id,

            text:
              "📢 <b>Повідомлення від адміністратора</b>\n\n" +
              escapeHtml(text),

            parse_mode:
              "HTML",
          },
        );

      if (
        result?.ok
      ) {
        success++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  await clearSession(
    adminId,
  );

  await sendMessage(
    chatId,
    "📢 <b>Розсилка завершена</b>\n\n" +
      `✅ Відправлено: <b>${success}</b>\n` +
      `❌ Помилок: <b>${failed}</b>`,
    contractorAdminMenu(),
  );
}


// =====================================================
// WORK MANAGEMENT PRO
// =====================================================

const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_MESSAGES = 20;

function safeSearchValue(value: string): string {
  return value.replace(/[,%_]/g, " ").trim().slice(0, 80);
}

function mapsUrl(address: string | null | undefined): string | null {
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function formatKyivDate(value: string | null | undefined): string {
  if (!value) return "Не вказано";
  try {
    return new Date(value).toLocaleString("uk-UA", {
      timeZone: "Europe/Kyiv",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function kyivOffsetMinutes(date: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Kyiv",
      timeZoneName: "longOffset",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const name = parts.find((p) => p.type === "timeZoneName")?.value || "GMT+03:00";
    const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!match) return 180;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  } catch {
    return 180;
  }
}

function parseKyivDeadline(input: string): string | null {
  const value = input.trim();
  if (
    value.toLowerCase() === "пропуск" ||
    value === "-"
  ) return "";

  const m = value.match(
    /^(\d{2})[.\-/](\d{2})[.\-/](\d{4})\s+(\d{2}):(\d{2})$/,
  );
  if (!m) return null;

  const [, dd, mm, yyyy, hh, min] = m;
  const rough = new Date(Date.UTC(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    0,
  ));
  const offset = kyivOffsetMinutes(rough);
  const utc = new Date(rough.getTime() - offset * 60_000);
  if (Number.isNaN(utc.getTime())) return null;
  return utc.toISOString();
}

function generateActNumber(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `A-${y}${m}${d}-${suffix}`;
}

async function rateLimitAllowed(telegramId: number): Promise<boolean> {
  if (isAdmin(telegramId)) return true;

  const now = new Date();
  const { data } = await supabase
    .from("bot_rate_limits")
    .select("telegram_id,window_start,hits")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (!data) {
    await supabase.from("bot_rate_limits").upsert({
      telegram_id: telegramId,
      window_start: now.toISOString(),
      hits: 1,
    });
    return true;
  }

  const start = new Date(data.window_start || 0);
  const elapsed = (now.getTime() - start.getTime()) / 1000;

  if (elapsed >= RATE_LIMIT_WINDOW_SECONDS) {
    await supabase.from("bot_rate_limits").upsert({
      telegram_id: telegramId,
      window_start: now.toISOString(),
      hits: 1,
    });
    return true;
  }

  const hits = Number(data.hits || 0) + 1;
  await supabase
    .from("bot_rate_limits")
    .update({ hits })
    .eq("telegram_id", telegramId);

  return hits <= RATE_LIMIT_MAX_MESSAGES;
}

async function renderPage(
  chatId: number,
  messageId: number | null,
  body: string,
  keyboard: any[][],
) {
  const reply_markup = { inline_keyboard: keyboard };

  if (messageId) {
    const edited = await telegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: body,
      parse_mode: "HTML",
      reply_markup,
    });
    if (edited?.ok) return;
  }

  await sendMessage(chatId, body, reply_markup);
}

function navRow(prefix: string, page: number, total: number, extra = "") {
  const row: any[] = [];
  if (page > 0) {
    row.push({
      text: "⬅️",
      callback_data: `${prefix}:${page - 1}${extra}`,
    });
  }
  row.push({
    text: `${page + 1}/${Math.max(total, 1)}`,
    callback_data: "noop",
  });
  if (page < total - 1) {
    row.push({
      text: "➡️",
      callback_data: `${prefix}:${page + 1}${extra}`,
    });
  }
  return row;
}

async function showContractorsPaged(
  chatId: number,
  page = 0,
  messageId: number | null = null,
  filter: "all" | "deleted" | "pending" = "all",
) {
  let query = supabase
    .from("contractors")
    .select(`
      id,telegram_id,first_name,last_name,username,phone,status,rating,manager_notes,created_at
    `, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id");

  query = filter === "all" ? query.neq("status", "deleted") : query.eq("status", filter);
  const title = filter === "deleted" ? "🗑 Видалені підрядники"
    : filter === "pending" ? "⏳ Нові підрядники" : "👥 Підрядники";
  const switchList = filter === "all"
    ? { text: "🗑 Видалені", callback_data: "deletedpage:0" }
    : { text: "↩️ Усі підрядники", callback_data: "contractorspage:0" };

  const { data, error, count } = await query.range(page, page);
  if (error) {
    await sendMessage(chatId, `❌ ${escapeHtml(error.message)}`, adminMenu());
    return;
  }

  const total = count || 0;
  const c = data?.[0];
  if (!c) {
    await renderPage(
      chatId,
      messageId,
      `<b>${title}</b>\n━━━━━━━━━━━━━━━━\n\nСписок порожній.`,
      [[switchList]],
    );
    return;
  }

  const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Без імені";
  const status =
    c.status === "active" ? "✅ Активний" :
    c.status === "pending" ? "⏳ Очікує підтвердження" :
    c.status === "rejected" ? "❌ Відхилений" :
    c.status === "deleted" ? "🗑 Видалений" :
    String(c.status || "—");

  let body =
    `<b>${title}</b>\n` +
    "━━━━━━━━━━━━━━━━\n\n" +
    `👤 <b>${escapeHtml(name)}</b>\n` +
    `📱 ${escapeHtml(c.phone || "Номер не вказано")}\n`;

  if (c.username) body += `🔹 @${escapeHtml(c.username)}\n`;
  body += `📊 ${escapeHtml(status)}\n`;
  body += `⭐ Рейтинг: <b>${Number(c.rating || 0)}/5</b>\n\n`;
  body += `📄 Запис ${page + 1} із ${total}`;

  const kb: any[][] = [[
    { text: "👤 Картка", callback_data: `contractorcard:${c.id}` },
  ]];

  if (c.status === "pending") {
    kb.push([
      { text: "✅ Підтвердити", callback_data: `approvecontractor:${c.id}` },
      { text: "❌ Відхилити", callback_data: `rejectcontractor:${c.id}` },
    ]);
  } else if (c.status === "deleted") {
    kb.push([{ text: "♻️ Відновити", callback_data: `restorecontractor:${c.id}` }]);
  } else {
    kb.push([{ text: "🗑 Видалити", callback_data: `deletecontractor:${c.id}` }]);
  }

  const pageAction = filter === "deleted" ? "deletedpage"
    : filter === "pending" ? "pendingcontractors" : "contractorspage";
  kb.push(navRow(pageAction, page, total), [switchList]);

  await renderPage(chatId, messageId, body, kb);
}

async function showContractorCard(
  chatId: number,
  contractorId: string,
  messageId: number | null = null,
) {
  const { data: c, error } = await supabase
    .from("contractors")
    .select("*")
    .eq("id", contractorId)
    .maybeSingle();

  if (error || !c) {
    await sendMessage(chatId, "❌ Підрядника не знайдено.", adminMenu());
    return;
  }

  const activeApps = await supabase
    .from("applications")
    .select("*", { count: "exact", head: true })
    .eq("contractor_id", contractorId)
    .neq("status", "completed");

  const history = await supabase
    .from("work_history")
    .select("*", { count: "exact", head: true })
    .eq("contractor_id", contractorId);

  const acts = await supabase
    .from("acts")
    .select("*", { count: "exact", head: true })
    .eq("contractor_id", contractorId);

  const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Без імені";
  let body =
    "👤 <b>Картка підрядника</b>\n━━━━━━━━━━━━━━━━\n\n" +
    `👤 <b>${escapeHtml(name)}</b>\n` +
    `📱 ${escapeHtml(c.phone || "Номер не вказано")}\n`;

  if (c.username) body += `🔹 @${escapeHtml(c.username)}\n`;
  body +=
    `📊 Статус: <b>${escapeHtml(c.status || "—")}</b>\n` +
    `⭐ Рейтинг: <b>${Number(c.rating || 0)}/5</b>\n` +
    `📋 Активних заявок: <b>${activeApps.count || 0}</b>\n` +
    `✅ Виконаних робіт: <b>${history.count || 0}</b>\n` +
    `📑 Актів: <b>${acts.count || 0}</b>\n\n` +
    `📝 <b>Нотатка менеджера:</b>\n${escapeHtml(c.manager_notes || "Немає")}`;

  const ratingRow = [1, 2, 3, 4, 5].map((n) => ({
    text: `${n}⭐`,
    callback_data: `ratecontractor:${contractorId}:${n}`,
  }));

  const kb: any[][] = [
    ratingRow,
    [{ text: "📝 Змінити нотатку", callback_data: `notecontractor:${contractorId}` }],
  ];

  if (c.status === "deleted") {
    kb.push([{ text: "♻️ Відновити", callback_data: `restorecontractor:${contractorId}` }]);
  } else {
    kb.push([{ text: "🗑 Видалити", callback_data: `deletecontractor:${contractorId}` }]);
  }

  await renderPage(chatId, messageId, body, kb);
}

async function searchContractors(chatId: number, queryText: string) {
  const q = safeSearchValue(queryText);
  if (!q) {
    await sendMessage(chatId, "❗ Введіть ім'я або номер телефону.", contractorAdminMenu());
    return;
  }

  const { data, error } = await supabase
    .from("contractors")
    .select("id,first_name,last_name,username,phone,status")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%,username.ilike.%${q}%`)
    .limit(20);

  if (error) {
    await sendMessage(chatId, `❌ ${escapeHtml(error.message)}`, contractorAdminMenu());
    return;
  }

  if (!data?.length) {
    await sendMessage(chatId, "🔎 Нічого не знайдено.", contractorAdminMenu());
    return;
  }

  const kb = data.map((c: any) => {
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Без імені";
    return [{
      text: `👤 ${name} • ${c.phone || "без номера"}`,
      callback_data: `contractorcard:${c.id}`,
    }];
  });

  await sendMessage(chatId, "👥 Підрядники", contractorAdminMenu());
  await sendMessage(
    chatId,
    `🔎 <b>Знайдено: ${data.length}</b>\n━━━━━━━━━━━━━━━━\n\nОберіть підрядника:`,
    { inline_keyboard: kb },
  );
}

async function searchApplications(
  chatId: number,
  queryText: string,
) {
  const raw =
    String(
      queryText ||
        "",
    ).trim();

  const q =
    safeSearchValue(
      raw,
    );

  if (!q) {
    await sendMessage(
      chatId,
      "❗ Введіть номер заявки, телефон підрядника, мережу або код АЗК.",
      adminMenu(),
    );
    return;
  }

  const normalizedPhone =
    raw.replace(
      /[^\d+]/g,
      "",
    );

  const looksLikeApplication =
    /^G[-\s]?\d+/i.test(
      raw,
    );

  const phoneDigitsQuery =
    normalizedPhone.replace(
      /\D/g,
      "",
    );

  const looksLikePhone =
    phoneDigitsQuery.length >= 4;

  const azkMatch =
    raw.match(
      /(?:АЗК|АЗС)\s*(?:№|#|:|-)?\s*([A-Za-zА-Яа-яІіЇїЄє0-9_-]+)/i,
    );

  const azkCode =
    azkMatch?.[1] ||
    (
      !looksLikeApplication &&
      /^[A-Za-zА-Яа-яІіЇїЄє0-9_-]{1,20}$/.test(
        raw,
      )
        ? raw
        : ""
    );

  const network = !looksLikeApplication
    ? raw.match(/^(?:мережа\s*[: ]\s*)?([\p{L}][\p{L}\d-]{0,29})$/iu)?.[1]
    : undefined;
  const numericAzk = /^\d{1,20}$/.test(azkCode);

  const found = new Map<
    string,
    any
  >();

  // ---------------------------------------------------
  // 1. Номер заявки: G-4315
  // ---------------------------------------------------

  if (
    looksLikeApplication ||
    /^G/i.test(raw)
  ) {
    const applicationQuery =
      raw
        .toUpperCase()
        .replace(/\s+/g, "");

    const {
      data,
      error,
    } = await supabase
      .from("applications")
      .select(`
        id,
        application_number,
        title,
        status,
        contractor_id,
        deadline_at,
        address,
        manager_comment,
        azk_code,
        order_date_text,
        created_at
      `)
      .ilike(
        "application_number",
        `%${applicationQuery}%`,
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(30);

    if (error) {
      await sendMessage(
        chatId,
        `❌ ${escapeHtml(
          error.message,
        )}`,
        adminMenu(),
      );
      return;
    }

    for (const app of data || []) {
      found.set(
        app.id,
        app,
      );
    }
  }

  // ---------------------------------------------------
  // 2. Телефон подрядчика
  // ---------------------------------------------------

  if (looksLikePhone && !azkMatch && !looksLikeApplication) {
    const digits =
      phoneDigitsQuery;

    // Шукаємо по введеній частині номера.
    // Працює для +380..., 067..., будь-якої середини
    // та останніх 4 цифр, наприклад 5140.
    const phoneTail =
      digits;

    const {
      data: contractors,
      error:
        contractorError,
    } = await supabase
      .from("contractors")
      .select(
        "id,first_name,last_name,phone",
      )
      .ilike(
        "phone",
        `%${phoneTail}%`,
      )
      .limit(20);

    if (contractorError) {
      await sendMessage(
        chatId,
        `❌ ${escapeHtml(
          contractorError.message,
        )}`,
        adminMenu(),
      );
      return;
    }

    const contractorIds =
      (contractors || [])
        .map(
          (c: any) =>
            c.id,
        )
        .filter(Boolean);

    if (
      contractorIds.length >
      0
    ) {
      const {
        data,
        error,
      } = await supabase
        .from("applications")
        .select(`
          id,
          application_number,
          title,
          status,
          contractor_id,
          deadline_at,
          address,
          manager_comment,
          azk_code,
          order_date_text,
          created_at
        `)
        .in(
          "contractor_id",
          contractorIds,
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        )
        .limit(50);

      if (error) {
        await sendMessage(
          chatId,
          `❌ ${escapeHtml(
            error.message,
          )}`,
          adminMenu(),
        );
        return;
      }

      for (const app of data || []) {
        found.set(
          app.id,
          app,
        );
      }
    }
  }

  // ---------------------------------------------------
  // 3. Код АЗК / АЗС: 189, АЗК 189, АЗС 189
  // ---------------------------------------------------

  if (azkCode) {
    const cleanAzk =
      safeSearchValue(
        azkCode,
      );

    // Новые заявки — по отдельному полю azk_code.
    const azkFieldQuery = supabase
      .from("applications")
      .select(`
        id,
        application_number,
        title,
        status,
        contractor_id,
        deadline_at,
        address,
        manager_comment,
        azk_code,
        order_date_text,
        created_at
      `)
    const {
      data: byAzkField,
      error: azkFieldError,
    } = await (numericAzk
      ? azkFieldQuery.eq("azk_code",cleanAzk)
      : azkFieldQuery.ilike("azk_code",`%${cleanAzk}%`))
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(50);

    if (
      azkFieldError &&
      !String(
        azkFieldError.message ||
          "",
      ).includes(
        "azk_code",
      )
    ) {
      await sendMessage(
        chatId,
        `❌ ${escapeHtml(
          azkFieldError.message,
        )}`,
        adminMenu(),
      );
      return;
    }

    for (
      const app of
        byAzkField || []
    ) {
      found.set(
        app.id,
        app,
      );
    }

    // Старі заявки можуть зберігати код у назві об’єкта або тексті замовника.
    const legacyAzk = `(АЗК|АЗС|АГЗС)[[:space:]:№#-]+([[:alpha:]][[:alnum:]_-]*[[:space:]]+[№#]?[[:space:]]*)?${cleanAzk}([^[:alnum:]_-]|$)`;
    const legacyFilter = numericAzk
      ? `title.imatch."${legacyAzk}",customer_raw_text.imatch."${legacyAzk}"`
      : `title.ilike.%АЗК ${cleanAzk}%,title.ilike.%АЗС ${cleanAzk}%`;
    const {
      data: byTitle,
      error:
        titleError,
    } = await supabase
      .from("applications")
      .select(`
        id,
        application_number,
        title,
        status,
        contractor_id,
        deadline_at,
        address,
        manager_comment,
        azk_code,
        order_date_text,
        created_at
      `)
      .or(legacyFilter)
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(50);

    if (titleError) {
      await sendMessage(
        chatId,
        `❌ ${escapeHtml(
          titleError.message,
        )}`,
        adminMenu(),
      );
      return;
    }

    for (const app of byTitle || []) {
      found.set(
        app.id,
        app,
      );
    }
  }

  if (network) {
    const word = `(^|[^[:alnum:]_-])${network}([^[:alnum:]_-]|$)`;
    const { data, error } = await supabase.from("applications")
      .select("id,application_number,title,status,contractor_id,deadline_at,address,manager_comment,azk_code,order_date_text,created_at")
      .or(`title.imatch."${word}",customer_raw_text.imatch."${word}"`)
      .order("created_at",{ascending:false}).limit(50);
    if (error) {
      await sendMessage(chatId,`❌ ${escapeHtml(error.message)}`,adminMenu());
      return;
    }
    for (const app of data || []) found.set(app.id,app);
  }

  // Если формат непонятный — дополнительно пробуем номер заявки.
  if (
    found.size === 0 &&
    !looksLikePhone &&
    !azkCode
  ) {
    const { data } =
      await supabase
        .from("applications")
        .select(`
          id,
          application_number,
          title,
          status,
          contractor_id,
          deadline_at,
          address,
          manager_comment,
          azk_code,
          order_date_text,
          created_at
        `)
        .ilike(
          "application_number",
          `%${q.toUpperCase()}%`,
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        )
        .limit(30);

    for (const app of data || []) {
      found.set(
        app.id,
        app,
      );
    }
  }

  const results =
    Array.from(
      found.values(),
    )
      .sort(
        (
          a: any,
          b: any,
        ) =>
          new Date(
            b.created_at ||
              0,
          ).getTime() -
          new Date(
            a.created_at ||
              0,
          ).getTime(),
      )
      .slice(
        0,
        50,
      );

  if (
    results.length ===
    0
  ) {
    await sendMessage(
      chatId,
      "🔎 <b>Нічого не знайдено</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        "Спробуйте:\n" +
        "• <code>G-4315</code> — номер заявки\n" +
        "• <code>+380XXXXXXXXX</code> — повний телефон\n" +
        "• <code>5140</code> — останні 4 цифри телефону\n" +
        "• <code>189</code> або <code>АЗК 189</code> — код АЗК\n" +
        "• <code>WOG</code> або <code>UPG</code> — мережа",
      adminMenu(),
    );
    return;
  }

  const kb: any[][] = [];

  for (const app of results) {
    const {
      data: contractor,
    } = await supabase
      .from("contractors")
      .select(
        "first_name,last_name,phone",
      )
      .eq(
        "id",
        app.contractor_id,
      )
      .maybeSingle();

    const contractorName =
      contractor
        ? `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim()
        : "";

    const title = String(app.title || "").trim();
    const object = /(?:АЗК|АЗС|АГЗС)/iu.test(title) ? title :
      app.azk_code ? `АЗК ${app.azk_code}` : title;
    let buttonText = `📋 ${app.application_number || "G-0000"}`;
    if (object) buttonText += ` • ${object}`;

    if (contractorName) {
      buttonText +=
        ` • ${contractorName}`;
    }

    // Telegram ограничивает текст кнопки; держим компактно.
    buttonText =
      buttonText.slice(
        0,
        60,
      );

    kb.push([
      {
        text:
          buttonText,
        callback_data:
          `applicationcard:${app.id}`,
      },
    ]);
  }

  await sendMessage(
    chatId,
    "🔎 <b>Результати пошуку</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `Знайдено: <b>${results.length}</b>\n` +
      `Запит: <code>${escapeHtml(
        raw,
      )}</code>\n\n` +
      "Оберіть потрібну заявку 👇",
    {
      inline_keyboard:
        kb,
    },
  );
}

async function showApplicationCard(
  chatId: number,
  applicationId: string,
  messageId: number | null = null,
) {
  const { data: a, error } = await supabase
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();

  if (error || !a) {
    await sendMessage(chatId, "❌ Заявку не знайдено.", adminMenu());
    return;
  }

  const { data: c } = await supabase
    .from("contractors")
    .select("first_name,last_name,phone")
    .eq("id", a.contractor_id)
    .maybeSingle();

  const name = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Не вказано";
  const overdue = !!a.deadline_at &&
    new Date(a.deadline_at).getTime() < Date.now() &&
    a.status !== "completed";

  let body =
    "📋 <b>Картка заявки</b>\n━━━━━━━━━━━━━━━━\n\n" +
    `🔢 <b>${escapeHtml(a.application_number || "G-0000")}</b>\n` +
    `🏢 ${escapeHtml(a.title || "Без назви")}\n` +
    `🔧 ${escapeHtml(a.description || "Не вказано")}\n` +
    `👤 ${escapeHtml(name || "Не вказано")}\n` +
    `📱 ${escapeHtml(c?.phone || "Номер не вказано")}\n` +
    `📊 ${escapeHtml(getApplicationStatusText(a.status || "new"))}\n` +
    `⏰ Дедлайн: <b>${escapeHtml(formatKyivDate(a.deadline_at))}</b>\n`;

  if (overdue) body += "🚨 <b>ПРОСТРОЧЕНО</b>\n";
  if (a.address) body += `📍 ${escapeHtml(a.address)}\n`;
  if (a.manager_comment) {
    body += `\n📝 <b>Коментар менеджера:</b>\n${escapeHtml(a.manager_comment)}\n`;
  }

  const kb: any[][] = [[
    { text: "📑 Акти заявки", callback_data: `applicationacts:${a.id}` },
  ]];

  const original = typeof a.customer_raw_text === "string" ? a.customer_raw_text : "";
  if (chatId > 0 && original.trim()) {
    const originalBlock = `\n📝 <b>Оригінал заявки:</b>\n${escapeHtml(original)}`;
    if (body.length + originalBlock.length <= 3900) body += originalBlock;
    else kb.push([{ text: "📝 Оригінал заявки", callback_data: `applicationoriginal:${a.id}` }]);
  }

  const url = mapsUrl(a.address);
  if (url) kb.push([{ text: "📍 Відкрити адресу", url }]);

  await renderPage(chatId, messageId, body, kb);
}

async function showOriginalApplication(chatId: number, applicationId: string) {
  const { data, error } = await supabase.from("applications")
    .select("customer_raw_text").eq("id",applicationId).maybeSingle();
  if (error || typeof data?.customer_raw_text !== "string" || !data.customer_raw_text.trim()) {
    await sendMessage(chatId,"Оригінал заявки недоступний.",adminMenu());
    return;
  }
  const original = Array.from(data.customer_raw_text);
  for (let i=0; i<original.length; i+=1800) {
    await telegram("sendMessage",{chat_id:chatId,text:original.slice(i,i+1800).join("")});
  }
}

async function showApplicationsFiltered(
  chatId: number,
  filter = "all",
  page = 0,
  messageId: number | null = null,
) {
  let query = supabase
    .from("applications")
    .select("id,application_number,title,status,deadline_at,contractor_id,created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  const now = new Date().toISOString();
  if (filter === "new") query = query.in("status", ["new", "assigned"]);
  if (filter === "in_progress") query = query.eq("status", "in_progress");
  if (filter === "completed") query = query.eq("status", "completed");
  if (filter === "overdue") {
    query = query.lt("deadline_at", now).neq("status", "completed");
  }

  const { data, error, count } = await query.range(page, page);
  if (error) {
    await sendMessage(chatId, `❌ ${escapeHtml(error.message)}`, adminMenu());
    return;
  }

  const total = count || 0;
  const a = data?.[0];

  if (!a) {
    await renderPage(
      chatId,
      messageId,
      "📋 <b>Заявки</b>\n━━━━━━━━━━━━━━━━\n\nЗа цим фільтром заявок немає.",
      [[
        { text: "🆕 Нові", callback_data: "appfilter:new:0" },
        { text: "🟡 В роботі", callback_data: "appfilter:in_progress:0" },
      ],[
        { text: "✅ Завершені", callback_data: "appfilter:completed:0" },
        { text: "🚨 Прострочені", callback_data: "appfilter:overdue:0" },
      ],[
        { text: "📋 Усі", callback_data: "appfilter:all:0" },
      ]],
    );
    return;
  }

  const overdue = !!a.deadline_at &&
    new Date(a.deadline_at).getTime() < Date.now() &&
    a.status !== "completed";

  const body =
    `📋 <b>Заявки • ${escapeHtml(filter)}</b>\n━━━━━━━━━━━━━━━━\n\n` +
    `🔢 <b>${escapeHtml(a.application_number || "G-0000")}</b>\n` +
    `🏢 ${escapeHtml(a.title || "Без назви")}\n` +
    `📊 ${escapeHtml(getApplicationStatusText(a.status || "new"))}\n` +
    `⏰ ${escapeHtml(formatKyivDate(a.deadline_at))}\n` +
    (overdue ? "🚨 <b>ПРОСТРОЧЕНО</b>\n" : "") +
    `\n📄 Запис ${page + 1} із ${total}`;

  const kb: any[][] = [[
    { text: "🔎 Відкрити", callback_data: `applicationcard:${a.id}` },
  ],[
    { text: "🆕", callback_data: "appfilter:new:0" },
    { text: "🟡", callback_data: "appfilter:in_progress:0" },
    { text: "✅", callback_data: "appfilter:completed:0" },
    { text: "🚨", callback_data: "appfilter:overdue:0" },
    { text: "📋", callback_data: "appfilter:all:0" },
  ]];

  const extra = `:${filter}`;
  kb.push(navRow("appspage", page, total, extra));

  await renderPage(chatId, messageId, body, kb);
}

async function showActsPaged(
  chatId: number,
  page = 0,
  messageId: number | null = null,
) {
  const { data, error, count } = await supabase
    .from("acts")
    .select("id,contractor_id,application_id,act_number,act_date,file_name,status,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page, page);

  if (error) {
    await sendMessage(chatId, `❌ ${escapeHtml(error.message)}`, adminMenu());
    return;
  }

  const total = count || 0;
  const act = data?.[0];
  if (!act) {
    await renderPage(chatId, messageId, "📑 <b>Акти</b>\n━━━━━━━━━━━━━━━━\n\nАктів немає.", []);
    return;
  }

  const { data: app } = await supabase
    .from("applications")
    .select(`
      application_number,
      title,
      description,
      address,
      actual_volume,
      deadline_at,
      manager_comment
    `)
    .eq("id", act.application_id)
    .maybeSingle();

  const body =
    "📑 <b>Акти</b>\n━━━━━━━━━━━━━━━━\n\n" +
    `🧾 <b>${escapeHtml(act.act_number || "Без номера")}</b>\n` +
    `📅 ${escapeHtml(formatKyivDate(act.act_date || act.created_at))}\n` +
    `🔢 ${escapeHtml(app?.application_number || "G-0000")}\n` +
    `🏢 ${escapeHtml(app?.title || "Без назви")}\n` +
    `📊 ${escapeHtml(getActStatusText(act.status))}\n\n` +
    `📄 Запис ${page + 1} із ${total}`;

  const kb: any[][] = [[
    { text: "📎 Відкрити", callback_data: `openact:${act.id}` },
  ]];
  if (act.status === "pending") {
    kb.push([
      { text: "✅ Підтвердити", callback_data: `approveact:${act.id}` },
      { text: "❌ Відхилити", callback_data: `rejectact:${act.id}` },
    ]);
  }
  kb.push(navRow("actspage", page, total));

  await renderPage(chatId, messageId, body, kb);
}

async function showHistoryPaged(
  chatId: number,
  page = 0,
  messageId: number | null = null,
) {
  const { data, error, count } = await supabase
    .from("work_history")
    .select("id,application_id,contractor_id,title,description,completed_at", { count: "exact" })
    .order("completed_at", { ascending: false })
    .range(page, page);

  if (error) {
    await sendMessage(chatId, `❌ ${escapeHtml(error.message)}`, adminMenu());
    return;
  }

  const total = count || 0;
  const w = data?.[0];
  if (!w) {
    await renderPage(chatId, messageId, "📚 <b>Історія робіт</b>\n━━━━━━━━━━━━━━━━\n\nІсторія порожня.", []);
    return;
  }

  const { data: app } = await supabase
    .from("applications")
    .select("application_number")
    .eq("id", w.application_id)
    .maybeSingle();

  const { data: c } = await supabase
    .from("contractors")
    .select("first_name,last_name")
    .eq("id", w.contractor_id)
    .maybeSingle();

  const name = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Невідомий";
  const body =
    "📚 <b>Історія робіт</b>\n━━━━━━━━━━━━━━━━\n\n" +
    `🔢 <b>${escapeHtml(app?.application_number || "G-0000")}</b>\n` +
    `👤 ${escapeHtml(name || "Невідомий")}\n` +
    `🏢 ${escapeHtml(w.title || "Без назви")}\n` +
    (w.description ? `🔧 ${escapeHtml(w.description)}\n` : "") +
    `📅 ${escapeHtml(formatKyivDate(w.completed_at))}\n\n` +
    `📄 Запис ${page + 1} із ${total}`;

  await renderPage(chatId, messageId, body, [navRow("historypage", page, total)]);
}

async function showStatsPro(chatId: number) {
  const now = new Date();

  const startDay = new Date(now);
  startDay.setUTCHours(0, 0, 0, 0);

  const startWeek = new Date(now);
  startWeek.setUTCDate(now.getUTCDate() - 7);

  const startMonth = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      1,
    ),
  );

  async function countAppsSince(iso: string) {
    const result = await supabase
      .from("applications")
      .select("*", {
        count: "exact",
        head: true,
      })
      .gte("created_at", iso);

    if (result.error) {
      console.error(
        "countAppsSince:",
        result.error,
      );
    }

    return result.count ?? 0;
  }

  const [
    day,
    week,
    month,
    total,
    completed,
    pendingActs,
    rejectedActs,
    overdue,
    contractors,
  ] = await Promise.all([
    countAppsSince(
      startDay.toISOString(),
    ),

    countAppsSince(
      startWeek.toISOString(),
    ),

    countAppsSince(
      startMonth.toISOString(),
    ),

    supabase
      .from("applications")
      .select("*", {
        count: "exact",
        head: true,
      }),

    supabase
      .from("applications")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "status",
        "completed",
      ),

    supabase
      .from("acts")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "status",
        "pending",
      ),

    supabase
      .from("acts")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "status",
        "rejected",
      ),

    supabase
      .from("applications")
      .select("*", {
        count: "exact",
        head: true,
      })
      .lt(
        "deadline_at",
        now.toISOString(),
      )
      .neq(
        "status",
        "completed",
      ),

    supabase
      .from("contractors")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "status",
        "active",
      ),
  ]);

  const errors = [
    total.error,
    completed.error,
    pendingActs.error,
    rejectedActs.error,
    overdue.error,
    contractors.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    console.error(
      "STATS ERRORS:",
      errors,
    );

    await sendMessage(
      chatId,
      "❌ Не вдалося завантажити статистику.\n\n" +
        `<code>${escapeHtml(
          (errors[0] as any)?.message ||
            "Невідома помилка",
        )}</code>`,
      adminMenu(),
    );

    return;
  }

  await sendMessage(
    chatId,
    "📊 <b>Статистика</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `📅 Нових сьогодні: <b>${day}</b>\n` +
      `🗓 За 7 днів: <b>${week}</b>\n` +
      `📆 За місяць: <b>${month}</b>\n\n` +
      `📋 Всього заявок: <b>${total.count ?? 0}</b>\n` +
      `✅ Завершено: <b>${completed.count ?? 0}</b>\n` +
      `🚨 Прострочено: <b>${overdue.count ?? 0}</b>\n\n` +
      `👥 Активних підрядників: <b>${contractors.count ?? 0}</b>\n` +
      `⏳ Актів на перевірці: <b>${pendingActs.count ?? 0}</b>\n` +
      `❌ Актів відхилено: <b>${rejectedActs.count ?? 0}</b>`,
    adminMenu(),
  );
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}

async function sendCsvDocument(
  chatId: number,
  filename: string,
  csv: string,
  caption: string,
) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append(
    "document",
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    filename,
  );

  const response = await fetch(`${TELEGRAM_API}/sendDocument`, {
    method: "POST",
    body: form,
  });
  return response.json();
}

async function exportCompletedCsv(chatId: number) {
  const { data: history, error } = await supabase
    .from("work_history")
    .select("application_id,contractor_id,title,description,completed_at")
    .order("completed_at", { ascending: false })
    .limit(5000);

  if (error) {
    await sendMessage(chatId, `❌ ${escapeHtml(error.message)}`, adminMenu());
    return;
  }

  const rows = [
    ["Заявка", "Підрядник", "Телефон", "Робота", "Опис", "Дата завершення"],
  ];

  for (const w of history || []) {
    const { data: app } = await supabase
      .from("applications")
      .select("application_number")
      .eq("id", w.application_id)
      .maybeSingle();

    const { data: c } = await supabase
      .from("contractors")
      .select("first_name,last_name,phone")
      .eq("id", w.contractor_id)
      .maybeSingle();

    const name = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "";
    rows.push([
      app?.application_number || "",
      name,
      c?.phone || "",
      w.title || "",
      w.description || "",
      formatKyivDate(w.completed_at),
    ]);
  }

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  await sendCsvDocument(
    chatId,
    `work_report_${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
    "📤 Звіт по виконаних роботах",
  );
}

function extractTelegramFile(message: any) {
  if (message?.document?.file_id) {
    return {
      fileId: message.document.file_id as string,
      fileType: "document",
      fileName: message.document.file_name || "document",
    };
  }

  if (message?.photo?.length) {
    const p = message.photo[message.photo.length - 1];
    return {
      fileId: p.file_id as string,
      fileType: "photo",
      fileName: "photo.jpg",
    };
  }

  return null;
}

async function startMultiActUpload(
  chatId: number,
  telegramId: number,
  applicationId: string,
) {
  const contractor = await getContractor(telegramId);
  if (!contractor) return;

  const { data: app } = await supabase
    .from("applications")
    .select("id,application_number,contractor_id,title,status")
    .eq("id", applicationId)
    .maybeSingle();

  if (!app || app.contractor_id !== contractor.id || app.status === "completed") {
    await sendMessage(chatId, "❌ Заявка недоступна.", mainMenu(telegramId));
    return;
  }

  await setSession(telegramId, `waiting_act_start:${applicationId}`);
  await sendMessage(
    chatId,
    `📸 <b>${escapeHtml(app.application_number || "G-0000")}</b> — надішліть фото або PDF акта.\n\nПісля відправки бот сам завершить заявку.`,
    cancelMenu(),
  );
}

async function addActFile(
  message: any,
  contractor: any,
  applicationId: string,
  actId: string | null,
) {
  const file = extractTelegramFile(message);
  if (!file) return { ok: false, actId };

  let currentActId = actId;

  if (!currentActId) {
    const actNumber = generateActNumber();
    const { data: act, error } = await supabase
      .from("acts")
      .insert({
        contractor_id: contractor.id,
        application_id: applicationId,
        telegram_file_id: file.fileId,
        file_type: file.fileType,
        file_name: file.fileName,
        act_number: actNumber,
        act_date: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !act) {
      console.error("CREATE MULTI ACT:", error);
      return { ok: false, actId: null };
    }
    currentActId = act.id;
  }

  const { error: fileError } = await supabase
    .from("act_files")
    .insert({
      act_id: currentActId,
      telegram_file_id: file.fileId,
      file_type: file.fileType,
      file_name: file.fileName,
    });

  if (fileError) {
    console.error("ADD ACT FILE:", fileError);
    return { ok: false, actId: currentActId };
  }

  const { count } = await supabase
    .from("act_files")
    .select("*", { count: "exact", head: true })
    .eq("act_id", currentActId);

  return { ok: true, actId: currentActId, count: count || 1 };
}

async function finalizeMultiAct(
  chatId: number,
  telegramId: number,
  actId: string,
) {
  const { data: act, error } =
    await supabase
      .from("acts")
      .select("*")
      .eq(
        "id",
        actId,
      )
      .maybeSingle();

  if (error || !act) {
    await sendMessage(
      chatId,
      "❌ Акт не знайдено.",
      mainMenu(
        telegramId,
      ),
    );
    return;
  }

  // Підрядника беремо саме з акта/заявки,
  // а не лише за Telegram ID поточного користувача.
  const { data: app, error: appError } =
    await supabase
      .from("applications")
      .select(`
        id,
        application_number,
        contractor_id,
        title,
        description,
        address,
        azk_code,
        order_date_text
      `)
      .eq(
        "id",
        act.application_id,
      )
      .maybeSingle();

  if (
    appError ||
    !app
  ) {
    await sendMessage(
      chatId,
      "❌ Не вдалося отримати дані заявки.",
      mainMenu(
        telegramId,
      ),
    );
    return;
  }

  if (
    app.contractor_id !==
    act.contractor_id
  ) {
    console.error(
      "ACT CONTRACTOR MISMATCH",
      {
        actId,
        actContractor:
          act.contractor_id,
        appContractor:
          app.contractor_id,
      },
    );

    await sendMessage(
      chatId,
      "❌ Акт не відповідає підряднику цієї заявки.",
      mainMenu(
        telegramId,
      ),
    );
    return;
  }

  const {
    data: contractor,
    error:
      contractorError,
  } = await supabase
    .from("contractors")
    .select("*")
    .eq(
      "id",
      app.contractor_id,
    )
    .maybeSingle();

  if (
    contractorError ||
    !contractor
  ) {
    await sendMessage(
      chatId,
      "❌ Підрядника для цієї заявки не знайдено.",
      mainMenu(
        telegramId,
      ),
    );
    return;
  }

  const {
    data: files,
    error: filesError,
  } = await supabase
    .from("act_files")
    .select("*")
    .eq(
      "act_id",
      actId,
    )
    .order(
      "created_at",
      {
        ascending:
          true,
      },
    );

  if (
    filesError ||
    !files?.length
  ) {
    await sendMessage(
      chatId,
      "❌ У акті немає файлів для відправки.",
      actUploadMenu(),
    );
    return;
  }

  const name =
    `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
    "Невідомий";

  const regionTopic =
    await getRegionTopic(
      contractor.region_code,
    );

  const threadId =
    regionTopic?.message_thread_id
      ? Number(
          regionTopic.message_thread_id,
        )
      : null;

  console.log(
    "ACT GROUP ROUTING",
    JSON.stringify({
      actId,
      contractorId:
        contractor.id,
      contractorRegion:
        contractor.region_code,
      topicThreadId:
        threadId,
      groupChatId:
        GROUP_CHAT_ID,
    }),
  );

  // Відправляємо з fallback:
  // 1) тема регіону, якщо є;
  // 2) основна група без thread_id.
  async function sendToWorkGroup(
    method:
      | "sendPhoto"
      | "sendDocument"
      | "sendMessage",
    payload: Record<
      string,
      unknown
    >,
  ) {
    if (threadId) {
      const topicResult =
        await telegram(
          method,
          {
            chat_id:
              GROUP_CHAT_ID,
            message_thread_id:
              threadId,
            ...payload,
          },
        );

      if (
        topicResult?.ok
      ) {
        return topicResult;
      }

      console.error(
        "SEND TO REGION TOPIC FAILED:",
        JSON.stringify(
          topicResult,
        ),
      );
    }

    const rootResult =
      await telegram(
        method,
        {
          chat_id:
            GROUP_CHAT_ID,
          ...payload,
        },
      );

    if (
      !rootResult?.ok
    ) {
      console.error(
        "SEND TO WORK GROUP FAILED:",
        JSON.stringify(
          rootResult,
        ),
      );
    }

    return rootResult;
  }

  // В робочій групі тримаємо мінімум повідомлень:
  // один акт = один файл/фото з коротким підписом та кнопками перевірки.
  // Якщо підрядник завантажив кілька файлів, усі вони залишаються в БД,
  // а в Telegram показуємо перший як обкладинку акта.
  const primaryFile = files[0];
  const extraFilesCount = Math.max(0, files.length - 1);

  const shortValue = (value: unknown, max = 180) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  let caption =
    `📑 <b>${escapeHtml(shortValue(act.act_number || "Акт", 60))}</b>` +
    ` • <b>${escapeHtml(shortValue(app.application_number || "G-0000", 40))}</b>\n`;

  if (app.title) caption += `🏢 ${escapeHtml(shortValue(app.title))}\n`;
  if (app.address) caption += `📍 ${escapeHtml(shortValue(app.address))}\n`;
  if (app.description) caption += `🔧 ${escapeHtml(shortValue(app.description))}\n`;
  if (app.order_date_text) caption += `📅 ${escapeHtml(shortValue(app.order_date_text, 100))}\n`;

  caption += `👤 ${escapeHtml(shortValue(name, 100))}\n`;
  if (extraFilesCount > 0) {
    caption += `📎 Ще файлів у системі: <b>${extraFilesCount}</b>\n`;
  }
  if(act.service_report) caption += `📊 ${act.service_report.volume===null?"Без відкачки":`${act.service_report.volume} м³`} · ${escapeHtml(act.service_report.work_date)}\n`;
  caption += `⏳ <b>Очікує перевірки</b>`;

  const groupMessage =
    primaryFile.file_type === "document"
      ? await sendToWorkGroup(
          "sendDocument",
          {
            document: primaryFile.telegram_file_id,
            caption,
            parse_mode: "HTML",
            reply_markup: actPendingKeyboard(actId),
          },
        )
      : await sendToWorkGroup(
          "sendPhoto",
          {
            photo: primaryFile.telegram_file_id,
            caption,
            parse_mode: "HTML",
            reply_markup: actPendingKeyboard(actId),
          },
        );

  if (!groupMessage?.ok) {
    const details = groupMessage?.description || "Telegram не прийняв файл акта.";
    await sendMessage(
      chatId,
      "❌ <b>Акт збережено, але не вдалося відправити його в робочу групу.</b>\n\n" +
        `Причина: <code>${escapeHtml(details)}</code>`,
      actUploadMenu(),
    );
    return;
  }

  const groupMessageId = groupMessage.result?.message_id || null;

  const { error: saveGroupError } = await supabase
    .from("acts")
    .update({
      group_chat_id: GROUP_CHAT_ID,
      group_message_id: groupMessageId,
    })
    .eq("id", actId);

  if (saveGroupError) {
    console.error("SAVE ACT GROUP MESSAGE:", saveGroupError);
  }

  // The report stays in progress / awaiting_act until office review commits.
  for (
    const adminId of
      ADMIN_IDS
  ) {
    await sendMessage(
      adminId,
      "🔔 <b>Новий акт на перевірку</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `🧾 ${escapeHtml(
          act.act_number ||
            "Без номера",
        )}\n` +
        `🔢 ${escapeHtml(
          app.application_number ||
            "G-0000",
        )}\n` +
        `👤 ${escapeHtml(
          name,
        )}`,
      {
        inline_keyboard: [
          [
            {
              text:
                "📎 Відкрити",
              callback_data:
                `openact:${actId}`,
            },
            {
              text:
                "✅ Підтвердити",
              callback_data:
                `approveact:${actId}`,
            },
          ],
        ],
      },
    );
  }

  await clearSession(
    telegramId,
  );

  await sendMessage(
    chatId,
    "✅ <b>Готово</b>\n\nАкт передано офісу на перевірку. Після підтвердження результат з’явиться у замовника.",
    mainMenu(telegramId),
  );
}

async function checkDeadlineNotifications() {
  const nowIso = new Date().toISOString();
  const { data: overdue, error } = await supabase
    .from("applications")
    .select("id,application_number,title,deadline_at,contractor_id,reminder_sent_at,status")
    .lt("deadline_at", nowIso)
    .neq("status", "completed")
    .is("reminder_sent_at", null)
    .limit(50);

  if (error || !overdue?.length) return;

  for (const app of overdue) {
    const { data: c } = await supabase
      .from("contractors")
      .select("telegram_id,first_name,last_name")
      .eq("id", app.contractor_id)
      .maybeSingle();

    const name = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Невідомий";
    const msg =
      "🚨 <b>Прострочена заявка</b>\n━━━━━━━━━━━━━━━━\n\n" +
      `🔢 <b>${escapeHtml(app.application_number || "G-0000")}</b>\n` +
      `🏢 ${escapeHtml(app.title || "Без назви")}\n` +
      `⏰ Дедлайн: <b>${escapeHtml(formatKyivDate(app.deadline_at))}</b>`;

    for (const adminId of ADMIN_IDS) {
      await sendMessage(adminId, msg + `\n👤 ${escapeHtml(name || "Невідомий")}`, adminMenu());
    }

    if (c?.telegram_id) {
      await sendMessage(
        c.telegram_id,
        msg + "\n\nБудь ласка, зв'яжіться з менеджером або завершіть роботу.",
        mainMenu(c.telegram_id),
      );
    }

    await supabase
      .from("applications")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", app.id);
  }
}

// =====================================================
// CALLBACK
// =====================================================

async function handleCallback(
  callback: any,
) {
  await refreshDynamicAdmins();

  const userId =
    callback?.from?.id;

  const chatId =
    callback?.message?.chat?.id;

  const data =
    callback?.data || "";

  console.log(
    "================================",
  );

  console.log(
    "CALLBACK RECEIVED",
  );

  console.log(
    JSON.stringify(
      {
        userId,
        chatId,
        chatType:
          callback?.message?.chat?.type,
        data,
        messageId:
          callback?.message?.message_id,
      },
      null,
      2,
    ),
  );

  console.log(
    "================================",
  );

  await telegram(
    "answerCallbackQuery",
    {
      callback_query_id:
        callback.id,
    },
  );

  if (
    !userId ||
    !chatId
  ) {
    return;
  }

  if (await serviceWorkflow.callback(callback)) return;

  // ===================================================
  // NEW APPLICATION FROM ORDER PARSER -> CLAIM IN WORK GROUP
  // ===================================================
  if (data.startsWith("externalclaim:")) {
    const applicationId = data.substring("externalclaim:".length);
    const contractor = await getContractor(userId);

    if (!contractor || contractor.status !== "active") {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Спочатку зареєструйтесь у боті як активний підрядник.",
        show_alert: true,
      });
      return;
    }

    const { data: app, error } = await supabase
      .from("applications")
      .update({
        contractor_id: contractor.id,
        status: "assigned",
        contractor_stage: "accepted",
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId)
      .is("contractor_id", null)
      .eq("status", "new")
      .select("id,application_number,title,description,address,deadline_at")
      .maybeSingle();

    if (error || !app) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Цю заявку вже прийняв інший підрядник.",
        show_alert: true,
      });
      return;
    }

    const contractorName = `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() || callback?.from?.first_name || "Підрядник";
    let groupText =
      "📋 <b>НОВА ЗАЯВКА</b>\n" +
      "━━━━━━━━━━━━━━━━━━\n\n" +
      `🔢 <b>Номер:</b> ${escapeHtml(app.application_number || "G-0000")}\n` +
      `🏢 <b>Об'єкт:</b> ${escapeHtml(app.title || "—")}\n` +
      `📍 <b>Адреса:</b> ${escapeHtml(app.address || "—")}\n` +
      `🔧 <b>Робота:</b> ${escapeHtml(app.description || "—")}\n`;

    if (app.deadline_at) {
      groupText += `📅 <b>Термін:</b> ${escapeHtml(formatKyivDate(app.deadline_at))}\n`;
    }

    groupText +=
      `\n📌 <b>Статус:</b> ✅ Прийнято\n` +
      `👷 <b>Підрядник:</b> ${escapeHtml(contractorName)}\n` +
      "━━━━━━━━━━━━━━━━━━";

    if (callback?.message?.message_id) {
      await telegram("editMessageText", {
        chat_id: chatId,
        message_id: callback.message.message_id,
        text: groupText,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [] },
      });
    }

    await sendMessage(
      userId,
      `✅ <b>Заявку ${escapeHtml(app.application_number || "G-0000")} прийнято</b>\n\n` +
        "Вона додана до «📋 Мої заявки». Відкрийте її, щоб виїхати на об'єкт, повідомити про проблему або завершити роботу.",
      {
        inline_keyboard: [[
          {
            text: "📋 Відкрити заявку",
            callback_data: `contractorapp:${app.id}`,
          },
        ]],
      },
    );

    return;
  }

  if (
    data.startsWith(
      "startwork:",
    )
  ) {
    const applicationId = data.substring("startwork:".length);
    const contractor = await getContractor(userId);

    if (!contractor || contractor.status !== "active") {
      return;
    }

    const { data: app } = await supabase
      .from("applications")
      .select("id,contractor_id,status,application_number")
      .eq("id", applicationId)
      .maybeSingle();

    if (
      !app ||
      app.contractor_id !== contractor.id
    ) {
      await sendMessage(chatId, "⛔ Ця заявка не належить вам.");
      return;
    }

    if (
      app.status === "assigned" ||
      app.status === "new"
    ) {
      await supabase
        .from("applications")
        .update({
          status: "in_progress",
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId);

      const { data: updatedApp } = await supabase
        .from("applications")
        .select("id,application_number,title,address,description,deadline_at,order_date_text,status,work_card_chat_id,work_card_message_id")
        .eq("id", applicationId)
        .maybeSingle();
      if (updatedApp) await syncWorkCardStatus(updatedApp);

      await sendMessage(chatId, "🔵 <b>В роботі</b>", mainMenu(userId));
      await showContractorApplicationCard(chatId, userId, applicationId);
    }
    return;
  }

  // ===================================================
  // FINISH
  // ===================================================

  if (
    data.startsWith(
      "finish:",
    )
  ) {
    const applicationId =
      data.substring(
        "finish:".length,
      );

    if (
      isAdmin(userId)
    ) {
      const adminSession =
        await getSession(
          userId,
        );

      if (
        !isAdminContractorState(
          adminSession?.state,
        )
      ) {
        await sendMessage(
          chatId,
          "ℹ️ Спочатку відкрийте «👷 Панель підрядника».",
          adminMenu(),
        );

        return;
      }
    }

    await startMultiActUpload(
      chatId,
      userId,
      applicationId,
    );

    return;
  }

  if (data.startsWith("registerregion:")) {
    const regionCode =
      normalizeRegionCode(
        data.split(":")[1] || "",
      );

    if (!regionCode) {
      await sendMessage(
        chatId,
        "❌ Невідомий регіон.",
      );
      return;
    }

    const contractor =
      await getContractor(
        callback.from.id,
      );

    if (!contractor) {
      await sendMessage(
        chatId,
        "❌ Профіль підрядника не знайдено. Натисніть /start.",
      );
      return;
    }

    if (
      contractor.status === "deleted" ||
      contractor.status === "rejected"
    ) {
      await sendMessage(
        chatId,
        "⛔️ Доступ до профілю закрито адміністратором.",
      );
      return;
    }

    const region =
      REGION_DEFINITIONS[
        regionCode
      ];

    const {
      data: updatedContractor,
      error,
    } = await supabase
      .from("contractors")
      .update({
        region_code:
          regionCode,
        region_name:
          region.name,
        latitude: null,
        longitude: null,
      })
      .eq(
        "id",
        contractor.id,
      )
      .select("*")
      .maybeSingle();

    if (
      error ||
      !updatedContractor
    ) {
      await sendMessage(
        chatId,
        "❌ Не вдалося зберегти регіон. Спробуйте ще раз.\\n\\n" +
          `<code>${escapeHtml(
            error?.message ||
              "Невідома помилка",
          )}</code>`,
      );
      return;
    }

    if (
      updatedContractor.status ===
      "pending"
    ) {
      await notifyAdminsAboutContractor(
        updatedContractor,
      );

      await sendMessage(
        chatId,
        "✅ <b>Регіон збережено</b>\\n" +
          "━━━━━━━━━━━━━━━━\\n\\n" +
          `🌍 <b>${escapeHtml(
            region.name,
          )}</b>\\n\\n` +
          "⏳ Заявку відправлено адміністратору на підтвердження.",
      );
      return;
    }

    await sendMessage(
      chatId,
      "✅ <b>Регіон змінено</b>\\n" +
        "━━━━━━━━━━━━━━━━\\n\\n" +
        `🌍 <b>${escapeHtml(
          region.name,
        )}</b>`,
      mainMenu(
        callback.from.id,
      ),
    );

    return;
  }



  if (
    data ===
    "contractorappslist"
  ) {
    await showApplications(
      chatId,
      userId,
    );
    return;
  }

  if (
    data ===
    "contractorhistorylist"
  ) {
    await showHistory(
      chatId,
      userId,
    );
    return;
  }

  if (
    data.startsWith(
      "contractorapp:",
    )
  ) {
    await showContractorApplicationCard(
      chatId,
      userId,
      data.substring(
        "contractorapp:".length,
      ),
    );
    return;
  }

  if (
    data.startsWith(
      "contractorhistory:",
    )
  ) {
    await showContractorHistoryCard(
      chatId,
      userId,
      data.substring(
        "contractorhistory:".length,
      ),
    );
    return;
  }

  if (
    data.startsWith(
      "contractoraccept:",
    )
  ) {
    const applicationId =
      data.substring(
        "contractoraccept:".length,
      );

    if (
      isAdmin(
        userId,
      )
    ) {
      await setSession(
        userId,
        "admin_contractor_mode",
      );
    }

    const contractor =
      await getContractor(
        userId,
      );

    if (
      !contractor ||
      contractor.status !==
        "active"
    ) {
      return;
    }

    const {
      data: app,
      error,
    } = await supabase
      .from("applications")
      .update({
        contractor_stage:
          "accepted",
        accepted_at:
          new Date()
            .toISOString(),
        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        applicationId,
      )
      .eq(
        "contractor_id",
        contractor.id,
      )
      .eq(
        "contractor_stage",
        "offered",
      )
      .select("*")
      .maybeSingle();

    if (
      error ||
      !app
    ) {
      await sendMessage(
        chatId,
        "ℹ️ Заявка вже недоступна або була оброблена.",
        mainMenu(userId),
      );
      return;
    }

    await sendMessage(
      chatId,
      `✅ <b>Заявку ${escapeHtml(
        app.application_number ||
          "G-0000",
      )} прийнято</b>\n\n` +
        "Заявку додано до розділу «📋 Мої заявки».",
      {
        inline_keyboard: [
          [
            {
              text:
                "📋 Відкрити заявку",
              callback_data:
                `contractorapp:${app.id}`,
            },
          ],
          [
            {
              text:
                "⚠️ Проблема",
              callback_data:
                `contractorproblem:${app.id}`,
            },
          ],
        ],
      },
    );
    return;
  }

  if (
    data.startsWith(
      "contractordecline:",
    )
  ) {
    const applicationId =
      data.substring(
        "contractordecline:".length,
      );

    if (
      isAdmin(
        userId,
      )
    ) {
      await setSession(
        userId,
        "admin_contractor_mode",
      );
    }

    const contractor =
      await getContractor(
        userId,
      );

    if (!contractor) {
      return;
    }

    const {
      data: app,
      error,
    } = await supabase
      .from("applications")
      .update({
        contractor_id:
          null,
        contractor_stage:
          "declined",
        status:
          "new",
        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        applicationId,
      )
      .eq(
        "contractor_id",
        contractor.id,
      )
      .select(
        "application_number,title",
      )
      .maybeSingle();

    if (
      error ||
      !app
    ) {
      await sendMessage(
        chatId,
        "ℹ️ Заявка вже була оброблена.",
        mainMenu(userId),
      );
      return;
    }

    await sendMessage(
      chatId,
      `❌ Ви відмовилися від заявки <b>${escapeHtml(
        app.application_number ||
          "G-0000",
      )}</b>.`,
      mainMenu(userId),
    );

    for (
      const adminId of
        ADMIN_IDS
    ) {
      await sendMessage(
        adminId,
        "⚠️ <b>Підрядник відмовився від заявки</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          `🔢 ${escapeHtml(
            app.application_number ||
              "G-0000",
          )}\n` +
          `🏢 ${escapeHtml(
            app.title ||
              "Без назви",
          )}`,
        adminMenu(),
      );
    }

    return;
  }

  if (
    data.startsWith(
      "contractordepart:",
    )
  ) {
    const applicationId =
      data.substring(
        "contractordepart:".length,
      );

    if (
      isAdmin(
        userId,
      )
    ) {
      await setSession(
        userId,
        "admin_contractor_mode",
      );
    }

    await setSession(
      userId,
      `contractor_departure:${applicationId}`,
    );

    await sendMessage(
      chatId,
      "🚗 <b>Виїзд на об'єкт</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        "Надішліть геолокацію — зафіксуємо, звідки ви виїхали.\n\n" +
        "Якщо не можете — натисніть «⏭ Пропустити».",
      departureLocationMenu(),
    );
    return;
  }

  if (data.startsWith("problemquick:")) {
    const raw = data.substring("problemquick:".length);
    const sep = raw.lastIndexOf(":");
    const applicationId = raw.substring(0, sep);
    const kind = raw.substring(sep + 1);

    if (kind === "other") {
      await setSession(userId, `contractor_problem:${applicationId}`);
      await sendMessage(chatId, "✏️ Коротко напишіть проблему одним повідомленням.", cancelMenu());
      return;
    }

    const labels: Record<string, string> = {
      access: "Немає доступу до об'єкта",
      noanswer: "Не відповідають",
      materials: "Потрібні матеріали",
    };
    const problemText = labels[kind] || "Інша проблема";
    const contractor = await getContractor(userId);
    if (!contractor) return;

    await supabase.from("applications").update({
      has_problem: true,
      problem_comment: problemText,
      contractor_stage: "problem",
      updated_at: new Date().toISOString(),
    }).eq("id", applicationId).eq("contractor_id", contractor.id);

    const { data: problemApplication } = await supabase
      .from("applications").select("application_number,title")
      .eq("id", applicationId).maybeSingle();

    for (const adminId of ADMIN_IDS) {
      await sendMessage(adminId,
        "⚠️ <b>Проблема по заявці</b>\n━━━━━━━━━━━━━━━━\n\n" +
        `🔢 Заявка: <b>${escapeHtml(problemApplication?.application_number || "G-0000")}</b>\n` +
        `🏢 Об'єкт: <b>${escapeHtml(problemApplication?.title || "Без назви")}</b>\n` +
        `👤 Підрядник: <b>${escapeHtml(`${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() || "Без імені")}</b>\n` +
        `💬 Проблема: ${escapeHtml(problemText)}`,
        adminMenu());
    }

    await sendMessage(chatId, "✅ Проблему передано менеджеру.", mainMenu(userId));
    await showContractorApplicationCard(chatId, userId, applicationId);
    return;
  }

  if (
    data.startsWith(
      "contractorproblem:",
    )
  ) {
    const applicationId =
      data.substring(
        "contractorproblem:".length,
      );

    if (
      isAdmin(
        userId,
      )
    ) {
      await setSession(
        userId,
        "admin_contractor_mode",
      );
    }

    await sendMessage(
      chatId,
      "⚠️ <b>Що сталося?</b>",
      {
        inline_keyboard: [
          [{ text: "🚪 Немає доступу", callback_data: `problemquick:${applicationId}:access` }],
          [{ text: "📞 Не відповідають", callback_data: `problemquick:${applicationId}:noanswer` }],
          [{ text: "🧰 Потрібні матеріали", callback_data: `problemquick:${applicationId}:materials` }],
          [{ text: "✏️ Інше", callback_data: `problemquick:${applicationId}:other` }],
        ],
      },
    );
    return;
  }

  if (
    data.startsWith(
      "contractordone:",
    )
  ) {
    const applicationId =
      data.substring(
        "contractordone:".length,
      );

    if (
      isAdmin(
        userId,
      )
    ) {
      await setSession(
        userId,
        "admin_contractor_mode",
      );
    }

    // Фактичний об'єм більше не запитуємо.
    // Одразу переходимо до завантаження акта.
    await startMultiActUpload(
      chatId,
      userId,
      applicationId,
    );
    return;
  }

  // ===================================================
  // ADMIN
  // ===================================================

  if (
    !isAdmin(userId)
  ) {
    console.warn(
      "Callback from non-admin:",
      userId,
    );

    return;
  }

  const callbackMessageId =
    callback?.message?.message_id || null;

  if (data === "noop") {
    return;
  }


  if (
    data ===
    "payoutslist"
  ) {
    await showAdminPayouts(
      chatId,
    );
    return;
  }

  if (
    data.startsWith(
      "payoutcard:",
    )
  ) {
    await showAdminPayoutCard(
      chatId,
      data.substring(
        "payoutcard:".length,
      ),
    );
    return;
  }

  if (
    data.startsWith(
      "payoutsetamount:",
    )
  ) {
    const applicationId =
      data.substring(
        "payoutsetamount:".length,
      );

    const { data: app } =
      await supabase
        .from("applications")
        .select(
          "application_number,payout_amount,payout_status",
        )
        .eq(
          "id",
          applicationId,
        )
        .maybeSingle();

    if (!app) {
      await sendMessage(
        chatId,
        "❌ Заявку не знайдено.",
        adminMenu(),
      );
      return;
    }

    if (
      app.payout_status ===
      "paid"
    ) {
      await sendMessage(
        chatId,
        "ℹ️ Виплата вже проведена. Суму змінювати не можна.",
        adminMenu(),
      );
      return;
    }

    await setSession(
      userId,
      `admin_payout_amount:${applicationId}`,
    );

    await sendMessage(
      chatId,
      "✏️ <b>Сума виплати</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `🔢 Заявка: <b>${escapeHtml(
          app.application_number ||
            "G-0000",
        )}</b>\n` +
        `💰 Поточна сума: <b>${Number(
          app.payout_amount ||
            0,
        ).toFixed(2)} грн</b>\n\n` +
        "Введіть суму виплати в гривнях.\n" +
        "Наприклад: <code>2500</code> або <code>2500.50</code>",
      cancelMenu(),
    );
    return;
  }

  if (
    data.startsWith(
      "payoutconfirm:",
    )
  ) {
    const applicationId =
      data.substring(
        "payoutconfirm:".length,
      );

    const { data: app } =
      await supabase
        .from("applications")
        .select(
          "application_number,payout_amount,payout_status",
        )
        .eq(
          "id",
          applicationId,
        )
        .maybeSingle();

    if (!app) {
      await sendMessage(
        chatId,
        "❌ Заявку не знайдено.",
        adminMenu(),
      );
      return;
    }

    if (
      app.payout_status ===
      "paid"
    ) {
      await sendMessage(
        chatId,
        "ℹ️ Цю виплату вже підтверджено.",
        adminMenu(),
      );
      return;
    }

    await setSession(
      userId,
      `admin_payout_receipt:${applicationId}`,
    );

    await sendMessage(
      chatId,
      "🧾 <b>Підтвердження виплати</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `🔢 Заявка: <b>${escapeHtml(
          app.application_number ||
            "G-0000",
        )}</b>\n` +
        `💰 Сума: <b>${Number(
          app.payout_amount ||
            0,
        ).toFixed(2)} грн</b>\n\n` +
        "Тепер надішліть <b>фото або PDF квитанції</b>.\n" +
        "Після завантаження виплата буде позначена як виконана.",
      cancelMenu(),
    );
    return;
  }

  if (
    data.startsWith(
      "payoutreceipt:",
    )
  ) {
    const applicationId =
      data.substring(
        "payoutreceipt:".length,
      );

    const { data: app } =
      await supabase
        .from("applications")
        .select("*")
        .eq(
          "id",
          applicationId,
        )
        .maybeSingle();

    if (
      !app?.payout_receipt_file_id
    ) {
      await sendMessage(
        chatId,
        "ℹ️ Квитанцію не знайдено.",
        adminMenu(),
      );
      return;
    }

    await sendPayoutReceipt(
      chatId,
      app,
      `🧾 <b>Квитанція • ${escapeHtml(
        app.application_number ||
          "G-0000",
      )}</b>`,
    );
    return;
  }

  if (data.startsWith("pendingcontractors:")) {
    const page = Math.max(0, Number(data.split(":")[1]) || 0);
    await showContractorsPaged(chatId, page, callbackMessageId, "pending");
    return;
  }

  if (data.startsWith("contractorspage:")) {
    const page = Math.max(0, Number(data.split(":")[1]) || 0);
    await showContractorsPaged(chatId, page, callbackMessageId);
    return;
  }

  if (data.startsWith("deletedpage:")) {
    const page = Math.max(0, Number(data.split(":")[1]) || 0);
    await showContractorsPaged(chatId, page, callbackMessageId, "deleted");
    return;
  }

  if (data.startsWith("appfilter:")) {
    const parts = data.split(":");
    const filter = parts[1] || "all";
    const page = Math.max(0, Number(parts[2]) || 0);
    await showApplicationsFiltered(chatId, filter, page, callbackMessageId);
    return;
  }

  if (data.startsWith("appspage:")) {
    const parts = data.split(":");
    const page = Math.max(0, Number(parts[1]) || 0);
    const filter = parts[2] || "all";
    await showApplicationsFiltered(chatId, filter, page, callbackMessageId);
    return;
  }

  if (data.startsWith("actspage:")) {
    const page = Math.max(0, Number(data.split(":")[1]) || 0);
    await showActsPaged(chatId, page, callbackMessageId);
    return;
  }

  if (data.startsWith("historypage:")) {
    const page = Math.max(0, Number(data.split(":")[1]) || 0);
    await showHistoryPaged(chatId, page, callbackMessageId);
    return;
  }

  if (data.startsWith("contractorcard:")) {
    const contractorId = data.substring("contractorcard:".length);
    await showContractorCard(chatId, contractorId, callbackMessageId);
    return;
  }

  if (data.startsWith("applicationoriginal:")) {
    const applicationId = data.slice("applicationoriginal:".length);
    if (callback.message?.chat?.type === "private" && chatId === userId && /^[0-9a-f-]{36}$/i.test(applicationId)) {
      await showOriginalApplication(chatId,applicationId);
    }
    return;
  }

  if (data.startsWith("applicationcard:")) {
    const applicationId = data.substring("applicationcard:".length);
    await showApplicationCard(chatId, applicationId, callbackMessageId);
    return;
  }

  if (data.startsWith("ratecontractor:")) {
    const [, contractorId, ratingText] = data.split(":");
    const rating = Math.max(1, Math.min(5, Number(ratingText) || 1));
    await supabase
      .from("contractors")
      .update({ rating })
      .eq("id", contractorId);
    await showContractorCard(chatId, contractorId, callbackMessageId);
    return;
  }

  if (data.startsWith("notecontractor:")) {
    const contractorId = data.substring("notecontractor:".length);
    await setSession(userId, `admin_contractor_note:${contractorId}`);
    await sendMessage(
      chatId,
      "📝 <b>Нотатка менеджера</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Напишіть внутрішню нотатку про підрядника.",
      cancelMenu(),
    );
    return;
  }

  if (
    data.startsWith(
      "approvewithregion:",
    )
  ) {
    const [
      ,
      contractorId,
      rawRegion,
    ] = data.split(
      ":",
    );

    const regionCode =
      normalizeRegionCode(
        rawRegion ||
          "",
      );

    if (!regionCode) {
      await sendMessage(
        chatId,
        "❌ Невідомий регіон.",
        adminMenu(),
      );
      return;
    }

    const region =
      REGION_DEFINITIONS[
        regionCode
      ];

    const {
      data: contractor,
      error,
    } = await supabase
      .from("contractors")
      .update({
        region_code:
          regionCode,
        region_name:
          region.name,
        latitude:
          null,
        longitude:
          null,
        status:
          "active",
      })
      .eq(
        "id",
        contractorId,
      )
      .select("*")
      .maybeSingle();

    if (
      error ||
      !contractor
    ) {
      console.error(
        "approvewithregion:",
        error,
      );

      await sendMessage(
        chatId,
        "❌ Не вдалося активувати підрядника." +
          (error?.message
            ? `\\n\\n<code>${escapeHtml(
                error.message,
              )}</code>`
            : ""),
        adminMenu(),
      );
      return;
    }

    const name =
      `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
      "Без імені";

    await clearSession(
      contractor.telegram_id,
    );

    await sendMessage(
      chatId,
      "✅ <b>Підрядника активовано</b>\\n" +
        "━━━━━━━━━━━━━━━━\\n\\n" +
        `👤 <b>${escapeHtml(
          name,
        )}</b>\\n` +
        `🌍 <b>${escapeHtml(
          region.name,
        )}</b>`,
      adminMenu(),
    );

    if (
      contractor.telegram_id
    ) {
      await sendMessage(
        contractor.telegram_id,
        "✅ <b>Доступ підтверджено</b>\\n" +
          "━━━━━━━━━━━━━━━━\\n\\n" +
          `🌍 Робочий регіон: <b>${escapeHtml(
            region.name,
          )}</b>\\n\\n` +
          "Ви можете користуватися кабінетом підрядника.",
        mainMenu(
          contractor.telegram_id,
        ),
      );
    }

    return;
  }

  if (data.startsWith("adminsetpendingregion:")) {
    const [, contractorId, rawRegion] = data.split(":");
    const regionCode = normalizeRegionCode(rawRegion || "");

    if (!regionCode) {
      await sendMessage(chatId, "❌ Невідомий регіон.", adminMenu());
      return;
    }

    const region = REGION_DEFINITIONS[regionCode];

    const { data: contractor, error } = await supabase
      .from("contractors")
      .update({
        region_code: regionCode,
        region_name: region.name,
        latitude: null,
        longitude: null,
        status: "active",
      })
      .eq("id", contractorId)
      .select("*")
      .maybeSingle();

    if (error || !contractor) {
      await sendMessage(
        chatId,
        "❌ Не вдалося призначити регіон.\n\n" +
          `<code>${escapeHtml(error?.message || "Невідома помилка")}</code>`,
        adminMenu(),
      );
      return;
    }

    const name =
      `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
      "Без імені";

    await sendMessage(
      chatId,
      "✅ <b>Підрядника активовано</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `👤 <b>${escapeHtml(name)}</b>\n` +
        `🌍 <b>${escapeHtml(region.name)}</b>`,
      adminMenu(),
    );

    if (
      contractor.telegram_id
    ) {
      await sendMessage(
        contractor.telegram_id,
        "✅ <b>Доступ підтверджено</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          `🌍 Робочий регіон: <b>${escapeHtml(
            region.name,
          )}</b>\n\n` +
          "Ви можете користуватися кабінетом підрядника.",
        mainMenu(
          contractor.telegram_id,
        ),
      );
    }

    return;
  }

  if (
    data.startsWith(
      "regioncontractor:",
    )
  ) {
    const contractorId =
      data.substring(
        "regioncontractor:".length,
      );

    await showContractorRegionPicker(
      chatId,
      contractorId,
    );
    return;
  }

  if (
    data ===
    "adminregionsearchagain"
  ) {
    await startContractorRegionAssignment(
      chatId,
      userId,
    );
    return;
  }

  if (
    data.startsWith(
      "adminassignregion:",
    )
  ) {
    const [
      ,
      contractorId,
      rawRegion,
    ] = data.split(
      ":",
    );

    const regionCode =
      normalizeRegionCode(
        rawRegion ||
          "",
      );

    if (!regionCode) {
      await sendMessage(
        chatId,
        "❌ Невідомий регіон.",
        adminMenu(),
      );
      return;
    }

    const region =
      REGION_DEFINITIONS[
        regionCode
      ];

    const {
      data: contractor,
      error,
    } = await supabase
      .from("contractors")
      .update({
        region_code:
          regionCode,
        region_name:
          region.name,
      })
      .eq(
        "id",
        contractorId,
      )
      .select("*")
      .maybeSingle();

    if (
      error ||
      !contractor
    ) {
      await sendMessage(
        chatId,
        "❌ Не вдалося призначити регіон.\n\n" +
          `<code>${escapeHtml(
            error?.message ||
              "Невідома помилка",
          )}</code>`,
        adminMenu(),
      );
      return;
    }

    await clearSession(
      userId,
    );

    const topic =
      await getRegionTopic(
        regionCode,
      );

    const name =
      `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
      "Без імені";

    await sendMessage(
      chatId,
      "✅ <b>Регіон призначено</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `👤 <b>${escapeHtml(
          name,
        )}</b>\n` +
        `📱 ${escapeHtml(
          contractor.phone ||
            "Номер не вказано",
        )}\n` +
        `🌍 <b>${escapeHtml(
          region.name,
        )}</b>\n` +
        `🧵 Тема: ${
          topic?.message_thread_id
            ? `<b>підключена</b>`
            : "<b>не прив'язана</b>"
        }\n\n` +
        "Наступні акти цього підрядника підуть у тему обраного регіону.",
      adminMenu(),
    );

    if (
      contractor.telegram_id
    ) {
      await sendMessage(
        contractor.telegram_id,
        "🌍 <b>Ваш робочий регіон призначено</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          `Регіон: <b>${escapeHtml(
            region.name,
          )}</b>`,
        mainMenu(
          contractor.telegram_id,
        ),
      );
    }

    return;
  }

  if (data.startsWith("changeregion:")) {
    const contractorId = data.split(":")[1];

    const { data: contractor } = await supabase
      .from("contractors")
      .select("id,first_name,last_name,region_name")
      .eq("id", contractorId)
      .maybeSingle();

    if (!contractor) {
      await sendMessage(chatId, "❌ Підрядника не знайдено.", adminMenu());
      return;
    }

    const name =
      `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
      "Без імені";

    await sendMessage(
      chatId,
      "🌍 <b>Змінити регіон</b>\n━━━━━━━━━━━━━━━━\n\n" +
        `👤 <b>${escapeHtml(name)}</b>\n` +
        `📍 Поточний: <b>${escapeHtml(contractor.region_name || "Не вказано")}</b>\n\n` +
        "Оберіть новий регіон:",
      {
        inline_keyboard: [
          [
            {
              text: "🏙 Київ",
              callback_data: `setregion:${contractor.id}:kyiv`,
            },
            {
              text: "🏙 Дніпро",
              callback_data: `setregion:${contractor.id}:dnipro`,
            },
          ],
        ],
      },
    );
    return;
  }

  if (data.startsWith("setregion:")) {
    const [, contractorId, rawRegion] = data.split(":");
    const regionCode = normalizeRegionCode(rawRegion || "");

    if (!regionCode) {
      await sendMessage(chatId, "❌ Невідомий регіон.", adminMenu());
      return;
    }

    const region = REGION_DEFINITIONS[regionCode];

    const { data: contractor, error } = await supabase
      .from("contractors")
      .update({
        region_code: regionCode,
        region_name: region.name,
      })
      .eq("id", contractorId)
      .select("*")
      .maybeSingle();

    if (error || !contractor) {
      await sendMessage(
        chatId,
        "❌ Не вдалося змінити регіон.\n\n" +
          `<code>${escapeHtml(error?.message || "Невідома помилка")}</code>`,
        adminMenu(),
      );
      return;
    }

    const name =
      `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
      "Без імені";

    await sendMessage(
      chatId,
      "✅ <b>Регіон змінено</b>\n━━━━━━━━━━━━━━━━\n\n" +
        `👤 <b>${escapeHtml(name)}</b>\n` +
        `🌍 Новий регіон: <b>${escapeHtml(region.name)}</b>\n\n` +
        "Наступні акти автоматично підуть у тему цього регіону.",
      adminMenu(),
    );

    if (contractor.telegram_id) {
      await sendMessage(
        contractor.telegram_id,
        "🌍 <b>Ваш робочий регіон змінено</b>\n━━━━━━━━━━━━━━━━\n\n" +
          `Новий регіон: <b>${escapeHtml(region.name)}</b>`,
      );
    }
    return;
  }

  if (
    data.startsWith(
      "checkcontractorregion:",
    )
  ) {
    const contractorId =
      data.substring(
        "checkcontractorregion:".length,
      );

    const { data: contractor } =
      await supabase
        .from("contractors")
        .select(
          "id,first_name,last_name,phone,status,region_code,region_name",
        )
        .eq(
          "id",
          contractorId,
        )
        .maybeSingle();

    if (!contractor) {
      await sendMessage(
        chatId,
        "❌ Підрядника не знайдено.",
        adminMenu(),
      );
      return;
    }

    const topic =
      await getRegionTopic(
        contractor.region_code,
      );

    await sendMessage(
      chatId,
      "🌍 <b>Маршрутизація підрядника</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `👤 ${escapeHtml(
          `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim(),
        )}\n` +
        `📱 ${escapeHtml(
          contractor.phone ||
            "—",
        )}\n` +
        `📊 ${escapeHtml(
          contractor.status ||
            "—",
        )}\n` +
        `🌍 region_code: <code>${escapeHtml(
          contractor.region_code ||
            "NULL",
        )}</code>\n` +
        `🧵 thread_id: <code>${escapeHtml(
          topic?.message_thread_id ||
            "NULL",
        )}</code>`,
      adminMenu(),
    );

    return;
  }

  // ===================================================
  // CONTRACTOR APPROVAL
  // ===================================================

  if (
    data.startsWith(
      "approvecontractor:",
    )
  ) {
    const contractorId =
      data.substring(
        "approvecontractor:".length,
      );

    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callback.id,
        text:
          "Підтверджую підрядника…",
      },
    );

    await approveContractor(
      chatId,
      contractorId,
    );
    return;
  }

  if (
    data.startsWith(
      "rejectcontractor:",
    )
  ) {
    const contractorId =
      data.substring(
        "rejectcontractor:".length,
      );

    await rejectContractor(
      chatId,
      contractorId,
    );
    return;
  }

  // ===================================================
  // DELETE CONTRACTOR
  // ===================================================

  if (
    data.startsWith(
      "deletecontractor:",
    )
  ) {
    const contractorId =
      data.substring(
        "deletecontractor:".length,
      );

    await askDeleteContractor(
      chatId,
      contractorId,
    );
    return;
  }

  if (
    data.startsWith(
      "confirmdeletecontractor:",
    )
  ) {
    const contractorId =
      data.substring(
        "confirmdeletecontractor:".length,
      );

    await deleteContractor(
      chatId,
      contractorId,
    );
    return;
  }

  if (
    data === "canceldeletecontractor"
  ) {
    await sendMessage(
      chatId,
      "↩️ Видалення скасовано.",
      adminMenu(),
    );
    return;
  }

  // ===================================================
  // RESTORE CONTRACTOR
  // ===================================================

  if (
    data.startsWith(
      "restorecontractor:",
    )
  ) {
    const contractorId =
      data.substring(
        "restorecontractor:".length,
      );

    await restoreContractor(
      chatId,
      contractorId,
    );
    return;
  }

  // ===================================================
  // NEW APPLICATION
  // ===================================================

  if (
    data.startsWith(
      "newappcontractor:",
    )
  ) {
    const contractorId =
      data.substring(
        "newappcontractor:"
          .length,
      );

    await createApplicationStartObject(
      chatId,
      userId,
      contractorId,
    );

    return;
  }

  // ===================================================
  // OPEN ACT
  // ===================================================

  if (
    data.startsWith(
      "openact:",
    )
  ) {
    const actId =
      data.substring(
        "openact:".length,
      );

    console.log(
      "OPEN ACT BUTTON ID:",
      actId,
    );

    await openAct(
      chatId,
      actId,
    );

    return;
  }

  // ===================================================
  // APPROVE
  // ===================================================

  if (
    data.startsWith(
      "approveact:",
    )
  ) {
    const actId =
      data.substring(
        "approveact:".length,
      );

    console.log(
      "APPROVE BUTTON ACT ID:",
      actId,
    );

    // Кнопка из рабочей группы
    if (
      chatId ===
      GROUP_CHAT_ID
    ) {
      await confirmAct(
        GROUP_CHAT_ID,
        actId,
        `telegram:${userId}`,
      );

      return;
    }

    // Кнопка из личной переписки администратора
    await confirmAct(
      chatId,
      actId,
      `telegram:${userId}`,
    );

    return;
  }

  // ===================================================
  // REJECT
  // ===================================================

  if (
    data.startsWith(
      "rejectact:",
    )
  ) {
    const actId =
      data.substring(
        "rejectact:".length,
      );

    console.log(
      "REJECT BUTTON ACT ID:",
      actId,
    );

    if (
      chatId ===
      GROUP_CHAT_ID
    ) {
      await rejectAct(
        GROUP_CHAT_ID,
        actId,
      );

      return;
    }

    await rejectAct(
      chatId,
      actId,
    );

    return;
  }

  // ===================================================
  // APPLICATION ACTS
  // ===================================================

  if (
    data.startsWith(
      "applicationacts:",
    )
  ) {
    const applicationId =
      data.substring(
        "applicationacts:"
          .length,
      );

    await showApplicationActs(
      chatId,
      applicationId,
    );

    return;
  }
}


// =====================================================
// CUSTOMER GROUP -> BOLT / SUPABASE
// =====================================================

function customerRequestTemplate(): string {
  return (
    "📝 <b>Шаблон заявки</b>\n" +
    "━━━━━━━━━━━━━━━━\n\n" +
    "<b>Об'єкт:</b> АЗК 189\n" +
    "<b>Адреса:</b> м. Київ, вул. Хрещатик 1\n" +
    "<b>Робота:</b> Заміна жировловлювача\n" +
    "<b>Дедлайн:</b> 05.09.2026 18:00\n" +
    "<b>Коментар:</b> Перед приїздом зателефонувати\n\n" +
    "Поля <b>Об'єкт</b>, <b>Адреса</b> та <b>Робота</b> — обов'язкові."
  );
}

function parseCustomerRequestText(
  text: string,
): {
  objectName: string;
  address: string;
  workName: string;
  deadlineText: string | null;
  deadlineAt: string | null;
  comment: string | null;
} | null {
  const lines =
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  const fields: Record<string, string> = {};

  for (const line of lines) {
    const match =
      line.match(
        /^([^:：]+)[:：]\s*(.+)$/,
      );

    if (!match) {
      continue;
    }

    const key =
      match[1]
        .trim()
        .toLowerCase();

    const value =
      match[2]
        .trim();

    if (!value) {
      continue;
    }

    if (
      [
        "об'єкт",
        "обьект",
        "объект",
        "object",
        "азк",
      ].includes(key)
    ) {
      fields.object = value;
      continue;
    }

    if (
      [
        "адреса",
        "адрес",
        "address",
      ].includes(key)
    ) {
      fields.address = value;
      continue;
    }

    if (
      [
        "робота",
        "работа",
        "що зробити",
        "что сделать",
        "заявка",
        "work",
      ].includes(key)
    ) {
      fields.work = value;
      continue;
    }

    if (
      [
        "дедлайн",
        "термін",
        "срок",
        "deadline",
      ].includes(key)
    ) {
      fields.deadline = value;
      continue;
    }

    if (
      [
        "коментар",
        "комментарий",
        "comment",
      ].includes(key)
    ) {
      fields.comment = value;
      continue;
    }
  }

  if (
    !fields.object ||
    !fields.address ||
    !fields.work
  ) {
    return null;
  }

  let deadlineAt: string | null =
    null;

  const deadlineText =
    fields.deadline || null;

  if (deadlineText) {
    const m =
      deadlineText.match(
        /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/,
      );

    if (m) {
      const day =
        Number(m[1]);
      const month =
        Number(m[2]);
      const year =
        Number(m[3]);
      const hour =
        Number(m[4] || 18);
      const minute =
        Number(m[5] || 0);

      // Kyiv timezone approximation is intentionally avoided here.
      // Store an ISO timestamp with +03:00 for current warm-season workflow.
      const pad =
        (n: number) =>
          String(n).padStart(2, "0");

      deadlineAt =
        `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+03:00`;
    }
  }

  return {
    objectName:
      fields.object,
    address:
      fields.address,
    workName:
      fields.work,
    deadlineText,
    deadlineAt,
    comment:
      fields.comment || null,
  };
}

async function createCustomerGroupApplication(
  message: any,
) {
  const chatId =
    Number(
      message?.chat?.id,
    );

  const messageId =
    Number(
      message?.message_id,
    );

  const user =
    message?.from;

  const text =
    typeof message?.text ===
    "string"
      ? message.text.trim()
      : "";

  if (!text) {
    return;
  }

  if (
    text === "/template" ||
    text === "/template@"
  ) {
    await sendMessageToTopic(
      chatId,
      CUSTOMER_TOPIC_ID,
      customerRequestTemplate(),
    );
    return;
  }

  const parsed =
    parseCustomerRequestText(
      text,
    );

  if (!parsed) {
    const errorMessage =
      await sendMessageToTopic(
        chatId,
        CUSTOMER_TOPIC_ID,
        "❌ <b>Не вдалося розпізнати заявку.</b>\n\n" +
          "Надішліть її за шаблоном:\n\n" +
          customerRequestTemplate(),
      );

    scheduleTelegramCleanup(
      chatId,
      [
        messageId,
        errorMessage?.result
          ?.message_id,
      ],
      10000,
    );

    return;
  }

  // Prevent duplicate creation if Telegram retries the same update.
  const {
    data: existing,
  } = await supabase
    .from("applications")
    .select(
      "id,application_number",
    )
    .eq(
      "customer_chat_id",
      chatId,
    )
    .eq(
      "customer_message_id",
      messageId,
    )
    .maybeSingle();

  if (existing?.id) {
    await sendMessageToTopic(
      chatId,
      CUSTOMER_TOPIC_ID,
      `ℹ️ Заявка вже створена: <b>${escapeHtml(
        existing.application_number ||
          "без номера",
      )}</b>`,
    );
    return;
  }

  const applicationNumber =
    await generateUniqueApplicationNumber();

  const customerName =
    [
      user?.first_name,
      user?.last_name,
    ]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    user?.username ||
    "Замовник";

  const customerUsername =
    user?.username
      ? `@${user.username}`
      : null;

  const managerCommentParts =
    [
      parsed.comment
        ? `Коментар замовника: ${parsed.comment}`
        : null,
      parsed.deadlineText &&
      !parsed.deadlineAt
        ? `Дедлайн текстом: ${parsed.deadlineText}`
        : null,
      `Замовник: ${customerName}${
        customerUsername
          ? ` (${customerUsername})`
          : ""
      }`,
    ].filter(Boolean);

  const {
    data: application,
    error,
  } = await supabase
    .from("applications")
    .insert({
      application_number:
        applicationNumber,

      contractor_id:
        null,

      manager_id:
        null,

      title:
        parsed.objectName,

      description:
        parsed.workName,

      address:
        parsed.address,

      deadline_at:
        parsed.deadlineAt,

      scheduled_at:
        parsed.deadlineAt,

      manager_comment:
        managerCommentParts.join(
          "\n",
        ),

      status:
        "new",

      contractor_stage:
        "unassigned",

      request_source:
        "customer_telegram_group",

      customer_chat_id:
        chatId,

      customer_message_id:
        messageId,

      customer_telegram_id:
        user?.id
          ? Number(user.id)
          : null,

      customer_name:
        customerName,

      customer_username:
        user?.username || null,

      customer_raw_text:
        text,

      updated_at:
        new Date()
          .toISOString(),
    })
    .select(
      "id,application_number",
    )
    .single();

  if (
    error ||
    !application?.id
  ) {
    console.error(
      "CUSTOMER APPLICATION CREATE ERROR:",
      error,
    );

    const errorMessage =
      await sendMessageToTopic(
        chatId,
        CUSTOMER_TOPIC_ID,
        "❌ <b>Не вдалося створити заявку в системі.</b>\n\n" +
          `<code>${escapeHtml(
            error?.message ||
              "Невідома помилка",
          )}</code>`,
      );

    scheduleTelegramCleanup(
      chatId,
      [
        errorMessage?.result
          ?.message_id,
      ],
      10000,
    );

    return;
  }

  await sendMessageToTopic(
    chatId,
    CUSTOMER_TOPIC_ID,
    "✅ <b>Заявку прийнято</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `🔢 Номер: <b>${escapeHtml(
        application.application_number,
      )}</b>\n` +
      `🏢 Об'єкт: <b>${escapeHtml(
        parsed.objectName,
      )}</b>\n` +
      `📍 Адреса: ${escapeHtml(
        parsed.address,
      )}\n` +
      `🔧 Робота: ${escapeHtml(
        parsed.workName,
      )}\n\n` +
      "Заявка автоматично передана в адмін-панель.",
  );
}

async function handleCustomerGroupMessage(
  message: any,
): Promise<boolean> {
  const chatId =
    Number(
      message?.chat?.id,
    );

  const text =
    typeof message?.text ===
    "string"
      ? message.text.trim()
      : "";

  if (
    text === "/chatid" ||
    text.startsWith(
      "/chatid@",
    )
  ) {
    const topicId =
      Number(
        message?.message_thread_id,
      ) || 0;

    if (topicId > 0) {
      await sendMessageToTopic(
        chatId,
        topicId,
        `🆔 Group ID:\n<code>${chatId}</code>\n\n` +
          `🧵 Topic ID:\n<code>${topicId}</code>`,
      );
    } else {
      await sendMessage(
        chatId,
        `🆔 Group ID:\n<code>${chatId}</code>\n\n` +
          `🧵 Topic ID:\n<code>${topicId}</code>`,
      );
    }
    return true;
  }

  if (
    !CUSTOMER_GROUP_CHAT_ID ||
    !Number.isFinite(
      CUSTOMER_GROUP_CHAT_ID,
    )
  ) {
    return false;
  }

  if (
    chatId !==
    CUSTOMER_GROUP_CHAT_ID
  ) {
    return false;
  }

  const topicId =
    Number(
      message?.message_thread_id,
    );

  if (
    topicId !==
    CUSTOMER_TOPIC_ID
  ) {
    return false;
  }

  if (
    message?.from?.is_bot
  ) {
    return true;
  }

  if (
    text === "/template" ||
    text.startsWith(
      "/template@",
    )
  ) {
    await sendMessageToTopic(
      chatId,
      CUSTOMER_TOPIC_ID,
      customerRequestTemplate(),
    );
    return true;
  }

  await createCustomerGroupApplication(
    message,
  );

  return true;
}

// =====================================================
// MESSAGE
// =====================================================

async function handleMessage(
  message: any,
) {
  await refreshDynamicAdmins();

  if (
    !message?.chat ||
    !message?.from
  ) {
    return;
  }

  // Групи: спочатку окрема група замовників,
  // потім службова робоча група.
  if (
    message.chat.type !==
    "private"
  ) {
    const customerHandled =
      await handleCustomerGroupMessage(
        message,
      );

    if (
      customerHandled
    ) {
      return;
    }

    await handleRegionBinding(
      message,
    );
    return;
  }

  const chatId =
    message.chat.id;

  const user =
    message.from;

  const text =
    typeof message.text ===
    "string"
      ? message.text.trim()
      : "";

  if (
    !isAdmin(user.id) &&
    !(await rateLimitAllowed(user.id))
  ) {
    await sendMessage(
      chatId,
      "⏳ Забагато повідомлень. Спробуйте ще раз через хвилину.",
    );
    return;
  }

  if (await serviceWorkflow.message(message)) return;

  // ===================================================
  // CHAT ID
  // ===================================================

  if (
    text ===
    "/chatid"
  ) {
    await sendMessage(
      chatId,
      `🆔 Chat ID:\n<code>${chatId}</code>`,
    );

    return;
  }

  // ===================================================
  // ADMIN / CONTRACTOR MODE SWITCH
  // ===================================================

  if (
    isAdmin(user.id) &&
    text ===
      "/start"
  ) {
    await clearSession(
      user.id,
    );

    await sendMessage(
      chatId,
      "👑 <b>Адмін-панель</b>\n" +
        "━━━━━━━━━━━━━━━━\n" +
        "Керування заявками, актами, підрядниками та замовниками.\n\n" +
        "Оберіть потрібний розділ 👇",
      adminMenu(),
    );

    return;
  }

  if (
    isAdmin(user.id) &&
    text ===
      "👷 Панель підрядника"
  ) {
    const contractor =
      await registerContractor(
        user,
        "active",
      );

    if (!contractor) {
      await sendMessage(
        chatId,
        "❌ Не вдалося відкрити панель підрядника.",
        adminMenu(),
      );

      return;
    }

    await setSession(
      user.id,
      "admin_contractor_mode",
    );

    await sendMessage(
      chatId,
      "👷 <b>Кабінет виконавця</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Ви працюєте в режимі підрядника.\n" +
        "Для повернення натисніть «👑 Адмін панель».",
      mainMenu(user.id),
    );

    return;
  }

  if (
    isAdmin(user.id) &&
    text ===
      "👑 Адмін панель"
  ) {
    await clearSession(
      user.id,
    );

    await sendMessage(
      chatId,
      "👑 <b>Адмін-панель</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Ви повернулися до адмін-панелі.",
      adminMenu(),
    );

    return;
  }

  const currentSession =
    await getSession(
      user.id,
    );

  const adminInContractorMode =
    isAdmin(user.id) &&
    isAdminContractorState(
      currentSession?.state,
    );

  // ===================================================
  // ADMIN
  // ===================================================

  if (
    isAdmin(user.id) &&
    !adminInContractorMode
  ) {
    const adminSession =
      currentSession;

    // CANCEL

    if (
      text ===
      "❌ Скасувати"
    ) {
      await clearSession(
        user.id,
      );

      await sendMessage(
        chatId,
        "❌ Скасовано.",
        ["admin_search_contractor", "admin_region_contractor_search", "admin_broadcast"]
            .includes(adminSession?.state ?? "") ? contractorAdminMenu() : adminMenu(),
      );

      return;
    }

    // PAYOUT AMOUNT

    if (
      adminSession?.state?.startsWith(
        "admin_payout_amount:",
      )
    ) {
      const applicationId =
        adminSession.state.substring(
          "admin_payout_amount:".length,
        );

      const normalized =
        String(text || "")
          .replace(/\s/g, "")
          .replace(",", ".");

      const amount =
        Number(
          normalized,
        );

      if (
        !Number.isFinite(
          amount,
        ) ||
        amount <= 0
      ) {
        await sendMessage(
          chatId,
          "❗ Введіть коректну суму більше 0.\n\n" +
            "Наприклад: <code>2500</code> або <code>2500.50</code>",
          cancelMenu(),
        );
        return;
      }

      const {
        data: updatedApp,
        error,
      } = await supabase
        .from("applications")
        .update({
          payout_amount:
            Math.round(
              amount * 100,
            ) / 100,
          payout_status:
            "pending",
          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          applicationId,
        )
        .neq(
          "payout_status",
          "paid",
        )
        .select("*")
        .maybeSingle();

      if (
        error ||
        !updatedApp
      ) {
        await sendMessage(
          chatId,
          "❌ Не вдалося зберегти суму виплати.\n\n" +
            `<code>${escapeHtml(
              error?.message ||
                "Невідома помилка",
            )}</code>`,
          adminMenu(),
        );
        return;
      }

      await clearSession(
        user.id,
      );

      await sendMessage(
        chatId,
        "✅ <b>Суму виплати збережено</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          `🔢 ${escapeHtml(
            updatedApp.application_number ||
              "G-0000",
          )}\n` +
          `💰 <b>${Number(
            updatedApp.payout_amount,
          ).toFixed(2)} грн</b>`,
        adminMenu(),
      );

      await showAdminPayoutCard(
        chatId,
        applicationId,
      );
      return;
    }

    // PAYOUT RECEIPT

    if (
      adminSession?.state?.startsWith(
        "admin_payout_receipt:",
      )
    ) {
      const applicationId =
        adminSession.state.substring(
          "admin_payout_receipt:".length,
        );

      let fileId:
        string | null =
          null;

      let fileType:
        "photo" |
        "document" |
        null =
          null;

      let fileName:
        string | null =
          null;

      if (
        message.document
      ) {
        fileId =
          message.document.file_id;
        fileType =
          "document";
        fileName =
          message.document.file_name ||
          "receipt";
      } else if (
        Array.isArray(
          message.photo,
        ) &&
        message.photo.length
      ) {
        const photo =
          message.photo[
            message.photo.length -
              1
          ];

        fileId =
          photo.file_id;
        fileType =
          "photo";
        fileName =
          "receipt.jpg";
      }

      if (
        !fileId ||
        !fileType
      ) {
        await sendMessage(
          chatId,
          "🧾 Надішліть <b>фото або PDF квитанції</b>.\n\n" +
            "Після завантаження виплата буде підтверджена.",
          cancelMenu(),
        );
        return;
      }

      const { data: app, error: appError } =
        await supabase
          .from("applications")
          .select("*")
          .eq(
            "id",
            applicationId,
          )
          .eq(
            "status",
            "completed",
          )
          .maybeSingle();

      if (
        appError ||
        !app
      ) {
        await clearSession(
          user.id,
        );

        await sendMessage(
          chatId,
          "❌ Заявку для виплати не знайдено.",
          adminMenu(),
        );
        return;
      }

      if (
        app.payout_status ===
        "paid"
      ) {
        await clearSession(
          user.id,
        );

        await sendMessage(
          chatId,
          "ℹ️ Цю виплату вже було підтверджено.",
          adminMenu(),
        );
        return;
      }

      const paidAt =
        new Date()
          .toISOString();

      const { data: paidApp, error: payError } =
        await supabase
          .from("applications")
          .update({
            payout_status:
              "paid",
            paid_at:
              paidAt,
            paid_by:
              user.id,
            payout_receipt_file_id:
              fileId,
            payout_receipt_type:
              fileType,
            payout_receipt_name:
              fileName,
          })
          .eq(
            "id",
            applicationId,
          )
          .neq(
            "payout_status",
            "paid",
          )
          .select("*")
          .maybeSingle();

      if (
        payError ||
        !paidApp
      ) {
        await sendMessage(
          chatId,
          "❌ Не вдалося підтвердити виплату.\n\n" +
            `<code>${escapeHtml(
              payError?.message ||
                "Невідома помилка",
            )}</code>`,
          adminMenu(),
        );
        return;
      }

      await clearSession(
        user.id,
      );

      const { data: payoutContractor } =
        await supabase
          .from("contractors")
          .select(
            "telegram_id,first_name,last_name",
          )
          .eq(
            "id",
            paidApp.contractor_id,
          )
          .maybeSingle();

      const payoutAmount =
        Number(
          paidApp.payout_amount ||
            0,
        );

      await sendMessage(
        chatId,
        "✅ <b>Виплату підтверджено</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          `🔢 ${escapeHtml(
            paidApp.application_number ||
              "G-0000",
          )}\n` +
          `💰 <b>${payoutAmount.toFixed(
            2,
          )} грн</b>\n` +
          "🧾 Квитанцію збережено.",
        adminMenu(),
      );

      await sendPayoutReceipt(
        chatId,
        paidApp,
        "🧾 <b>Квитанція збережена</b>",
      );

      if (
        payoutContractor?.telegram_id
      ) {
        await sendMessage(
          payoutContractor.telegram_id,
          "💰 <b>Виплату проведено</b>\n" +
            "━━━━━━━━━━━━━━━━\n\n" +
            `🔢 Заявка: <b>${escapeHtml(
              paidApp.application_number ||
                "G-0000",
            )}</b>\n` +
            `💵 Сума: <b>${payoutAmount.toFixed(
              2,
            )} грн</b>\n` +
            `📅 ${escapeHtml(
              formatKyivDate(
                paidAt,
              ),
            )}`,
          mainMenu(
            payoutContractor.telegram_id,
          ),
        );

        await sendPayoutReceipt(
          payoutContractor.telegram_id,
          paidApp,
          "🧾 <b>Квитанція про виплату</b>",
        );
      }

      return;
    }

    // CREATE APPLICATION

    if (
      text ===
      "➕ Створити заявку"
    ) {
      await clearSession(
        user.id,
      );

      await startCreateApplication(
        chatId,
        user.id,
      );

      return;
    }

    // CONTRACTOR SEARCH: PHONE / NAME / USERNAME

    if (
      adminSession?.state ===
      "admin_create_application_contractor"
    ) {
      const rawQuery =
        String(
          text ||
            "",
        ).trim();

      if (!rawQuery) {
        await sendMessage(
          chatId,
          "❗ Введіть частину номера, ім'я, прізвище або @username.",
          cancelMenu(),
        );
        return;
      }

      const queryLower =
        rawQuery
          .replace(/^@/, "")
          .toLowerCase();

      const queryDigits =
        rawQuery.replace(
          /\D/g,
          "",
        );

      const {
        data: allContractors,
        error,
      } = await supabase
        .from("contractors")
        .select(`
          id,
          first_name,
          last_name,
          username,
          phone,
          region_name,
          status
        `)
        .eq(
          "status",
          "active",
        )
        .order(
          "created_at",
          {
            ascending: false,
          },
        )
        .limit(500);

      if (error) {
        await sendMessage(
          chatId,
          "❌ Не вдалося виконати пошук.\n\n" +
            `<code>${escapeHtml(
              error.message,
            )}</code>`,
          adminMenu(),
        );
        return;
      }

      const matches =
        (allContractors || [])
          .filter(
            (contractor: any) => {
              const phoneDigits =
                String(
                  contractor.phone ||
                    "",
                ).replace(
                  /\D/g,
                  "",
                );

              const firstName =
                String(
                  contractor.first_name ||
                    "",
                ).toLowerCase();

              const lastName =
                String(
                  contractor.last_name ||
                    "",
                ).toLowerCase();

              const fullName =
                `${firstName} ${lastName}`.trim();

              const username =
                String(
                  contractor.username ||
                    "",
                )
                  .replace(/^@/, "")
                  .toLowerCase();

              const phoneMatch =
                queryDigits.length > 0 &&
                phoneDigits.includes(
                  queryDigits,
                );

              const nameMatch =
                firstName.includes(
                  queryLower,
                ) ||
                lastName.includes(
                  queryLower,
                ) ||
                fullName.includes(
                  queryLower,
                );

              const usernameMatch =
                username.includes(
                  queryLower,
                );

              return (
                phoneMatch ||
                nameMatch ||
                usernameMatch
              );
            },
          )
          .slice(
            0,
            30,
          );

      if (
        matches.length ===
        0
      ) {
        await sendMessage(
          chatId,
          "🔎 <b>Підрядника не знайдено</b>\n" +
            "━━━━━━━━━━━━━━━━\n\n" +
            `Запит: <code>${escapeHtml(
              rawQuery,
            )}</code>\n\n` +
            "Можна шукати за:\n" +
            "📱 будь-якою частиною номера\n" +
            "👤 ім'ям або прізвищем\n" +
            "🔹 @username",
          cancelMenu(),
        );
        return;
      }

      const buttons: any[][] =
        [];

      for (
        const contractor of
          matches
      ) {
        const name =
          `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
          "Без імені";

        const username =
          contractor.username
            ? ` • @${contractor.username}`
            : "";

        const rawPhone =
          contractor.phone ||
          "";

        const phoneDigits =
          rawPhone.replace(
            /\D/g,
            "",
          );

        let phoneDisplay =
          rawPhone ||
          "без номера";

        if (
          queryDigits.length >
          0 &&
          phoneDigits.length >=
            4
        ) {
          const last4 =
            phoneDigits.slice(
              -4,
            );

          phoneDisplay =
            rawPhone
              ? `${rawPhone} • …${last4}`
              : `…${last4}`;
        }

        let label =
          `✅ ${name} • ${phoneDisplay}${username}`;

        if (
          label.length >
          62
        ) {
          label =
            label.slice(
              0,
              59,
            ) + "...";
        }

        buttons.push([
          {
            text:
              label,
            callback_data:
              `newappcontractor:${contractor.id}`,
          },
        ]);
      }

      await sendMessage(
        chatId,
        "🔎 <b>Знайдені підрядники</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          `Запит: <code>${escapeHtml(
            rawQuery,
          )}</code>\n` +
          `Знайдено: <b>${matches.length}</b>\n\n` +
          "Оберіть потрібного підрядника 👇",
        {
          inline_keyboard:
            buttons,
        },
      );

      return;
    }

    // OBJECT

    if (
      adminSession?.state?.startsWith(
        "admin_create_application_object:",
      )
    ) {
      const contractorId =
        adminSession.state.substring(
          "admin_create_application_object:"
            .length,
        );

      if (!text) {
        await sendMessage(
          chatId,
          "❗ Вставте картку замовлення або напишіть назву АЗК / об'єкта.",
          cancelMenu(),
        );

        return;
      }

      const parsedCard =
        parseOrderCard(
          text,
        );

      if (parsedCard) {
        const objectName =
          `АЗК ${parsedCard.azkCode}` +
          `||ORDERMETA||${encodeURIComponent(
            parsedCard.azkCode,
          )}` +
          `||${encodeURIComponent(
            parsedCard.orderDate ||
              "",
          )}`;

        await sendMessage(
          chatId,
          "✅ <b>Картку розпізнано</b>\n" +
            "━━━━━━━━━━━━━━━━\n\n" +
            `🏢 Код АЗК: <b>${escapeHtml(
              parsedCard.azkCode,
            )}</b>\n` +
            `📍 Локація: <b>${escapeHtml(
              parsedCard.location,
            )}</b>\n` +
            `🔧 Потреба: <b>${escapeHtml(
              parsedCard.need,
            )}</b>` +
            (parsedCard.orderDate
              ? `\n📅 Дата з картки: <b>${escapeHtml(
                  parsedCard.orderDate,
                )}</b>`
              : "") +
            "\n\nДалі вкажіть дедлайн.",
          cancelMenu(),
        );

        await askApplicationDeadline(
          chatId,
          user.id,
          contractorId,
          objectName,
          parsedCard.need,
          parsedCard.location,
        );

        return;
      }

      await askApplicationWork(
        chatId,
        user.id,
        text,
        contractorId,
      );

      return;
    }

    // WORK

    if (
      adminSession?.state?.startsWith(
        "admin_create_application_work:",
      )
    ) {
      const raw =
        adminSession.state.substring(
          "admin_create_application_work:"
            .length,
        );

      const firstColon =
        raw.indexOf(":");

      const contractorId =
        raw.substring(
          0,
          firstColon,
        );

      const encodedObject =
        raw.substring(
          firstColon + 1,
        );

      const objectName =
        decodeURIComponent(
          encodedObject,
        );

      if (!text) {
        await sendMessage(
          chatId,
          "❗ Напишіть, яку роботу потрібно виконати.",
          cancelMenu(),
        );

        return;
      }

      await askApplicationAddress(
        chatId,
        user.id,
        contractorId,
        objectName,
        text,
      );

      return;
    }

    // ADDRESS

    if (
      adminSession?.state?.startsWith(
        "admin_create_application_address:",
      )
    ) {
      const raw =
        adminSession.state.substring(
          "admin_create_application_address:"
            .length,
        );

      const firstColon =
        raw.indexOf(":");

      const secondColon =
        raw.indexOf(
          ":",
          firstColon + 1,
        );

      const contractorId =
        raw.substring(
          0,
          firstColon,
        );

      const encodedObject =
        raw.substring(
          firstColon + 1,
          secondColon,
        );

      const encodedWork =
        raw.substring(
          secondColon + 1,
        );

      const objectName =
        decodeURIComponent(
          encodedObject,
        );

      const workName =
        decodeURIComponent(
          encodedWork,
        );

      const address =
        text.toLowerCase() ===
          "пропуск" ||
        text === "-"
          ? null
          : text;

      await askApplicationDeadline(
        chatId,
        user.id,
        contractorId,
        objectName,
        workName,
        address,
      );

      return;
    }

    // DEADLINE

    if (
      adminSession?.state?.startsWith(
        "admin_create_application_deadline:",
      )
    ) {
      const raw = adminSession.state.substring(
        "admin_create_application_deadline:".length,
      );
      const parts = raw.split("|");
      const contractorId = parts[0] || "";
      const objectName = decodeURIComponent(parts[1] || "");
      const workName = decodeURIComponent(parts[2] || "");
      const addressRaw = decodeURIComponent(parts[3] || "");
      const address = addressRaw || null;

      const parsedDeadline = parseKyivDeadline(text);
      if (parsedDeadline === null) {
        await sendMessage(
          chatId,
          "❗ Невірний формат.\n\nВведіть, наприклад:\n<code>25.08.2026 18:00</code>\n\nАбо <b>пропуск</b>.",
          cancelMenu(),
        );
        return;
      }

      await askApplicationComment(
        chatId,
        user.id,
        contractorId,
        objectName,
        workName,
        address,
        parsedDeadline || null,
      );
      return;
    }

    // MANAGER COMMENT

    if (
      adminSession?.state?.startsWith(
        "admin_create_application_comment:",
      )
    ) {
      const raw = adminSession.state.substring(
        "admin_create_application_comment:".length,
      );
      const parts = raw.split("|");
      const contractorId = parts[0] || "";
      const objectName = decodeURIComponent(parts[1] || "");
      const workName = decodeURIComponent(parts[2] || "");
      const addressRaw = decodeURIComponent(parts[3] || "");
      const deadlineRaw = decodeURIComponent(parts[4] || "");

      const managerComment =
        text.toLowerCase() === "пропуск" || text === "-"
          ? null
          : text;

      await createApplication(
        chatId,
        user.id,
        contractorId,
        objectName,
        workName,
        addressRaw || null,
        deadlineRaw || null,
        managerComment,
      );

      return;
    }

    // SEARCH CONTRACTOR

    if (adminSession?.state === "admin_search_contractor") {
      await clearSession(user.id);
      await searchContractors(chatId, text);
      return;
    }

    // SEARCH APPLICATION

    if (adminSession?.state === "admin_search_application") {
      await clearSession(user.id);
      await searchApplications(chatId, text);
      return;
    }

    // CONTRACTOR NOTE

    if (
      adminSession?.state?.startsWith(
        "admin_contractor_note:",
      )
    ) {
      const contractorId = adminSession.state.substring(
        "admin_contractor_note:".length,
      );

      const { error } = await supabase
        .from("contractors")
        .update({ manager_notes: text || null })
        .eq("id", contractorId);

      await clearSession(user.id);

      if (error) {
        await sendMessage(
          chatId,
          "❌ Не вдалося зберегти нотатку.\n\n" +
            `<code>${escapeHtml(error.message)}</code>`,
          adminMenu(),
        );
        return;
      }

      await sendMessage(
        chatId,
        "✅ Нотатку збережено.",
        adminMenu(),
      );
      await showContractorCard(chatId, contractorId);
      return;
    }

    // BROADCAST

    if (
      adminSession?.state ===
      "admin_broadcast"
    ) {
      if (!text) {
        await sendMessage(
          chatId,
          "❗ Напишіть текст.",
          cancelMenu(),
        );

        return;
      }

      await broadcast(
        chatId,
        user.id,
        text,
      );

      return;
    }

    // ADMIN MENU

    if (
      text ===
      "💰 Виплати"
    ) {
      await clearSession(
        user.id,
      );

      await showAdminPayouts(
        chatId,
      );

      return;
    }

    if (
      text ===
      "📊 Статистика"
    ) {
      await clearSession(
        user.id,
      );

      await showStatsPro(
        chatId,
      );

      return;
    }

    if (text === "👥 Підрядники") {
      await clearSession(user.id);
      await sendMessage(chatId, "👥 <b>Підрядники</b>\n\nОберіть дію.", contractorAdminMenu());
      return;
    }

    if (text === "📋 Список підрядників" || text === "⏳ Нові підрядники") {
      await clearSession(user.id);
      await showContractorsPaged(chatId, 0, null, text === "⏳ Нові підрядники" ? "pending" : "all");
      return;
    }

    if (
      text ===
      "🗑 Видалені підрядники"
    ) {
      await clearSession(
        user.id,
      );

      await showContractorsPaged(chatId, 0, null, "deleted");

      return;
    }

    if (
      text ===
      "📋 Заявки"
    ) {
      await clearSession(
        user.id,
      );

      await showApplicationsFiltered(
        chatId,
        "all",
        0,
      );

      return;
    }

    if (
      text ===
      "📑 Акти"
    ) {
      await clearSession(
        user.id,
      );

      await showActsPaged(
        chatId,
        0,
      );

      return;
    }

    if (
      text ===
      "📚 Історія робіт"
    ) {
      await clearSession(
        user.id,
      );

      await showHistoryPaged(
        chatId,
        0,
      );

      return;
    }

    if (
      text ===
      "🔎 Пошук підрядника"
    ) {
      await setSession(user.id, "admin_search_contractor");
      await sendMessage(
        chatId,
        "🔎 <b>Пошук підрядника</b>\n━━━━━━━━━━━━━━━━\n\n" +
          "Введіть ім’я, прізвище, username або номер телефону.",
        cancelMenu(),
      );
      return;
    }

    if (
      text ===
      "🔎 Пошук заявки"
    ) {
      await setSession(user.id, "admin_search_application");
      await sendMessage(
        chatId,
        "🔎 <b>Пошук заявки</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          "Введіть будь-який із варіантів:\n\n" +
          "🔢 Номер заявки: <code>G-4315</code>\n" +
          "📱 Повний телефон: <code>+380XXXXXXXXX</code>\n" +
          "📱 Останні 4 цифри: <code>5140</code>\n" +
          "🏢 Код АЗК: <code>189</code> або <code>АЗК 189</code>\n" +
          "⛽ Мережа: <code>WOG</code> або <code>UPG</code>",
        cancelMenu(),
      );
      return;
    }

    if (
      text ===
      "📤 Експорт CSV"
    ) {
      await clearSession(user.id);
      await exportCompletedCsv(chatId);
      return;
    }

    if (
      text ===
      "📢 Розсилка"
    ) {
      await setSession(
        user.id,
        "admin_broadcast",
      );

      await sendMessage(
        chatId,
        "📢 <b>Розсилка</b>\n━━━━━━━━━━━━━━━━\n\n" +
          "Напишіть текст повідомлення.",
        cancelMenu(),
      );

      return;
    }

    if (
      text ===
      "🔙 Головне меню"
    ) {
      const contractor =
        await registerContractor(
          user,
          "active",
        );

      if (!contractor) {
        await sendMessage(
          chatId,
          "❌ Не вдалося відкрити панель підрядника.",
          adminMenu(),
        );

        return;
      }

      await setSession(
        user.id,
        "admin_contractor_mode",
      );

      await sendMessage(
        chatId,
        "👷 <b>Кабінет виконавця</b>\n━━━━━━━━━━━━━━━━",
        mainMenu(user.id),
      );

      return;
    }

    if (
      text ===
      "🗺 Регіон підрядника"
    ) {
      await startContractorRegionAssignment(
        chatId,
        user.id,
      );
      return;
    }

    if (
      text ===
      "🌍 Регіони"
    ) {
      await clearSession(
        user.id,
      );

      await showRegions(
        chatId,
      );

      return;
    }

    if (
      adminSession?.state ===
      "admin_region_contractor_search"
    ) {
      await searchContractorForRegion(
        chatId,
        text,
      );
      return;
    }

    if (
      text ===
      "/start"
    ) {
      await clearSession(
        user.id,
      );

      await sendMessage(
        chatId,
        "👑 <b>Адмін-панель</b>\n" +
          "━━━━━━━━━━━━━━━━\n" +
          "Керування заявками, актами, підрядниками та замовниками.\n\n" +
          "Оберіть потрібний розділ 👇",
        adminMenu(),
      );

      return;
    }

    await sendMessage(
      chatId,
      "👑 <b>Адмін-панель</b>\n━━━━━━━━━━━━━━━━\n\nОберіть потрібний розділ:",
      adminMenu(),
    );

    return;
  }

  // ===================================================
  // CONTRACTOR
  // ===================================================

  if (text === "/start") {
    await showCabinetChoice(chatId, user.id);
    return;
  }

  const cabinetState = currentSession?.state;
  const choosingCabinet = cabinetState === "choosing_cabinet";
  const inCustomerCabinet = cabinetState === "customer_cabinet";
  const waitingForContractorPhone = cabinetState === "contractor_phone";
  const openingContractorCabinet = (text === CONTRACTOR_CABINET || text === "Кабінет підрядника") &&
    (choosingCabinet || inCustomerCabinet || waitingForContractorPhone);

  if ((choosingCabinet || inCustomerCabinet) && !openingContractorCabinet) {
    if ((text === CUSTOMER_CABINET || text === "Кабінет замовника") && !(await setSession(user.id, "customer_cabinet"))) {
      await sendMessage(chatId, "Не вдалося вибрати кабінет. Спробуйте ще раз.", cabinetMenu());
      return;
    }

    const response = (text === CUSTOMER_CABINET || text === "Кабінет замовника") || inCustomerCabinet
      ? "Ви обрали кабінет менеджера АЗК. Кабінет ще готується."
      : CHOOSE_CABINET;
    await sendMessage(chatId, response, cabinetMenu());
    return;
  }

  let contractor =
    await getContractor(
      user.id,
    );

  const needsContractorPhone = !contractor ||
    (!contractor.phone && contractor.status !== "deleted" && contractor.status !== "rejected");
  if (needsContractorPhone && !adminInContractorMode) {
    if (openingContractorCabinet) {
      if (!(await setSession(user.id, "contractor_phone"))) {
        await sendMessage(chatId, "Не вдалося вибрати кабінет. Спробуйте ще раз.", cabinetMenu());
        return;
      }
    } else if (!waitingForContractorPhone) {
      await showCabinetChoice(chatId, user.id);
      return;
    }
  }

  const closeCabinetMenu = openingContractorCabinet ? { remove_keyboard: true } : undefined;
  if (openingContractorCabinet && !needsContractorPhone) {
    await resetContractorSession(user.id);
  }

  if (!contractor) {
    const contact = message?.contact;

    if (!contact) {
      await sendMessage(
        chatId,
        "📱 <b>Підтвердження номера телефону</b>\n━━━━━━━━━━━━━━━━\n\n" +
          "Щоб подати заявку на доступ, надішліть свій номер телефону кнопкою нижче.\n\n" +
          "Номер буде прикріплено до вашого профілю підрядника.",
        contactRequestMenu(),
      );
      return;
    }

    // Не дозволяємо надіслати чужий контакт замість власного.
    if (
      contact.user_id &&
      contact.user_id !== user.id
    ) {
      await sendMessage(
        chatId,
        "❌ Будь ласка, надішліть <b>власний</b> номер телефону кнопкою нижче.",
        contactRequestMenu(),
      );
      return;
    }

    const rawPhone = String(
      contact.phone_number || "",
    ).trim();

    if (!rawPhone) {
      await sendMessage(
        chatId,
        "❌ Не вдалося отримати номер телефону. Спробуйте ще раз.",
        contactRequestMenu(),
      );
      return;
    }

    const phone =
      rawPhone.startsWith("+")
        ? rawPhone
        : `+${rawPhone}`;

    contractor =
      await registerContractor(
        user,
        "pending",
        phone,
      );

    if (!contractor) {
      await sendMessage(
        chatId,
        "❌ Не вдалося створити заявку на доступ.\n\n" +
          "Перевірте, що в таблиці <code>contractors</code> є колонка <code>phone</code>.",
      );
      return;
    }

    await resetContractorSession(user.id);
    await notifyAdminsAboutContractor(contractor);

    await sendMessage(
      chatId,
      "✅ <b>Номер телефону збережено</b>\n━━━━━━━━━━━━━━━━\n\n" +
        `📱 ${escapeHtml(phone)}\n\n` +
        "⏳ Заявку на доступ відправлено адміністратору.\n" +
        "Адміністратор призначить робочий регіон та підтвердить доступ.",
    );
    return;
  }

  // Старі підрядники, у яких номер ще не був прив'язаний.
  // Для deleted/rejected доступ не відновлюємо через прив'язку номера.
  if (
    !contractor.phone &&
    contractor.status !== "deleted" &&
    contractor.status !== "rejected"
  ) {
    const contact = message?.contact;

    if (!contact) {
      await sendMessage(
        chatId,
        "📱 <b>Потрібно прив'язати номер телефону</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          "Ваш профіль був створений раніше без номера телефону.\n\n" +
          "Натисніть кнопку нижче та надішліть <b>свій номер</b>.\n" +
          "Після цього номер буде автоматично прикріплено до вашого профілю.",
        contactRequestMenu(),
      );
      return;
    }

    if (
      contact.user_id &&
      contact.user_id !== user.id
    ) {
      await sendMessage(
        chatId,
        "❌ Можна прив'язати тільки <b>власний номер телефону</b>.\n\n" +
          "Натисніть кнопку нижче та надішліть свій контакт.",
        contactRequestMenu(),
      );
      return;
    }

    const rawPhone = String(
      contact.phone_number || "",
    ).trim();

    if (!rawPhone) {
      await sendMessage(
        chatId,
        "❌ Не вдалося отримати номер телефону. Спробуйте ще раз.",
        contactRequestMenu(),
      );
      return;
    }

    const phone =
      rawPhone.startsWith("+")
        ? rawPhone
        : `+${rawPhone}`;

    const {
      data: updatedContractor,
      error: phoneUpdateError,
    } = await supabase
      .from("contractors")
      .update({
        phone,
        first_name:
          user.first_name ??
          contractor.first_name ??
          null,
        last_name:
          user.last_name ??
          contractor.last_name ??
          null,
        username:
          user.username ??
          contractor.username ??
          null,
      })
      .eq("id", contractor.id)
      .select("*")
      .maybeSingle();

    if (
      phoneUpdateError ||
      !updatedContractor
    ) {
      console.error(
        "LINK EXISTING CONTRACTOR PHONE ERROR:",
        phoneUpdateError,
      );

      await sendMessage(
        chatId,
        "❌ Не вдалося прив'язати номер телефону.\n\n" +
          `<code>${escapeHtml(
            phoneUpdateError?.message ||
              "Невідома помилка",
          )}</code>`,
        contactRequestMenu(),
      );
      return;
    }

    contractor =
      updatedContractor;

    if (waitingForContractorPhone) {
      await resetContractorSession(user.id);
    }

    if (
      contractor.status ===
      "pending"
    ) {
      await notifyAdminsAboutContractor(
        contractor,
      );

      await sendMessage(
        chatId,
        "✅ <b>Номер телефону прив'язано</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          `📱 ${escapeHtml(phone)}\n\n` +
          "⏳ Ваша заявка все ще очікує підтвердження адміністратора.",
      );
      return;
    }

    await sendMessage(
      chatId,
      "✅ <b>Номер телефону прив'язано</b>\n" +
        "━━━━━━━━━━━━━━━━\n\n" +
        `📱 ${escapeHtml(phone)}\n\n` +
        "Доступ до кабінету підрядника збережено.",
      mainMenu(user.id),
    );

    return;
  }

  if (contractor.status === "pending") {
    await sendMessage(
      chatId,
      "⏳ <b>Заявка очікує підтвердження</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Після рішення адміністратора бот повідомить вас.",
      closeCabinetMenu,
    );
    return;
  }

  if (contractor.status === "rejected") {
    await sendMessage(
      chatId,
      "❌ <b>Доступ не підтверджено</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Зверніться до адміністратора, якщо вважаєте це помилкою.",
      closeCabinetMenu,
    );
    return;
  }

  if (contractor.status === "deleted") {
    await sendMessage(
      chatId,
      "⛔ <b>Доступ закрито</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Ваш обліковий запис підрядника було видалено адміністратором.",
      closeCabinetMenu,
    );
    return;
  }

  if (contractor.status !== "active") {
    await sendMessage(
      chatId,
      "⛔ Доступ до бота наразі недоступний.",
      closeCabinetMenu,
    );
    return;
  }

  if (openingContractorCabinet) {
    await sendMessage(
      chatId,
      `👋 Вітаємо, <b>${escapeHtml(
        contractor.first_name ||
          user.first_name ||
          "користувач",
      )}</b>!\n\n` +
        "👷 <b>Кабінет виконавця</b>\n" +
        "━━━━━━━━━━━━━━━━\n" +
        "Оберіть потрібний розділ 👇",
      mainMenu(user.id),
    );

    return;
  }

  // CANCEL

  if (
    text ===
    "❌ Скасувати"
  ) {
    await resetContractorSession(
      user.id,
    );

    await sendMessage(
      chatId,
      "↩️ Дію скасовано.",
      mainMenu(user.id),
    );

    return;
  }

  // APPLICATIONS

  if (
    text ===
    "📋 Мої заявки"
  ) {
    await resetContractorSession(
      user.id,
    );

    await showApplications(
      chatId,
      user.id,
    );

    return;
  }

  // PAYOUTS

  if (
    text ===
    "💰 Виплати"
  ) {
    await resetContractorSession(
      user.id,
    );

    await showContractorPayouts(
      chatId,
      user.id,
    );

    return;
  }

  // HISTORY

  if (
    text ===
    "📄 Історія робіт"
  ) {
    await resetContractorSession(
      user.id,
    );

    await showHistory(
      chatId,
      user.id,
    );

    return;
  }

  // MANAGER

  if (
    text ===
    "🛟 Підтримка"
  ) {
    await setSession(
      user.id,
      "manager_message",
    );

    await sendMessage(
      chatId,
      "🛟 <b>Підтримка</b>\n━━━━━━━━━━━━━━━━\n\n" +
        "Напишіть ваше питання — менеджер отримає повідомлення.",
      cancelMenu(),
    );

    return;
  }

  // SESSION

  const session =
    await getSession(
      user.id,
    );

  if (
    session?.state?.startsWith(
      "contractor_departure:",
    )
  ) {
    const applicationId =
      session.state.substring(
        "contractor_departure:".length,
      );

    const skipped =
      text ===
      "⏭ Пропустити";

    if (
      !skipped &&
      !message?.location
    ) {
      await sendMessage(
        chatId,
        "📍 Надішліть геолокацію або натисніть «⏭ Пропустити».",
        departureLocationMenu(),
      );
      return;
    }

    const updateData:
      Record<string, unknown> = {
        contractor_stage:
          "departed",
        departed_at:
          new Date()
            .toISOString(),
        updated_at:
          new Date()
            .toISOString(),
      };

    if (
      message?.location
    ) {
      updateData.contractor_lat =
        Number(
          message.location.latitude,
        );
      updateData.contractor_lng =
        Number(
          message.location.longitude,
        );
    }

    await supabase
      .from("applications")
      .update(
        updateData,
      )
      .eq(
        "id",
        applicationId,
      )
      .eq(
        "contractor_id",
        contractor.id,
      );

    await resetContractorSession(
      user.id,
    );

    await sendMessage(
      chatId,
      skipped
        ? "🚗 <b>Виїзд зафіксовано</b>\n\nГеолокацію пропущено."
        : "✅ <b>Геолокацію зафіксовано</b>\n\n🚗 Виїзд на об'єкт відмічено.",
      mainMenu(user.id),
    );

    await showContractorApplicationCard(
      chatId,
      user.id,
      applicationId,
    );
    return;
  }

  if (
    session?.state?.startsWith(
      "contractor_problem:",
    )
  ) {
    const applicationId =
      session.state.substring(
        "contractor_problem:".length,
      );

    if (!text) {
      await sendMessage(
        chatId,
        "❗ Напишіть короткий опис проблеми.",
        cancelMenu(),
      );
      return;
    }

    await supabase
      .from("applications")
      .update({
        has_problem:
          true,
        problem_comment:
          text,
        contractor_stage:
          "problem",
        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        applicationId,
      )
      .eq(
        "contractor_id",
        contractor.id,
      );

    const { data: problemApplication } =
      await supabase
        .from("applications")
        .select(
          "application_number,title",
        )
        .eq(
          "id",
          applicationId,
        )
        .maybeSingle();

    for (
      const adminId of
        ADMIN_IDS
    ) {
      await sendMessage(
        adminId,
        "⚠️ <b>Проблема по заявці</b>\n" +
          "━━━━━━━━━━━━━━━━\n\n" +
          `🔢 Заявка: <b>${escapeHtml(
            problemApplication?.application_number ||
              "G-0000",
          )}</b>\n` +
          `🏢 Об'єкт: <b>${escapeHtml(
            problemApplication?.title ||
              "Без назви",
          )}</b>\n` +
          `👤 Підрядник: <b>${escapeHtml(
            `${contractor.first_name || ""} ${contractor.last_name || ""}`.trim() ||
              "Без імені",
          )}</b>\n` +
          `💬 Проблема: ${escapeHtml(
            text,
          )}`,
        adminMenu(),
      );
    }

    await resetContractorSession(
      user.id,
    );

    await sendMessage(
      chatId,
      "✅ Проблему передано менеджеру.",
      mainMenu(user.id),
    );

    await showContractorApplicationCard(
      chatId,
      user.id,
      applicationId,
    );
    return;
  }

  // MULTI-FILE ACT UPLOAD

  if (
    session?.state?.startsWith(
      "waiting_act_start:",
    )
  ) {
    const applicationId = session.state.substring(
      "waiting_act_start:".length,
    );

    const result = await addActFile(
      message,
      contractor,
      applicationId,
      null,
    );

    if (!result.ok || !result.actId) {
      await sendMessage(
        chatId,
        "📎 Надішліть фото або PDF акта.",
        actUploadMenu(),
      );
      return;
    }

    // Один файл = готовий акт. Жодних додаткових підтверджень від підрядника.
    await finalizeMultiAct(chatId, user.id, result.actId);
    return;
  }

  if (
    session?.state?.startsWith(
      "waiting_act_files:",
    )
  ) {
    const raw = session.state.substring(
      "waiting_act_files:".length,
    );
    const sep = raw.indexOf(":");
    const applicationId = raw.substring(0, sep);
    const actId = raw.substring(sep + 1);

    if (text === "✅ Завершити завантаження") {
      await finalizeMultiAct(
        chatId,
        user.id,
        actId,
      );
      return;
    }

    const result = await addActFile(
      message,
      contractor,
      applicationId,
      actId,
    );

    if (!result.ok) {
      await sendMessage(
        chatId,
        "📎 Надішліть фото/PDF або натисніть «✅ Завершити завантаження».",
        actUploadMenu(),
      );
      return;
    }

    await sendMessage(
      chatId,
      `✅ Файл додано. Всього: <b>${result.count || 1}</b>`,
      actUploadMenu(),
    );
    return;
  }

  // MANAGER MESSAGE

  if (
    session?.state ===
    "manager_message"
  ) {
    if (!text) {
      await sendMessage(
        chatId,
        "❗ Напишіть повідомлення.",
        cancelMenu(),
      );

      return;
    }

    await saveManagerMessage(
      chatId,
      user.id,
      text,
    );

    await resetContractorSession(
      user.id,
    );

    return;
  }

  // DEFAULT

  await sendMessage(
    chatId,
    "👇 <b>Оберіть потрібний розділ</b>",
    mainMenu(user.id),
  );
}

// =====================================================
// WEB ADMIN NOTIFICATION
// =====================================================


// =====================================================
// WEB ADMIN -> TELEGRAM APPLICATION NOTIFICATION
// =====================================================

async function notifyApplicationFromWeb(
  applicationId: string,
) {
  const { data: application, error } = await supabase
    .from("applications")
    .select(`
      id,
      application_number,
      title,
      description,
      address,
      deadline_at,
      manager_comment,
      contractor_id,
      contractor_stage,
      status,
      contractor:contractors (
        telegram_id,
        first_name,
        last_name
      )
    `)
    .eq("id", applicationId)
    .maybeSingle();

  if (error || !application) {
    console.error("WEB APPLICATION NOTIFY ERROR:", error);
    return { ok: false, error: error?.message || "Application not found" };
  }

  const contractor: any = Array.isArray(application.contractor)
    ? application.contractor[0]
    : application.contractor;

  if (!application.contractor_id) {
    return { ok: false, error: "Application has no contractor" };
  }

  if (!contractor?.telegram_id) {
    return { ok: false, error: "Contractor has no telegram_id" };
  }

  if (["completed","cancelled"].includes(application.status)) return {ok:false,error:"Заявка закрита."};
  const result = await sendMessage(
    contractor.telegram_id,
    "📋 <b>ВАМ ПРИЗНАЧЕНО НОВУ ЗАЯВКУ</b>\n" +
      "━━━━━━━━━━━━━━━━\n\n" +
      `🔢 <b>${escapeHtml(application.application_number || "—")}</b>\n` +
      `🏢 ${escapeHtml(application.title || "—")}\n` +
      `🔧 ${escapeHtml(application.description || "—")}\n` +
      `📍 ${escapeHtml(application.address || "Адресу не вказано")}\n` +
      `⏰ ${escapeHtml(formatKyivDate(application.deadline_at))}` +
      (application.manager_comment
        ? `\n📝 ${escapeHtml(application.manager_comment)}`
        : "") +
      "\n\nПідтвердьте, чи готові виконати цю заявку.",
    {
      inline_keyboard: [[
        ...(application.contractor_stage === "offered" ? [{text:"✅ Прийняти",callback_data:`contractoraccept:${application.id}`},{text:"❌ Відмовитися",callback_data:`contractordecline:${application.id}`}] : []),
        {
          text: "📋 Відкрити заявку",
          callback_data: `contractorapp:${application.id}`,
        },
      ]],
    },
  );

  if (!result?.ok) {
    console.error("WEB TELEGRAM SEND ERROR:", result);
    return {
      ok: false,
      error: result?.description || result?.error || "Telegram send failed",
    };
  }

  const sentMessageId = result?.result?.message_id || null;

  if (sentMessageId) {
    const { error: saveMessageError } = await supabase
      .from("applications")
      .update({
        telegram_chat_id: contractor.telegram_id,
        telegram_message_id: sentMessageId,
      })
      .eq("id", application.id);

    if (saveMessageError) {
      console.error("SAVE APPLICATION TELEGRAM MESSAGE:", saveMessageError);
    }
  }

  return {
    ok: true,
    application_id: application.id,
    telegram_id: contractor.telegram_id,
    contractor_stage: application.contractor_stage,
    message_id: sentMessageId,
  };
}


// =====================================================
// DELETE APPLICATION FROM RVP CONTROL + TELEGRAM
// =====================================================

async function deleteApplicationFromWeb(applicationId: string) {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("id,application_number,telegram_chat_id,telegram_message_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (appError) return { ok: false, error: appError.message };
  if (!application) return { ok: true, already_deleted: true, application_id: applicationId };

  const { data: acts, error: actsError } = await supabase
    .from("acts")
    .select("id,group_chat_id,group_message_id")
    .eq("application_id", applicationId);

  if (actsError) return { ok: false, error: `acts: ${actsError.message}` };

  // 1) Delete linked act cards from the Telegram work group.
  for (const act of acts || []) {
    if (act.group_chat_id && act.group_message_id) {
      const tg = await telegram("deleteMessage", {
        chat_id: act.group_chat_id,
        message_id: act.group_message_id,
      });
      if (!tg?.ok) {
        console.warn("DELETE ACT TELEGRAM MESSAGE:", act.id, tg?.description || tg?.error);
      }
    }
  }

  // 2) Delete the application card from the contractor's private bot chat.
  if (application.telegram_chat_id && application.telegram_message_id) {
    const tg = await telegram("deleteMessage", {
      chat_id: application.telegram_chat_id,
      message_id: application.telegram_message_id,
    });
    if (!tg?.ok) {
      console.warn("DELETE APPLICATION TELEGRAM MESSAGE:", applicationId, tg?.description || tg?.error);
    }
  }

  const actIds = (acts || []).map((a: any) => a.id).filter(Boolean);

  // 3) Delete DB children first so foreign keys do not block the application delete.
  if (actIds.length) {
    const { error } = await supabase.from("act_files").delete().in("act_id", actIds);
    if (error) return { ok: false, error: `act_files: ${error.message}` };
  }

  for (const table of ["application_files", "application_comments"]) {
    const { error } = await supabase.from(table).delete().eq("application_id", applicationId);
    if (
      error &&
      !String(error.message).toLowerCase().includes("could not find the table") &&
      !String(error.message).toLowerCase().includes("schema cache")
    ) {
      return { ok: false, error: `${table}: ${error.message}` };
    }
  }

  // Notification center records for this application.
  const { error: notificationsError } = await supabase
    .from("notifications")
    .delete()
    .eq("application_id", applicationId);
  if (
    notificationsError &&
    !String(notificationsError.message).toLowerCase().includes("could not find the table") &&
    !String(notificationsError.message).toLowerCase().includes("schema cache")
  ) {
    return { ok: false, error: `notifications: ${notificationsError.message}` };
  }

  const { error: historyError } = await supabase
    .from("work_history")
    .delete()
    .eq("application_id", applicationId);
  if (historyError) return { ok: false, error: `work_history: ${historyError.message}` };

  const { error: deleteActsError } = await supabase
    .from("acts")
    .delete()
    .eq("application_id", applicationId);
  if (deleteActsError) return { ok: false, error: `acts: ${deleteActsError.message}` };

  // Remove unfinished bot sessions that still point at this application.
  await supabase.from("bot_sessions").delete().like("state", `%${applicationId}%`);

  const { error: deleteAppError } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId);

  if (deleteAppError) return { ok: false, error: deleteAppError.message };

  return {
    ok: true,
    application_id: applicationId,
    application_number: application.application_number,
  };
}

// =====================================================
// ORDER PARSER -> OLD BOT / SUPABASE
// =====================================================

async function publishExternalApplicationToWorkGroup(
  application: any,
  customerName: string,
  customerUsername: string | null,
) {
  let text =
    "📋 <b>НОВА ЗАЯВКА</b>\n" +
    "━━━━━━━━━━━━━━━━━━\n\n" +
    `🔢 <b>Номер:</b> ${escapeHtml(application.application_number || "G-0000")}\n` +
    `🏢 <b>Об'єкт:</b> ${escapeHtml(application.title || "—")}\n` +
    `📍 <b>Адреса:</b> ${escapeHtml(application.address || "—")}\n` +
    `🔧 <b>Робота:</b> ${escapeHtml(application.description || "—")}\n`;

  if (application.deadline_at) {
    text += `📅 <b>Термін:</b> ${escapeHtml(formatKyivDate(application.deadline_at))}\n`;
  }

  text +=
    "\n📌 <b>Статус:</b> 🆕 Нова\n" +
    "━━━━━━━━━━━━━━━━━━\n" +
    `👤 <b>Замовник:</b> ${escapeHtml(customerName || "Замовник")}` +
    (customerUsername ? ` (@${escapeHtml(customerUsername)})` : "");

  const result = await sendMessage(
    GROUP_CHAT_ID,
    text,
    {
      inline_keyboard: [[
        {
          text: "✅ Прийняти заявку",
          callback_data: `externalclaim:${application.id}`,
        },
      ]],
    },
  );

  if (!result?.ok) {
    console.error("EXTERNAL WORK GROUP SEND ERROR:", result);
    return {
      ok: false,
      error: result?.description || result?.error || "Telegram send failed",
    };
  }

  return {
    ok: true,
    message_id: result?.result?.message_id || null,
  };
}

async function sendNewApplicationPush(application: any) {
  if (!PUSH_INTERNAL_SECRET) {
    console.log("PUSH SKIPPED: PUSH_INTERNAL_SECRET is missing");
    return;
  }

  try {
    const response = await fetch(PUSH_NOTIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-push-secret": PUSH_INTERNAL_SECRET,
      },
      body: JSON.stringify({
        title: `🆕 Нова заявка ${application.application_number || ""}`.trim(),
        body: [application.title, application.address].filter(Boolean).join(" • "),
        application_id: application.id,
        application_number: application.application_number,
        url: "./",
      }),
    });

    const result = await response.json().catch(() => ({}));
    console.log("PUSH RESULT:", response.status, JSON.stringify(result));
  } catch (error) {
    console.error("PUSH ERROR:", error);
  }
}

async function createExternalApplication(payload: any) {
  const sourceChatId = Number(payload?.source_chat_id);
  const sourceMessageId = Number(payload?.source_message_id);
  const objectName = String(payload?.object || "").trim();
  const address = String(payload?.address || "").trim();
  const workName = String(payload?.work || "").trim();
  const deadlineText = String(payload?.deadline_text || "").trim() || null;
  const deadlineAt = String(payload?.deadline_at || "").trim() || null;
  const volume = String(payload?.volume || "").trim() || null;
  const phone = String(payload?.phone || "").trim() || null;
  const comment = String(payload?.comment || "").trim() || null;
  const customerName = String(payload?.customer_name || "Замовник").trim() || "Замовник";
  const customerUsername = String(payload?.customer_username || "").replace(/^@/, "").trim() || null;
  const customerTelegramId = payload?.customer_telegram_id ? Number(payload.customer_telegram_id) : null;
  const rawText = String(payload?.raw_text || "").trim();

  if (!Number.isFinite(sourceChatId) || !Number.isFinite(sourceMessageId) || !sourceMessageId) {
    return { ok: false, status: 400, error: "source_chat_id and source_message_id are required" };
  }

  if (!objectName || !address || !workName) {
    return { ok: false, status: 400, error: "object, address and work are required" };
  }

  const { data: existing, error: existingError } = await supabase
    .from("applications")
    .select("id,application_number,status")
    .eq("customer_chat_id", sourceChatId)
    .eq("customer_message_id", sourceMessageId)
    .maybeSingle();

  if (existingError) {
    console.error("EXTERNAL APPLICATION DUPLICATE CHECK:", existingError);
    return { ok: false, status: 500, error: existingError.message };
  }

  if (existing?.id) {
    return {
      ok: true,
      duplicate: true,
      application_id: existing.id,
      application_number: existing.application_number,
      status: existing.status,
      telegram_posted: true,
    };
  }

  const applicationNumber = await generateUniqueApplicationNumber();
  const managerCommentParts = [
    comment ? `Коментар замовника: ${comment}` : null,
    deadlineText ? `Дедлайн: ${deadlineText}` : null,
    volume ? `Об'єм: ${volume}` : null,
    phone ? `Телефон: ${phone}` : null,
    `Замовник: ${customerName}${customerUsername ? ` (@${customerUsername})` : ""}`,
    "Джерело: RVP Order Parser",
  ].filter(Boolean);

  const insertPayload: Record<string, unknown> = {
    application_number: applicationNumber,
    contractor_id: null,
    manager_id: null,
    title: objectName,
    description: workName,
    address,
    deadline_at: deadlineAt,
    scheduled_at: deadlineAt,
    manager_comment: managerCommentParts.join("\n"),
    status: "new",
    contractor_stage: "unassigned",
    request_source: "order_parser",
    customer_chat_id: sourceChatId,
    customer_message_id: sourceMessageId,
    customer_telegram_id: Number.isFinite(customerTelegramId) ? customerTelegramId : null,
    customer_name: customerName,
    customer_username: customerUsername,
    customer_raw_text: rawText || null,
    updated_at: new Date().toISOString(),
  };

  const codeMatch = objectName.match(/(?:АЗК|АЗС|АГЗС)\s*[№#]?\s*([A-Za-zА-Яа-яІіЇїЄє0-9_-]+)/i);
  if (codeMatch?.[1]) insertPayload.azk_code = codeMatch[1];
  if (deadlineText) insertPayload.order_date_text = deadlineText;

  let { data: application, error } = await supabase
    .from("applications")
    .insert(insertPayload)
    .select("id,application_number,status,title,address,description,deadline_at")
    .single();

  if (error && /azk_code|order_date_text/i.test(error.message || "")) {
    delete insertPayload.azk_code;
    delete insertPayload.order_date_text;
    const retry = await supabase
      .from("applications")
      .insert(insertPayload)
      .select("id,application_number,status,title,address,description,deadline_at")
      .single();
    application = retry.data;
    error = retry.error;
  }

  if (error || !application?.id) {
    console.error("EXTERNAL APPLICATION CREATE ERROR:", error);
    return { ok: false, status: 500, error: error?.message || "Application was not created" };
  }

  // Новые заявки из RVP Order Parser только создаются в базе.
  // Диспетчеризация выполняется централизованно из Bolt Admin Dashboard.
  console.log("EXTERNAL APPLICATION CREATED:", JSON.stringify(application));

  // Push failure must never block creation of an application.
  await sendNewApplicationPush(application);

  return {
    ok: true,
    duplicate: false,
    application_id: application.id,
    application_number: application.application_number,
    status: application.status,
    telegram_posted: false,
  };
}


async function syncWorkCardStatus(application:any) {
  if(!application?.work_card_chat_id||!application?.work_card_message_id)return {ok:false,skipped:true,error:"Картку Telegram ще не прив’язано."};
  const short=(v:unknown,n=350)=>escapeHtml(String(v||"").slice(0,n));
  const state=application.awaiting_act?"⏳ Результат на перевірці":application.status==="completed"?"✅ Роботу підтверджено":application.has_problem?"⚠️ Потребує уваги":application.arrived_at?"📍 На об’єкті":application.contractor_stage==="departed"?"🚗 В дорозі":getApplicationStatusText(application.status);
  const text=`📋 <b>${short(application.application_number,80)}</b>\n🏢 ${short(application.title,180)}\n📍 ${short(application.address)}\n🔧 ${short(application.description,600)}\n\n${state}`;
  const rows=["completed","cancelled"].includes(application.status)?[]:!application.contractor_id&&application.status==="new"?[[{text:"✅ Прийняти заявку",callback_data:`externalclaim:${application.id}`}]]:[[{text:"📋 Відкрити заявку",callback_data:`contractorapp:${application.id}`}]];
  const result=await telegram("editMessageText",{chat_id:application.work_card_chat_id,message_id:application.work_card_message_id,text,parse_mode:"HTML",reply_markup:{inline_keyboard:rows}});
  return {ok:!!result?.ok||String(result?.description||"").includes("message is not modified"),error:result?.description};
}

async function registerWorkCardFromParser(payload: any) {
  const applicationId = String(payload?.application_id || "").trim();
  const chatId = Number(payload?.work_card_chat_id);
  const messageId = Number(payload?.work_card_message_id);

  if (!applicationId || !Number.isFinite(chatId) || !Number.isFinite(messageId)) {
    return { ok: false, status: 400, error: "Invalid source card payload" };
  }

  const { error } = await supabase
    .from("applications")
    .update({
      work_card_chat_id: chatId,
      work_card_message_id: messageId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId);

  if (error) {
    return { ok: false, status: 500, error: error.message };
  }

  return { ok: true, status: 200 };
}

async function updateApplicationStatusFromWeb(
  applicationId: string,
  requestedStatus: string,
) {
  const allowed = new Set(["new", "in_progress", "completed"]);

  if (!allowed.has(requestedStatus)) {
    return {
      ok: false,
      status: 400,
      error: "Unsupported status",
    };
  }

  if(requestedStatus==="completed") return {ok:false,status:400,error:"Завершення роботи виконується підтвердженням акта."};
  const current=await supabase.from("applications").select("status,updated_at,contractor_id,awaiting_act").eq("id",applicationId).maybeSingle();
  if(current.error||!current.data||["completed","cancelled"].includes(current.data.status)||current.data.awaiting_act||(requestedStatus==="new"&&current.data.contractor_id)) return {ok:false,status:409,error:"Заявка закрита, має виконавця або очікує перевірки. Оновіть список."};
  const { data: application, error } = await supabase
    .from("applications")
    .update({
      status: requestedStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .eq("updated_at",current.data.updated_at)
    .select(`
      id,
      application_number,
      title,
      address,
      description,
      deadline_at,
      order_date_text,
      status,
      work_card_chat_id,
      work_card_message_id
    `)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: error.message };
  }

  if (!application) {
    return { ok: false, status: 404, error: "Application not found" };
  }

  const telegram = await syncWorkCardStatus(application);

  return {
    ok: true,
    status: 200,
    application_status: requestedStatus,
    telegram_updated: telegram.ok === true,
    warning: telegram.ok ? null : telegram.error,
  };
}

// =====================================================
// EDGE FUNCTION
// =====================================================


const customerTelegram = makeCustomerTelegram(BOT_TOKEN);
const customerCabinet = makeCustomerCabinet({
  db: supabase, telegram: customerTelegram.call, getSession, setSession,
  refreshAdmins: refreshDynamicAdmins,
  adminIds: () => [...new Set([...ADMIN_IDS, ...dynamicAdminIds])],
  isAdmin, rateLimit: rateLimitAllowed, clearSession, adminMenu,
});

const serviceWorkflow = makeServiceWorkflow({ db:supabase,send:telegram,getSession,setSession,
  resetSession:resetContractorSession,isAdmin,mainMenu,finalizeAct:finalizeMultiAct,
  clearSession,onTransition:async(id:string)=>{const r=await supabase.from("applications").select("*").eq("id",id).maybeSingle();if(r.data)await syncWorkCardStatus(r.data);},rejectAct:(chat:number,id:string,reason:string)=>rejectAct(chat,id,reason) });

Deno.serve(
  async (
    req: Request,
  ) => {
    try {
      // CORS preflight for requests from Bolt / published admin panel.
      if (
        req.method ===
        "OPTIONS"
      ) {
        return new Response(
          "ok",
          {
            status: 200,
            headers:
              corsHeaders,
          },
        );
      }

      if (
        req.method ===
        "GET"
      ) {
        return new Response(
          "RVP Telegram Bot is running",
          {
            status: 200,
            headers:
              corsHeaders,
          },
        );
      }

      if (
        req.method !==
        "POST"
      ) {
        return new Response(
          "Method Not Allowed",
          {
            status: 405,
            headers:
              corsHeaders,
          },
        );
      }

      const update =
        await req.json();

      let workflowWebActor: string | null = null;
      if (["notify_application","approve_act_from_web","reject_act_from_web","update_application_status_from_web"].includes(update?.action)) {
        workflowWebActor=await authorizeServiceOffice(supabase,req.headers.get("Authorization")||"");
        if(!workflowWebActor) return new Response(JSON.stringify({ok:false,error:"Недостатньо прав для цієї дії."}),{status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      // =================================================
      // RVP ORDER PARSER -> CREATE APPLICATION
      // =================================================
      if (update?.action === "create_external_application") {
        const suppliedSecret = req.headers.get("x-order-parser-secret") || "";

        if (!ORDER_PARSER_SECRET || suppliedSecret !== ORDER_PARSER_SECRET) {
          return new Response(
            JSON.stringify({ ok: false, error: "Unauthorized" }),
            {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        const result = await createExternalApplication(update);

        return new Response(
          JSON.stringify(result),
          {
            status: result.ok ? 200 : (result.status || 400),
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // =================================================
      // RVP ORDER PARSER -> SAVE WORK CARD MESSAGE ID
      // =================================================
      if (update?.action === "register_work_card") {
        const suppliedSecret =
          req.headers.get("x-order-parser-secret") || "";

        if (
          !ORDER_PARSER_SECRET ||
          suppliedSecret !== ORDER_PARSER_SECRET
        ) {
          return new Response(
            JSON.stringify({ ok: false, error: "Unauthorized" }),
            {
              status: 401,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }

        const result = await registerWorkCardFromParser(update);

        return new Response(
          JSON.stringify(result),
          {
            status: result.ok ? 200 : (result.status || 400),
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          },
        );
      }

      // =================================================
      // WEB ADMIN -> UPDATE APPLICATION STATUS + TELEGRAM
      // =================================================
      if (update?.action === "update_application_status_from_web") {
        const authHeader = req.headers.get("Authorization") || "";
        const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (!jwt) {
          return new Response(
            JSON.stringify({ ok: false, error: "Unauthorized" }),
            {
              status: 401,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }

        const { data: userData, error: userError } =
          await supabase.auth.getUser(jwt);

        if (userError || !userData?.user?.id) {
          return new Response(
            JSON.stringify({ ok: false, error: "Unauthorized" }),
            {
              status: 401,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }

        // Any ACTIVE RVP Control admin may change an application status.
        // Do not hard-code only owner/admin here: the dashboard can use
        // additional active roles (manager/dispatcher/etc.).
        const { data: admin, error: adminError } = await supabase
          .from("admin_users")
          .select("user_id,role,is_active")
          .eq("user_id", userData.user.id)
          .eq("is_active", true)
          .maybeSingle();

        if (adminError || !admin) {
          console.error("STATUS WEB ADMIN CHECK FAILED:", adminError);
          return new Response(
            JSON.stringify({ ok: false, error: "Forbidden: active admin not found" }),
            {
              status: 403,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }

        const applicationId = String(
          update?.application_id || "",
        ).trim();

        const status = String(
          update?.status || "",
        ).trim();

        if (!applicationId) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "application_id is required",
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }

        const result = await updateApplicationStatusFromWeb(
          applicationId,
          status,
        );

        return new Response(
          JSON.stringify(result),
          {
            status: result.ok ? 200 : (result.status || 400),
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          },
        );
      }

      // =================================================
      // WEB ADMIN -> TELEGRAM
      // =================================================

      if (
        update?.action ===
        "delete_applications_bulk_from_web"
      ) {
        const authorization = req.headers.get("Authorization") || "";
        const jwt = authorization.replace(/^Bearer\s+/i, "").trim();

        if (!jwt) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
        const user = userData?.user;

        if (userError || !user?.id) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: adminUser, error: adminError } = await supabase
          .from("admin_users")
          .select("user_id,role,is_active")
          .eq("user_id", user.id)
          .maybeSingle();

        if (
          adminError ||
          !adminUser?.is_active ||
          !["owner", "admin"].includes(adminUser.role)
        ) {
          return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const ids = Array.isArray(update?.application_ids)
          ? [...new Set<string>(
              update.application_ids
                .map((id: unknown) => String(id || "").trim())
                .filter(Boolean),
            )]
          : [];

        if (ids.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "application_ids is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        if (ids.length > 200) {
          return new Response(
            JSON.stringify({ ok: false, error: "Maximum 200 applications per request" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        let deleted = 0;
        const failedIds: string[] = [];

        // Delete in small parallel batches: UI reacts instantly, while Telegram
        // and DB cleanup finish quickly without flooding Telegram Bot API.
        for (let offset = 0; offset < ids.length; offset += 5) {
          const batch = ids.slice(offset, offset + 5);

          const results = await Promise.allSettled(
            batch.map((applicationId) =>
              deleteApplicationFromWeb(applicationId)
            ),
          );

          results.forEach((result, index) => {
            const id = batch[index];

            if (
              result.status === "fulfilled" &&
              result.value?.ok
            ) {
              deleted += 1;
            } else {
              failedIds.push(id);
              console.error(
                "BULK DELETE APPLICATION ERROR:",
                id,
                result.status === "rejected"
                  ? result.reason
                  : result.value?.error,
              );
            }
          });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            total: ids.length,
            deleted,
            failed: failedIds.length,
            failed_ids: failedIds,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (
        update?.action ===
        "delete_application_from_web"
      ) {
        const authorization = req.headers.get("Authorization") || "";
        const jwt = authorization.replace(/^Bearer\s+/i, "").trim();

        if (!jwt) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
        const user = userData?.user;

        if (userError || !user?.id) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: adminUser, error: adminError } = await supabase
          .from("admin_users")
          .select("user_id,role,is_active")
          .eq("user_id", user.id)
          .maybeSingle();

        if (adminError || !adminUser?.is_active || !["owner", "admin"].includes(adminUser.role)) {
          return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const applicationId = String(update?.application_id || "").trim();
        if (!applicationId) {
          return new Response(JSON.stringify({ ok: false, error: "application_id is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const result = await deleteApplicationFromWeb(applicationId);

        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (
        update?.action ===
        "notify_application"
      ) {
        const applicationId =
          String(
            update?.application_id ||
              "",
          ).trim();

        if (
          !applicationId
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              error:
                "application_id is required",
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type":
                  "application/json",
              },
            },
          );
        }

        const result =
          await notifyApplicationFromWeb(
            applicationId,
          );

        return new Response(
          JSON.stringify(
            result,
          ),
          {
            status:
              result.ok
                ? 200
                : 400,
            headers: {
              ...corsHeaders,
              "Content-Type":
                "application/json",
            },
          },
        );
      }

      // =================================================
      // WEB ADMIN -> APPROVE / REJECT ACT
      // =================================================
      if (
        update?.action ===
          "approve_act_from_web" ||
        update?.action ===
          "reject_act_from_web"
      ) {
        const actId =
          String(
            update?.act_id ||
              "",
          ).trim();

        if (
          !actId
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              error:
                "act_id is required",
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type":
                  "application/json",
              },
            },
          );
        }

        const adminChatId =
          ADMIN_IDS[0];

        if (
          !adminChatId
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              error:
                "ADMIN_IDS is empty",
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type":
                  "application/json",
              },
            },
          );
        }

        try {
          if (
            update.action ===
              "approve_act_from_web"
          ) {
            await confirmAct(
              adminChatId,
              actId,
              workflowWebActor || undefined,
            );
          } else {
            await rejectAct(adminChatId,actId,String(update.reason || ""),workflowWebActor || undefined);
          }

          const {
            data: updatedAct,
            error: statusError,
          } = await supabase
            .from("acts")
            .select(
              "id,status,reviewed_at,application_id,group_chat_id,group_message_id",
            )
            .eq(
              "id",
              actId,
            )
            .maybeSingle();

          if (
            statusError
          ) {
            return new Response(
              JSON.stringify({
                ok: false,
                error:
                  statusError.message,
              }),
              {
                status: 500,
                headers: {
                  ...corsHeaders,
                  "Content-Type":
                    "application/json",
                },
              },
            );
          }

          const expectedStatus =
            update.action ===
              "approve_act_from_web"
              ? "approved"
              : "rejected";

          if (
            !updatedAct ||
            updatedAct.status !==
              expectedStatus
          ) {
            return new Response(
              JSON.stringify({
                ok: false,
                error:
                  `Act was not changed to ${expectedStatus}`,
                act:
                  updatedAct ||
                  null,
              }),
              {
                status: 400,
                headers: {
                  ...corsHeaders,
                  "Content-Type":
                    "application/json",
                },
              },
            );
          }

          return new Response(
            JSON.stringify({
              ok: true,
              act:
                updatedAct,
            }),
            {
              status: 200,
              headers: {
                ...corsHeaders,
                "Content-Type":
                  "application/json",
              },
            },
          );
        } catch (error) {
          console.error(
            "WEB ACT ACTION ERROR:",
            error,
          );

          return new Response(
            JSON.stringify({
              ok: false,
              error:
                error instanceof Error ? error.message : String(error),
            }),
            {
              status: (error as any)?.status || 500,
              headers: {
                ...corsHeaders,
                "Content-Type":
                  "application/json",
              },
            },
          );
        }
      }

      // =================================================
      // CRON
      // =================================================
      if (
        update?.action ===
          "check_deadlines" &&
        CRON_SECRET &&
        req.headers.get(
          "x-cron-secret",
        ) === CRON_SECRET
      ) {
        await checkDeadlineNotifications();

        return new Response(
          JSON.stringify({
            ok: true,
            checked: true,
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type":
                "application/json",
            },
          },
        );
      }

      if ((update?.message || update?.callback_query) && !(await customerTelegram.verifies(req))) {
        return new Response("Unauthorized Telegram update", { status: 401, headers: corsHeaders });
      }

      // Open a Mini App only after the existing signed-webhook check above.
      if (update?.message?.chat?.type === "private" &&
          ["/web", "🌐 Відкрити вебкабінет"].includes(String(update.message.text || "").trim())) {
        await refreshDynamicAdmins();
        if (await rateLimitAllowed(update.message.from?.id)) {
          await handleWebPortal(update, supabase, telegram, isAdmin(update.message.from?.id));
        }
        return new Response(JSON.stringify({ok:true}), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      if (await customerCabinet.handle(update, true)) {
        return new Response(JSON.stringify({ok:true}),{
          status:200, headers:{...corsHeaders,"Content-Type":"application/json"},
        });
      }

      // Additional deadline check on normal Telegram activity.
      await checkDeadlineNotifications();

      console.log(
        "================================",
      );

      console.log(
        "TELEGRAM UPDATE",
      );

      console.log(
        JSON.stringify(
          update,
          null,
          2,
        ),
      );

      console.log(
        "================================",
      );

      if (
        update.callback_query
      ) {
        await handleCallback(
          update.callback_query,
        );
      }

      if (
        update.message
      ) {
        await handleMessage(
          update.message,
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );
    } catch (error) {
      console.error(
        "FUNCTION ERROR:",
        error,
      );

      return new Response(
        JSON.stringify({
          ok: false,
          error:
            String(error),
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        },
      );
    }
  },
);
