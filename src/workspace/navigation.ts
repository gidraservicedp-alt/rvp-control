import {
  LayoutDashboard,
  FileText,
  Building2,
  Truck,
  Users,
  ClipboardCheck,
  Wallet,
  BarChart3,
  CalendarDays,
  Settings,
  Bell,
  ShieldCheck,
  History,
  MapPinned,
  Zap,
  Archive,
  TriangleAlert,
} from "lucide-react";
import type { PageId } from "@/lib/permissions";

export const navigationGroups: {
  label: string;
  items: { id: PageId; label: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    label: "Робота",
    items: [
      { id: "today", label: "Огляд", icon: LayoutDashboard },
      { id: "applications", label: "Заявки", icon: FileText },
      { id: "objects", label: "Об’єкти", icon: Building2 },
      { id: "contractors", label: "Виконавці", icon: Truck },
      { id: "calendar", label: "Календар", icon: CalendarDays },
    ],
  },
  {
    label: "Документи та розрахунки",
    items: [
      { id: "acts", label: "Первинні акти", icon: ClipboardCheck },
      { id: "rpv-reports", label: "РПВ та звіти", icon: BarChart3 },
      { id: "payouts", label: "Виплати", icon: Wallet },
      { id: "finance", label: "Фінанси", icon: BarChart3 },
    ],
  },
  {
    label: "Довідники та контроль",
    items: [
      { id: "customers", label: "Менеджери АЗК", icon: Users },
      { id: "object-map", label: "Карта об’єктів", icon: MapPinned },
      { id: "statistics", label: "Статистика", icon: BarChart3 },
      { id: "problems", label: "Проблеми", icon: TriangleAlert },
      { id: "archive", label: "Архів", icon: Archive },
    ],
  },
  {
    label: "Система",
    items: [
      { id: "notifications", label: "Сповіщення", icon: Bell },
      { id: "automation", label: "Автоматизація", icon: Zap },
      { id: "administrators", label: "Доступи", icon: ShieldCheck },
      { id: "audit-log", label: "Журнал дій", icon: History },
      { id: "settings", label: "Налаштування", icon: Settings },
    ],
  },
];
export const primaryNavigation = navigationGroups[0].items.slice(0, 4);
export const pageLabel = (id: PageId) =>
  navigationGroups.flatMap((g) => g.items).find((i) => i.id === id)?.label ||
  "Огляд";

export type WorkspaceRoute = {
  page: PageId;
  application?: string;
  site?: string;
  record?: string;
  network?: string;
  region?: string;
  month?: string;
};
const pageIds = new Set<string>([
  ...navigationGroups.flatMap((g) => g.items.map((i) => i.id)),
  "dashboard",
  "control-center",
  "contractor-rating",
]);
export function readRoute(search: string): WorkspaceRoute {
  const p = new URLSearchParams(search),
    raw = p.get("page") || "today";
  return {
    page: (pageIds.has(raw) ? raw : "today") as PageId,
    application: p.get("application") || undefined,
    site: p.get("site") || undefined,
    record: p.get("record") || undefined,
    network: p.get("network") || undefined,
    region: p.get("region") || undefined,
    month: p.get("month") || undefined,
  };
}
export function routeSearch(route: WorkspaceRoute): string {
  const p = new URLSearchParams({ page: route.page });
  for (const key of ["application", "site", "record", "network", "region", "month"] as const)
    if (route[key]) p.set(key, route[key]!);
  return `?${p}`;
}
