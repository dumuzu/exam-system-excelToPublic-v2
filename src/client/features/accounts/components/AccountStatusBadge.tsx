import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge.tsx";
import { accountCopy } from "../accountCopy.ts";
import type { ManagedAccountStatus, ManagedPlatformRole } from "../../../../types/contracts/account-administration.ts";

export function AccountStatusBadge({ locale, status }: { locale: AdminLocale; status: ManagedAccountStatus }) {
  const tones: Record<ManagedAccountStatus, BadgeTone> = {
    active: "success",
    disabled: "neutral",
    migration_pending: "warning",
  };
  return <Badge tone={tones[status]}>{accountCopy[locale][status]}</Badge>;
}
export function AccountRoleBadge({ locale, role }: { locale: AdminLocale; role: ManagedPlatformRole }) {
  return <Badge tone={role === "super_admin" ? "danger" : "neutral"}>{accountCopy[locale][role]}</Badge>;
}
