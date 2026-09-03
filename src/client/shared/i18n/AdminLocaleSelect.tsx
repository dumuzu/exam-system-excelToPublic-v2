import { adminLocaleOptions, isAdminLocale, useAdminLocale } from "./AdminLocaleProvider.tsx";

const labels = {
  ja: "表示言語",
  zh: "界面语言",
  en: "Interface language",
} as const;

export function AdminLocaleSelect() {
  const { locale, setLocale } = useAdminLocale();

  return (
    <label className="localeSelector" htmlFor="adminLocaleSelector">
      <span className="visuallyHidden">{labels[locale]}</span>
      <select
        aria-label={labels[locale]}
        className="localeSelectField"
        id="adminLocaleSelector"
        onChange={(event) => {
          const nextLocale = event.currentTarget.value;
          if (isAdminLocale(nextLocale)) setLocale(nextLocale);
        }}
        value={locale}
      >
        {adminLocaleOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
