import { officeFinance } from './finance.ts';
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { PortalError, verifyTelegram, monthRange, uuid } from "./auth.ts";
import { notifyPublished, notifyContact } from "./notifications.ts";
import { ukraineCities } from "./ukraine_cities.ts";
import { officeSiteHistory, resolveOfficeSite } from "./site_history.ts";
import { officeVolumeReport } from "./volume_report.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY =
  Deno.env.get("SB_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT = Deno.env.get("BOT_TOKEN")!;
const db = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const origins = new Set(["https://gidraservicedp-alt.github.io"]);
const sitesFields =
  "id,label,address,capacity_m3,passport_network,passport_city_code,passport_azk_code";
const appFields =
  "id,application_number,title,description,address,scheduled_at,deadline_at,status,contractor_stage,actual_volume,updated_at,customer_site_id,arrived_at,awaiting_act,has_problem,problem_comment";
const cities = new Map(ukraineCities.map((c) => [c[0], `${c[1]} · ${c[2]}`]));
function result<T>(r: { data: T; error: unknown }): T {
  if (r.error) {
    const code=(r.error as any)?.code;
    if(code==="40001") throw new PortalError(409,"Заявка змінилася або дія зараз недоступна. Оновіть список.");
    if(code==="42501") throw new PortalError(403,"Недостатньо прав для цієї дії.");
    if(code==="22023") throw new PortalError(400,"Перевірте етап роботи, дату, обсяг та причину.");
    console.error("Portal database request failed");
    throw new PortalError(500, "Не вдалося отримати дані. Спробуйте ще раз.");
  }
  return r.data;
}
function list<T>(r: { data: T[] | null; error: unknown }): T[] {
  return result(r) || [];
}
function site(row: any) {
  return {
    ...row,
    region: cities.get(row.passport_city_code) || "",
    code:
      row.passport_azk_code ||
      row.label.match(/(?:^|\s)(\d+)$/)?.[1] ||
      "Без коду",
  };
}
async function customer(id: number) {
  const p = result(
    await db
      .from("customers")
      .select("first_name,last_name,status,phone")
      .eq("telegram_id", id)
      .maybeSingle(),
  );
  if (!p || p.status !== "active" || !p.phone)
    throw new PortalError(
      403,
      "Контакт замовника ще не підтверджено. Зверніться до офісу в боті.",
    );
  return p;
}
async function contractor(id: number) {
  const p = result(
    await db
      .from("contractors")
      .select("id,first_name,last_name,status,phone")
      .eq("telegram_id", id)
      .maybeSingle(),
  );
  if (!p || p.status !== "active" || !p.phone)
    throw new PortalError(403, "Доступ підрядника ще не підтверджено.");
  return p;
}
async function office(req: Request, write = false) {
  const jwt = (req.headers.get("Authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!jwt) throw new PortalError(401, "Увійдіть в адмін-панель.");
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user)
    throw new PortalError(401, "Увійдіть в адмін-панель.");
  const admin = result(
    await db
      .from("admin_users")
      .select("user_id,role")
      .eq("user_id", data.user.id)
      .eq("is_active", true)
      .maybeSingle(),
  );
  const allowed = write
    ? ["owner", "admin", "dispatcher"]
    : ["owner", "admin", "dispatcher", "accountant", "viewer"];
  if (!admin || !allowed.includes(admin.role))
    throw new PortalError(403, "Недостатньо прав.");
  return admin;
}
async function visibleSite(user: number, id: string) {
  const s = result(
    await db
      .from("rpv_customer_visible_sites")
      .select(sitesFields)
      .eq("telegram_id", user)
      .eq("id", id)
      .maybeSingle(),
  );
  if (!s) throw new PortalError(404, "Об’єкт недоступний.");
  return s;
}
async function dispatch(req: Request, b: any): Promise<any> {
  if (['office.finance','office.finance_history','office.finance_set','office.finance_confirm'].includes(b.action)) {
    const admin=await office(req,false);
    return await officeFinance(db,b,admin);
  }
  if (String(b.action || "").startsWith("office.")) {
    const admin = await office(
      req,
      !["office.list", "office.site", "office.site_history", "office.sites", "office.networks", "office.applications", "office.volume"].includes(
        b.action,
      ),
    );
    if (b.action === "office.volume") return await officeVolumeReport(db, b);
    if (b.action === "office.site_history") {
      const history = await officeSiteHistory(db, uuid(b.site), page(b.page));
      return { ...history, site: site(history.site) };
    }
    if (b.action === "office.assign") {
      const changed=result(await db.rpc("rpv_service_assign",{p_actor:admin.user_id,p_application:uuid(b.application),p_contractor:uuid(b.contractor),p_version:String(b.version)}));
      const notice=await fetch(`${URL}/functions/v1/smart-api`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:req.headers.get("Authorization")||""},body:JSON.stringify({action:"notify_application",application_id:b.application})}).then(r=>r.json()).catch(()=>({ok:false}));
      return {ok:changed,notificationSent:!!notice.ok};
    }
    if (b.action === "office.list") {
      const status = ["pending", "active", "rejected"].includes(b.status)
        ? b.status
        : "pending";
      const rows = list(
        await db
          .from("customers")
          .select(
            "telegram_id,first_name,last_name,username,phone,status,updated_at",
          )
          .eq("status", status)
          .not("phone", "is", null)
          .order("updated_at", { ascending: false })
          .range(page(b.page) * 50, page(b.page) * 50 + 50),
      );
      return {
        customers: rows.slice(0, 50),
        more: rows.length > 50,
        canManage: ["owner", "admin", "dispatcher"].includes(admin.role),
      };
    }
    if (b.action === "office.site") {
      const row = await resolveOfficeSite(db, uuid(b.site));
      return { site: site(row) };
    }
    if (b.action === "office.sites" || b.action === "office.networks") {
      const table = b.user === undefined ? "rpv_customer_sites" : "rpv_customer_visible_sites";
      const user = b.user === undefined ? undefined : Number(b.user);
      if (user !== undefined && (!Number.isSafeInteger(user) || user <= 0))
        throw new PortalError(400, "Некоректний менеджер АЗК.");
      if (b.action === "office.networks") {
        const networks = new Set<string>();
        let query = db.from(table).select("passport_network")
          .not("passport_network", "is", null).order("passport_network").order("id");
        if (table === "rpv_customer_sites") query = query.is("merged_into", null);
        if (user !== undefined) query = query.eq("telegram_id", user);
        for (let offset = 0; ; offset += 1000) {
          const rows = list(await query.range(offset, offset + 999));
          for (const row of rows) {
            const name = String(row.passport_network || "").trim().toUpperCase();
            if (name) networks.add(name);
          }
          if (rows.length < 1000) break;
        }
        return { networks: [...networks].sort((a, b) => a.localeCompare(b, "uk")) };
      }
      let query = db.from(table).select(sitesFields);
      if (table === "rpv_customer_sites") query = query.is("merged_into", null);
      if (user !== undefined) query = query.eq("telegram_id", user);
      const q = String(b.query || "").trim();
      const network = String(b.network || "").trim();
      if (network && !/^[A-Za-z0-9]{1,30}$/.test(network))
        throw new PortalError(400, "Оберіть мережу зі списку.");
      if (q && !/^[A-Za-z0-9]{1,30}$/.test(q))
        throw new PortalError(400, "Введіть мережу латиницею або код АЗК.");
      if (!q && !network && b.user === undefined) return { sites: [], more: false };
      if (network) query = query.ilike("passport_network", network);
      if (q) query = query.ilike(/^\d+$/.test(q) ? "passport_azk_code" : "passport_network", `%${q}%`);
      const rows = list(
        await query.order("passport_azk_code").order("id")
          .range(page(b.page) * 50, page(b.page) * 50 + 50),
      );
      return { sites: rows.slice(0, 50).map(site), more: rows.length > 50 };
    }
    if (b.action === "office.decide") {
      const user = Number(b.user);
      if (
        !Number.isSafeInteger(user) ||
        user <= 0 ||
        !["approve", "reject", "reset"].includes(b.decision) ||
        typeof b.version !== "string"
      )
        throw new PortalError(400, "Некоректна дія.");
      if (b.decision === "reset") {
        const changed = result(
          await db.rpc("rpv_customer_reset_registration", {
            p_user: user,
            p_version: b.version,
          }),
        );
        if (!changed)
          throw new PortalError(409, "Картка змінилася. Оновіть список.");
      } else {
        const changed = list(
          await db
            .from("customers")
            .update({
              status: b.decision === "approve" ? "active" : "rejected",
              updated_at: new Date().toISOString(),
            })
            .eq("telegram_id", user)
            .eq("status", "pending")
            .eq("updated_at", b.version)
            .not("phone", "is", null)
            .select("telegram_id"),
        );
        if (!changed.length)
          throw new PortalError(409, "Картка змінилася. Оновіть список.");
      }
      const notificationSent =
        b.decision === "reset"
          ? true
          : await notifyContact(BOT, user, b.decision === "approve");
      return { ok: true, notificationSent };
    }
    if (b.action === "office.applications") {
      const rows = list(
        await db
          .from("applications")
          .select(appFields)
          .order("created_at", { ascending: false })
          .range(page(b.page) * 50, page(b.page) * 50 + 50),
      );
      return { applications: rows.slice(0, 50), more: rows.length > 50 };
    }
    if (b.action === "office.link") {
      const app = uuid(b.application),
        s = uuid(b.site);
      const changed = result(
        await db.rpc("rpv_portal_link_application", {
          p_application: app,
          p_site: s,
          p_actor: admin.user_id,
          p_version: String(b.version),
        }),
      );
      if (!changed)
        throw new PortalError(
          409,
          "Заявка змінилася або прив’язана до іншого об’єкта.",
        );
      return { ok: true };
    }
    if (b.action === "office.publish") {
      const act = String(b.act || ""),
        s = uuid(b.site);
      const volume = b.volume === null ? null : Number(b.volume);
      const day = String(b.date || "");
      if (
        !/^[\w-]{1,70}$/.test(act) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        (volume !== null &&
          (!Number.isFinite(volume) || volume <= 0 || volume >= 1000000))
      )
        throw new PortalError(400, "Перевірте номер акта, дату та обсяг.");
      const row = result(
        await db
          .from("rpv_customer_sites")
          .select("site_key")
          .eq("id", s)
          .maybeSingle(),
      );
      if (!row) throw new PortalError(404, "Об’єкт не знайдено.");
      const published = result(
        await db.rpc("rpv_customer_publish", {
          p_act: act,
          p_site: row.site_key,
          p_date: day,
          p_volume: volume,
        }),
      );
      if (!published.length)
        throw new PortalError(
          409,
          "Акт має бути підтверджено. Перевірте адресу заявки та попередню публікацію.",
        );
      let notifications = null;
      if (
        published[0].pumped_m3 !== null &&
        published[0].work_date.slice(0, 7) === monthRange(undefined).month
      ) {
        try {
          notifications = await notifyPublished(db, BOT, published[0]);
        } catch {
          notifications = { sent: 0, failed: 1 };
        }
      }
      return { ok: true, notifications };
    }
    throw new PortalError(400, "Невідома дія.");
  }
  const user = await verifyTelegram(b.initData, BOT);
  if (b.action === "identity") {
    const [c, k] = await Promise.all([
      db
        .from("customers")
        .select("first_name,status,phone")
        .eq("telegram_id", user)
        .maybeSingle(),
      db
        .from("contractors")
        .select("first_name,status,phone")
        .eq("telegram_id", user)
        .maybeSingle(),
    ]);
    const cRow = result(c),
      kRow = result(k);
    return {
      roles: [
        ...(cRow?.status === "active" && cRow.phone ? ["customer"] : []),
        ...(kRow?.status === "active" && kRow.phone ? ["contractor"] : []),
      ],
      name: cRow?.first_name || kRow?.first_name || "",
    };
  }
  if (b.action === "customer.create") {
    await customer(user);
    const work = typeof b.work === "string" ? b.work.trim() : "";
    const date = typeof b.date === "string" ? b.date : "";
    if (!work || work.length > 2000 || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new PortalError(400, "Вкажіть роботи та бажану дату.");
    const { data, error } = await db.rpc("rpv_customer_create_application", {
      p_user: user,
      p_site: uuid(b.site),
      p_request: uuid(b.request),
      p_work: work,
      p_date: date,
    });
    if (error) {
      if (error.code === "42501")
        throw new PortalError(
          403,
          "Доступ до цієї АЗК відсутній. Оновіть кабінет.",
        );
      if (error.code === "22023")
        throw new PortalError(
          400,
          "Перевірте роботи та дату: від сьогодні до року вперед.",
        );
      if (error.code === "23505")
        throw new PortalError(
          409,
          "Цю спробу вже використано з іншими даними. Відкрийте нову форму.",
        );
      if (error.code === "54000")
        throw new PortalError(429, "Забагато нових заявок. Зачекайте хвилину.");
      throw new PortalError(
        500,
        "Не вдалося підтвердити створення. Повторіть надсилання — дубль не буде створено.",
      );
    }
    if (!data?.[0])
      throw new PortalError(500, "Не вдалося підтвердити створення заявки.");
    return data[0];
  }
  if (b.action === "customer.dashboard") {
    const profile = await customer(user);
    const range = monthRange(b.month);
    const rows = list(
      await db
        .from("rpv_customer_visible_sites")
        .select(sitesFields)
        .eq("telegram_id", user)
        .order("id")
        .range(page(b.sitePage) * 100, page(b.sitePage) * 100 + 100),
    );
    if (b.site) await visibleSite(user, uuid(b.site));
    let query = db
      .from("rpv_customer_visible_acts")
      .select(
        "act_id,site_id,site_label,work_date,pumped_m3,act_number,application_number",
      )
      .eq("telegram_id", user)
      .gte("work_date", range.start)
      .lt("work_date", range.end)
      .lte("work_date", range.today);
    if (b.site) query = query.eq("site_id", b.site);
    const acts = list(
      await query
        .order("work_date", { ascending: false })
        .order("act_id")
        .range(page(b.page) * 50, page(b.page) * 50 + 50),
    );
    const total = result(
      await db.rpc("rpv_customer_total", {
        p_user: user,
        p_month: range.start,
      }),
    );
    const months = result(
      await db.rpc("rpv_customer_months", {
        p_user: user,
        p_before: range.today.slice(0, 7) + "-01",
        p_offset: page(b.archivePage) * 8,
      }),
    );
    return {
      name: profile.first_name,
      sites: rows.slice(0, 100).map(site),
      sitesMore: rows.length > 100,
      acts: acts.slice(0, 50),
      more: acts.length > 50,
      total,
      month: range.month,
      months: months.slice(0, 8),
      monthsMore: months.length > 8,
    };
  }
  if (b.action === "customer.calendar") {
    await customer(user);
    const month = typeof b.month === "string" ? b.month : "";
    const query = typeof b.query === "string" ? b.query.trim() : "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || query.length > 40)
      throw new PortalError(400, "Перевірте місяць та пошук АЗК.");
    const { data, error } = await db.rpc("rpv_customer_calendar", {
      p_user: user, p_month: month + "-01", p_site: b.site ? uuid(b.site) : null,
      p_query: query, p_offset: page(b.page) * 200,
    });
    if (error?.code === "42501") throw new PortalError(403, "Доступ до АЗК відкликано. Оновіть кабінет.");
    if (error?.code === "22023") throw new PortalError(400, "Оберіть місяць від 2020 року до двох років уперед.");
    return result({ data, error });
  }
  if (b.action === "customer.applications") {
    await customer(user);
    const s = uuid(b.site);
    await visibleSite(user, s);
    const rows = list(
      await db
        .from("applications")
        .select(appFields)
        .eq("customer_site_id", s)
        .order("created_at", { ascending: false })
        .range(page(b.page) * 50, page(b.page) * 50 + 50),
    );
    return { applications: rows.slice(0, 50), more: rows.length > 50 };
  }
  if (b.action === "customer.file") {
    await customer(user);
    const act = uuid(b.act);
    const visible = result(
      await db
        .from("rpv_customer_visible_acts")
        .select("act_id")
        .eq("telegram_id", user)
        .eq("act_id", act)
        .maybeSingle(),
    );
    if (!visible) throw new PortalError(404, "Акт недоступний.");
    const doc = result(
      await db
        .from("acts")
        .select("telegram_file_id,file_name")
        .eq("id", act)
        .eq("status", "approved")
        .maybeSingle(),
    );
    if (!doc) throw new PortalError(404, "Файл недоступний.");
    const stored = result(await db.from('act_files')
      .select('storage_path,file_name').eq('act_id',act).not('storage_path','is',null)
      .order('created_at',{ascending:true}).limit(1).maybeSingle());
    if (stored?.storage_path) {
      const {data:blob,error} = await db.storage.from('application-media').download(stored.storage_path);
      if(error || !blob) throw new PortalError(502,"Не вдалося завантажити акт.");
      return new Response(blob,{headers:{
        'Content-Type':blob.type || 'application/octet-stream',
        'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(stored.file_name || 'act')}`,
        'Access-Control-Expose-Headers':'Content-Disposition',
        'X-Content-Type-Options':'nosniff',
      }});
    }
    if (!doc.telegram_file_id) throw new PortalError(404, "Файл недоступний.");
    // Proxy bytes, never expose the bot token or Telegram file URL to the browser.
    const reply = await fetch(`https://api.telegram.org/bot${BOT}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: doc.telegram_file_id }),
    });
    const file = await reply.json();
    if (
      !file.ok ||
      !file.result?.file_path ||
      file.result.file_size > 20 * 1024 * 1024
    )
      throw new PortalError(502, "Файл недоступний. Відкрийте акт у боті.");
    const downloaded = await fetch(
      `https://api.telegram.org/file/bot${BOT}/${file.result.file_path}`,
    );
    if (!downloaded.ok)
      throw new PortalError(502, "Не вдалося завантажити акт.");
    return new Response(downloaded.body, {
      headers: {
        "Content-Type":
          downloaded.headers.get("Content-Type") || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.file_name || "act")}`,
        "Access-Control-Expose-Headers": "Content-Disposition",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (b.action === "contractor.dashboard") {
    const p = await contractor(user);
    let query=db.from("applications").select(appFields+",payout_amount,payout_status,paid_at,customer_telegram_id").eq("contractor_id",p.id);
    if(b.view==="history" || b.view==="payments") query=query.eq("status","completed");
    else query=query.not("status","in","(completed,cancelled)");
    const apps=list(await query.order("created_at",{ascending:false}).range(page(b.page)*50,page(b.page)*50+50));
    const ids=[...new Set(apps.map((a:any)=>a.customer_telegram_id).filter(Boolean))];
    const contacts=ids.length?list(await db.from("customers").select("telegram_id,first_name,last_name,phone,username").in("telegram_id",ids).eq("status","active")):[];
    const reports=apps.length?list(await db.from("rpv_service_reports").select("application_id,state,review_reason").in("application_id",apps.map((a:any)=>a.id))):[];
    const mapped=apps.slice(0,50).map((a:any)=>{const contact=contacts.find((c:any)=>c.telegram_id===a.customer_telegram_id);const report=reports.find((r:any)=>r.application_id===a.id);return {...a,report_state:report?.state,review_reason:report?.review_reason,customer_contact:contact?.phone?{name:[contact.first_name,contact.last_name].filter(Boolean).join(" "),phone:contact.phone,username:contact.username}:null};});
    return {
      name: p.first_name,
      applications: mapped,
      more: apps.length > 50,
    };
  }
  if (b.action === "contractor.report") {
    await contractor(user);
    if(typeof b.date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || (b.volume!==null && (typeof b.volume!=="number" || !Number.isFinite(b.volume) || b.volume<=0 || b.volume>=1000000)) || typeof b.notes!=="string" || b.notes.length>2000)
      throw new PortalError(400,"Перевірте фактичний обсяг, дату і примітку.");
    return result(await db.rpc("rpv_service_report",{p_user:user,p_application:uuid(b.application),p_version:String(b.version),p_date:b.date,p_volume:b.volume,p_notes:b.notes}));
  }
  if (b.action === "contractor.transition") {
    await contractor(user);
    if (!["accept", "depart", "arrive", "decline", "problem"].includes(b.transition))
      throw new PortalError(400, "Некоректна дія.");
    const changed = result(
      await db.rpc("rpv_service_transition", {
        p_user: user,
        p_application: uuid(b.application),
        p_action: b.transition,
        p_note: typeof b.note === "string" ? b.note.slice(0,2000) : "",
        p_version: String(b.version),
      }),
    );
    if (!changed)
      throw new PortalError(409, "Заявка змінилася. Оновіть список.");
    return { ok: true };
  }
  throw new PortalError(400, "Невідома дія.");
}
function page(v: unknown) {
  const p = Number(v || 0);
  if (!Number.isInteger(p) || p < 0 || p > 10000)
    throw new PortalError(400, "Некоректна сторінка.");
  return p;
}
async function uploadResult(req:Request) {
  const max=5*1024*1024+16000;
  if(Number(req.headers.get("content-length"))>max) throw new PortalError(413,"Файл має бути до 5 МБ.");
  const reader=req.body?.getReader();if(!reader) throw new PortalError(400,"Файл відсутній.");
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const item=await reader.read();if(item.done)break;length+=item.value.length;if(length>max){await reader.cancel();throw new PortalError(413,"Файл має бути до 5 МБ.");}chunks.push(item.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const form=await new Response(bytes,{headers:{"Content-Type":req.headers.get("content-type")||""}}).formData();
  const user=await verifyTelegram(form.get("initData"),BOT),c=await contractor(user);
  const id=uuid(form.get("application")),key=uuid(form.get("request"));
  const a=result(await db.from("applications").select("id,status,contractor_id,arrived_at,application_number").eq("id",id).eq("contractor_id",c.id).maybeSingle());
  if(!a) throw new PortalError(404,"Заявка недоступна.");
  const previous=result(await db.from("acts").select("id").eq("id",key).eq("application_id",id).eq("contractor_id",c.id).maybeSingle());
  if(previous) return {ok:true,act_id:previous.id};
  if(!a.arrived_at || ["completed","cancelled"].includes(a.status)) throw new PortalError(409,"Заявка змінилася. Оновіть кабінет.");
  const report=result(await db.from("rpv_service_reports").select("state").eq("application_id",id).eq("contractor_id",c.id).maybeSingle());
  if(!report || !["draft","submitted"].includes(report.state)) throw new PortalError(400,"Спочатку збережіть обсяг і дату виконання.");
  const file=form.get("file");
  if(!(file instanceof File) || file.size===0 || file.size>5*1024*1024) throw new PortalError(400,"Оберіть фото або PDF до 5 МБ.");
  const sig=new Uint8Array(await file.slice(0,8).arrayBuffer());
  const pdf=sig[0]===37&&sig[1]===80&&sig[2]===68&&sig[3]===70&&sig[4]===45;
  const jpg=sig[0]===255&&sig[1]===216&&sig[2]===255;
  const png=[137,80,78,71,13,10,26,10].every((n,i)=>sig[i]===n);
  if(!pdf&&!jpg&&!png) throw new PortalError(400,"Дозволені лише PDF, JPG та PNG.");
  const name=`act-${String(a.application_number||"result").replace(/[^A-Za-z0-9_-]/g,"").slice(0,40)}.${pdf?"pdf":png?"png":"jpg"}`;
  const payload=new FormData();payload.set("chat_id",String(user));payload.set("document",file,name);payload.set("caption",`Копія акта за заявкою ${a.application_number}. Результат передається офісу на перевірку.`);
  const sent=await fetch(`https://api.telegram.org/bot${BOT}/sendDocument`,{method:"POST",body:payload}).then(r=>r.json());
  if(!sent.ok || !sent.result?.document?.file_id) throw new PortalError(502,"Не вдалося зберегти файл у Telegram. Повторіть надсилання.");
  return result(await db.rpc("rpv_service_attach",{p_user:user,p_application:id,p_key:key,p_file:sent.result.document.file_id,p_type:"document",p_name:name}));
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    Vary: "Origin",
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers":
      "authorization,content-type,apikey,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
  if (origin && origins.has(origin))
    headers["Access-Control-Allow-Origin"] = origin;
  if (origin && !origins.has(origin))
    return new Response(JSON.stringify({ error: "Недозволений сайт." }), {
      status: 403,
      headers,
    });
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  try {
    if((req.headers.get("content-type")||"").startsWith("multipart/form-data")) {
      return new Response(JSON.stringify(await uploadResult(req)),{headers});
    }
    if (Number(req.headers.get("content-length")) > 16000)
      throw new PortalError(413, "Запит завеликий.");
    const text = await req.text();
    if (text.length > 16000) throw new PortalError(413, "Запит завеликий.");
    let b;
    try {
      b = JSON.parse(text);
    } catch {
      throw new PortalError(400, "Некоректний запит.");
    }
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new PortalError(400, "Некоректний запит.");
    const response = await dispatch(req, b);
    if (response instanceof Response) {
      for (const [k, v] of Object.entries(headers))
        if (k !== "Content-Type") response.headers.set(k, v);
      return response;
    }
    return new Response(JSON.stringify(response), { headers });
  } catch (e) {
    const known = e instanceof PortalError;
    if (!known) console.error("Portal request failed");
    return new Response(
      JSON.stringify({ error: known ? e.message : "Не вдалося виконати дію." }),
      { status: known ? e.status : 500, headers },
    );
  }
});
