import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, ClipboardCheck, ShieldCheck, Wallet, X } from "lucide-react";
import { portal } from '@/portal/api';
import OwnerOrderEditor from './OwnerOrderEditor';
import ApplicationActionDrawer from "@/components/ApplicationActionDrawer";
import {
  fetchApplication,
  fetchLinkedActs,
  type LinkedAct,
} from "@/lib/applicationsApi";
import type { Application } from "@/types";
export default function ApplicationWorkspace({
  id,
  onClose,
  onOpenSite,
  onOpenAct,
  onPayouts,
}: {
  id: string;
  onClose: () => void;
  onOpenSite: (site: string) => void;
  onOpenAct: (act?: string) => void;
  onPayouts: () => void;
}) {
  const [app, setApp] = useState<Application | null>(null),
    [acts, setActs] = useState<LinkedAct[]>([]),
    [error, setError] = useState("");
  const active = useRef(true);
  const [canEdit, setCanEdit] = useState(false), [editing, setEditing] = useState(false);
  useEffect(() => {
    let current = true;
    portal<{permissions: string[]}>('office.permissions').then(r => {
      if (current) setCanEdit(r.permissions.includes('applications.edit_any_stage'));
    }).catch(() => {if (current) setCanEdit(false);});
    return () => {current = false;};
  }, [id]);
  const load = useCallback(async () => {
    try {
      const [row, docs] = await Promise.all([
        fetchApplication(id),
        fetchLinkedActs(id),
      ]);
      if (active.current) {
        setApp(row);
        setActs(docs);
        setError("");
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, [load]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editing) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", escape);
      previous?.focus();
    };
  }, [onClose, editing]);
  if (editing) return <OwnerOrderEditor id={id} onClose={() => setEditing(false)} onSaved={async () => {await load(); setEditing(false);}}/>;
  if (!app)
    return (
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-[#071526]/95 p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Заявка"
      >
        <div className="ws-panel p-6">
          <button aria-label="Закрити заявку" onClick={onClose}>
            <X size={20} />
          </button>
          <p className="mt-4" role={error ? "alert" : "status"}>
            {error || "Завантажуємо заявку…"}
          </p>
          {error && (
            <button className="ws-button mt-4" onClick={() => void load()}>
              Повторити
            </button>
          )}
        </div>
      </div>
    );
  const latest = acts[0];
  const pending =
    latest && ["pending", "review", "on_review"].includes(latest.status);
  return (
    <ApplicationActionDrawer
      application={app}
      onClose={onClose}
      onChanged={load}
      primaryActAction={latest ? <button onClick={() => onOpenAct(latest.id)}><ClipboardCheck size={15} /> Переглянути акт</button> : undefined}
      resultLabel={
        pending
          ? "Акт на перевірці"
          : app.awaitingAct
            ? "Очікуємо акт"
            : undefined
      }
      relatedActions={
        <div className="ws-related">
          {canEdit && <button onClick={() => setEditing(true)}><ShieldCheck size={15}/>Редагувати заявку</button>}
          {app.customerSiteId && (
            <button onClick={() => onOpenSite(app.customerSiteId!)}>
              <Building2 size={15} /> Паспорт об’єкта
            </button>
          )}
          {app.status === "Виконана" && (
            <button onClick={onPayouts}>
              <Wallet size={15} /> Виплата
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      }
    />
  );
}
