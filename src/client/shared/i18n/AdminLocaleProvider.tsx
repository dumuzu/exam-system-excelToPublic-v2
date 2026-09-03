import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { adminLocaleOptions, isAdminLocale, type AdminLocale } from "./adminLocale.ts";

export { adminLocaleOptions, isAdminLocale, type AdminLocale } from "./adminLocale.ts";

interface AdminLocaleContextValue {
  locale: AdminLocale;
  setLocale: (locale: AdminLocale) => void;
}

const storageKey = "excel-web-exam-admin-locale";
const AdminLocaleContext = createContext<AdminLocaleContextValue | null>(null);

function initialLocale(): AdminLocale {
  const stored = localStorage.getItem(storageKey) ?? "";
  return isAdminLocale(stored) ? stored : "ja";
}

export function AdminLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AdminLocale>(initialLocale);

  useEffect(() => {
    const localeOption = adminLocaleOptions.find((option) => option.value === locale);
    document.documentElement.lang = localeOption?.documentLanguage ?? locale;
    document.title = localeOption?.productName ?? "試験管理システム";
    localStorage.setItem(storageKey, locale);
  }, [locale]);

  const value = useMemo<AdminLocaleContextValue>(() => ({
    locale,
    setLocale: setLocaleState,
  }), [locale]);

  return <AdminLocaleContext.Provider value={value}>{children}</AdminLocaleContext.Provider>;
}

export function useAdminLocale(): AdminLocaleContextValue {
  const value = useContext(AdminLocaleContext);
  if (!value) throw new Error("useAdminLocale must be used inside AdminLocaleProvider.");
  return value;
}
