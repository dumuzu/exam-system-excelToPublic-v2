import { Toaster } from "sonner";

import { useAdminLocale } from "../i18n/AdminLocaleProvider.tsx";

const labels = {
  ja: { container: "通知", close: "通知を閉じる" },
  zh: { container: "系统通知", close: "关闭通知" },
  en: { container: "Notifications", close: "Close notification" },
} as const;

export function AdminToastViewport() {
  const { locale } = useAdminLocale();
  const t = labels[locale];
  return (
    <Toaster
      closeButton
      containerAriaLabel={t.container}
      duration={4_500}
      expand={false}
      gap={8}
      position="bottom-right"
      richColors={false}
      toastOptions={{
        closeButtonAriaLabel: t.close,
        classNames: {
          toast: "adminToast",
          title: "adminToastTitle",
          description: "adminToastDescription",
          closeButton: "adminToastClose",
          success: "adminToastSuccess",
          error: "adminToastError",
        },
      }}
      visibleToasts={3}
    />
  );
}
