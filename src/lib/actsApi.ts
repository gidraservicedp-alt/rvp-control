import { supabase } from '@/lib/supabase';

export type ActStatus = 'approved' | 'pending' | 'rejected';

export interface ActFile {
  id: string;
  actId: string;
  telegramFileId: string | null;
  fileType: string;
  fileName: string | null;
  createdAt: string;
  url: string;
}

export function telegramFileUrl(telegramFileId: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  return `${base}/functions/v1/telegram-file?file_id=${encodeURIComponent(telegramFileId)}`;
}

export interface ActItem {
  actualVolume?: number | null;
  serviceReport?: {work_date:string;volume:number|null;notes:string;state:string};
  id: string;
  actNumber: string | null;
  actDate: string | null;
  status: ActStatus;
  createdAt: string;
  reviewedAt: string | null;
  contractorId: string | null;
  contractorName: string;
  contractorPhone: string | null;
  applicationId: string | null;
  applicationNumber: string;
  applicationTitle: string;
  applicationAddress: string | null;
  applicationDescription: string | null;
  applicationAzkCode: string | null;
  files: ActFile[];
}

interface ActRow {
  id: string;
  contractor_id: string | null;
  application_id: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  act_number: string | null;
  act_date: string | null;
  service_report: ActItem["serviceReport"];
}

interface ContractorRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

interface ApplicationRow {
  actual_volume: number | null;
  id: string;
  application_number: string | null;
  title: string;
  address: string | null;
  description: string | null;
  azk_code: string | null;
}

interface ActFileRow {
  id: string;
  act_id: string;
  telegram_file_id: string | null;
  storage_path: string | null;
  file_type: string;
  file_name: string | null;
  created_at: string;
}

const ACT_SELECT = `
  id,
  contractor_id,
  application_id,
  status,
  created_at,
  reviewed_at,
  act_number,
  act_date,
  service_report
`;

function buildContractorName(c: ContractorRow | null): string {
  if (!c) return '—';
  const parts = [c.first_name, c.last_name].filter(p => p && p.trim());
  return parts.join(' ') || '—';
}

/**
 * IMPORTANT:
 * We no longer update an act directly from the web UI for approved/rejected.
 * Instead we call the Telegram Edge Function so the exact same bot logic runs:
 * - act status is changed
 * - application is completed / updated
 * - work history is written
 * - Telegram group card is updated
 * - contractor gets a notification
 */
export async function updateActStatus(
  actId: string,
  status: ActStatus,
  reason?: string,
): Promise<void> {
  if (!actId) {
    throw new Error('ID акта відсутній.');
  }

  if(status==='pending') throw new Error('Прийнятий акт не можна скинути. Потрібна окрема процедура виправлення.');

  const action =
    status === 'approved'
      ? 'approve_act_from_web'
      : 'reject_act_from_web';

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token)
    throw new Error('Сесія завершилась. Увійдіть знову.');

  const {
    data: result,
    error: invokeError,
  } = await supabase.functions.invoke('smart-api', {
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    body: {
      action,
      act_id: actId,
      reason,
    },
  });

  if (invokeError) {
    let message = 'Не вдалося підтвердити дію. Перевірте з’єднання та повторіть.';
    try {
      const response = (invokeError as { context?: Response }).context;
      const body = response ? await response.json() : null;
      if (typeof body?.error === 'string' && !body.error.startsWith('Act was not changed'))
        message = body.error;
    } catch { /* Keep a readable error even for an empty or non-JSON response. */ }
    throw new Error(message);
  }

  if (!result?.ok) {
    throw new Error(
      result?.error ||
      'Telegram-бот не зміг обробити акт.',
    );
  }
}

/** Completion is the same office review used by the act register and the bot. */
export async function completeApplicationWithAct(applicationId: string): Promise<void> {
  const { data: acts, error } = await supabase.from('acts')
    .select('id,status').eq('application_id', applicationId)
    .in('status', ['pending', 'approved']).order('created_at', { ascending: false });
  if (error) throw new Error('Не вдалося перевірити первинний акт. Спробуйте ще раз.');
  const act = acts?.find(a => a.status === 'approved') || acts?.[0];
  if (!act) throw new Error('Додайте первинний акт у вкладці «Первинний акт».');
  if (act.status === 'pending') await updateActStatus(act.id, 'approved');
  const { data: application, error: stateError } = await supabase.from('applications')
    .select('status').eq('id', applicationId).single();
  if (stateError || application?.status !== 'completed')
    throw new Error('Завершення ще не підтверджено. Оновіть заявку та повторіть дію.');
}

export async function fetchActs(): Promise<ActItem[]> {
  const { data: actRows, error: actError } = await supabase
    .from('acts')
    .select(ACT_SELECT)
    .order('created_at', { ascending: false });

  if (actError) {
    throw new Error(`Не вдалося завантажити акти: ${actError.message}`);
  }

  if (!actRows || actRows.length === 0) {
    return [];
  }

  const acts = actRows as unknown as ActRow[];

  const contractorIds = [
    ...new Set(
      acts
        .map(a => a.contractor_id)
        .filter(Boolean),
    ),
  ] as string[];

  const applicationIds = [
    ...new Set(
      acts
        .map(a => a.application_id)
        .filter(Boolean),
    ),
  ] as string[];

  const [
    contractorsResult,
    applicationsResult,
    filesResult,
  ] = await Promise.all([
    contractorIds.length > 0
      ? supabase
          .from('contractors')
          .select('id, first_name, last_name, phone')
          .in('id', contractorIds)
      : Promise.resolve({
          data: [],
          error: null,
        }),

    applicationIds.length > 0
      ? supabase
          .from('applications')
          .select(
            'id, application_number, title, address, description, azk_code, actual_volume',
          )
          .in('id', applicationIds)
      : Promise.resolve({
          data: [],
          error: null,
        }),

    supabase
      .from('act_files')
      .select(
        'id, act_id, telegram_file_id, storage_path, file_type, file_name, created_at',
      )
      .order('created_at', {
        ascending: true,
      }),
  ]);

  if (contractorsResult.error) {
    throw new Error(
      `Не вдалося завантажити підрядників: ${contractorsResult.error.message}`,
    );
  }

  if (applicationsResult.error) {
    throw new Error(
      `Не вдалося завантажити заявки: ${applicationsResult.error.message}`,
    );
  }

  if (filesResult.error) {
    throw new Error(
      `Не вдалося завантажити файли: ${filesResult.error.message}`,
    );
  }

  const contractorMap = new Map<string, ContractorRow>();

  for (
    const c of
      (contractorsResult.data ?? []) as unknown as ContractorRow[]
  ) {
    contractorMap.set(c.id, c);
  }

  const applicationMap = new Map<string, ApplicationRow>();

  for (
    const a of
      (applicationsResult.data ?? []) as unknown as ApplicationRow[]
  ) {
    applicationMap.set(a.id, a);
  }

  const filesByAct = new Map<string, ActFile[]>();

  for (
    const f of
      (filesResult.data ?? []) as unknown as ActFileRow[]
  ) {
    const list =
      filesByAct.get(f.act_id) ?? [];

    const signed = f.storage_path
      ? await supabase.storage.from('application-media').createSignedUrl(f.storage_path, 3600)
      : null;
    if (signed?.error) throw new Error('Не вдалося відкрити файл первинного акта. Оновіть список.');
    list.push({
      id: f.id,
      actId: f.act_id,
      telegramFileId: f.telegram_file_id,
      fileType: f.file_type,
      fileName: f.file_name,
      createdAt: f.created_at,
      url: signed?.data?.signedUrl || (f.telegram_file_id ? telegramFileUrl(f.telegram_file_id) : ''),
    });

    filesByAct.set(
      f.act_id,
      list,
    );
  }

  return acts.map(row => {
    const contractor =
      row.contractor_id
        ? contractorMap.get(
            row.contractor_id,
          )
        : null;

    const application =
      row.application_id
        ? applicationMap.get(
            row.application_id,
          )
        : null;

    return {
      serviceReport:row.service_report,
      actualVolume:row.service_report?.volume ?? application?.actual_volume ?? null,
      id: row.id,
      actNumber:
        row.act_number,

      actDate:
        row.act_date,

      status:
        (row.status as ActStatus) ??
        'pending',

      createdAt:
        row.created_at,

      reviewedAt:
        row.reviewed_at,

      contractorId:
        row.contractor_id,

      contractorName:
        buildContractorName(
          contractor ?? null,
        ),

      contractorPhone:
        contractor?.phone ??
        null,

      applicationId:
        row.application_id,

      applicationNumber:
        application?.application_number ??
        '—',

      applicationTitle:
        application?.title ??
        '—',

      applicationAddress:
        application?.address ??
        null,

      applicationDescription:
        application?.description ??
        null,

      applicationAzkCode:
        application?.azk_code ??
        null,

      files:
        filesByAct.get(
          row.id,
        ) ?? [],
    };
  });
}
