import type { ManagedSubject } from "../../../../types/contracts/account-administration.ts";
import { ApiRequestError } from "../../../shared/api/httpClient.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { DestructiveConfirmDialog } from "../../../shared/patterns/DestructiveConfirmDialog.tsx";
import { InlineFeedback } from "../../../shared/patterns/PageStates.tsx";
import { useSubjectStatusMutation } from "../hooks/useSubjectMutations.ts";

const copy = {
  ja: {
    archiveTitle: "科目を保管", restoreTitle: "科目を有効化", archiveDescription: "科目を保管すると教員への新規割り当て対象から外れます。過去の試験、答案、成績は削除されません。進行中または未終了の試験がある科目は保管できません。", restoreDescription: "科目を再び教員への割り当てと運用の対象に戻します。",
    cancel: "キャンセル", archive: "保管する", restore: "有効化する", archiving: "保管中…", restoring: "有効化中…",
    openExams: "未終了の試験があるため保管できません。先に該当する試験を終了してください。", protected: "この標準科目は保管できません。", failed: "科目の状態を変更できませんでした。",
  },
  zh: {
    archiveTitle: "归档科目", restoreTitle: "恢复科目", archiveDescription: "归档后，该科目不再用于新的教师分配。已有考试、答卷和成绩不会删除。仍有进行中或未结束考试的科目不能归档。", restoreDescription: "重新启用该科目，使其可以继续分配给教师并投入使用。",
    cancel: "取消", archive: "确认归档", restore: "确认恢复", archiving: "归档中…", restoring: "恢复中…",
    openExams: "该科目仍有未结束的考试，请先结束相关考试后再归档。", protected: "系统标准科目不能归档。", failed: "无法更改科目状态。",
  },
  en: {
    archiveTitle: "Archive subject", restoreTitle: "Restore subject", archiveDescription: "Archived subjects are removed from new teacher assignments. Existing exams, papers, and results are retained. A subject with an open exam cannot be archived.", restoreDescription: "Return this subject to active teacher assignment and operation.",
    cancel: "Cancel", archive: "Archive subject", restore: "Restore subject", archiving: "Archiving…", restoring: "Restoring…",
    openExams: "This subject still has an open exam. Close the exam before archiving the subject.", protected: "This core subject cannot be archived.", failed: "The subject status could not be changed.",
  },
} as const;

export function SubjectStatusDialog({ csrfToken, locale, onClose, onComplete, subject }: {
  csrfToken: string;
  locale: AdminLocale;
  onClose: () => void;
  onComplete: () => void;
  subject: ManagedSubject;
}) {
  const mutation = useSubjectStatusMutation();
  const t = copy[locale];
  const archiving = subject.status === "active";
  const errorMessage = mutation.error instanceof ApiRequestError
    ? mutation.error.code === "SUBJECT_HAS_OPEN_EXAMS" ? t.openExams
      : mutation.error.code === "SUBJECT_PROTECTED" ? t.protected
        : mutation.error.message
    : t.failed;

  return (
    <DestructiveConfirmDialog
      cancelLabel={t.cancel}
      confirmLabel={archiving ? t.archive : t.restore}
      confirmVariant={archiving ? "danger" : "primary"}
      description={archiving ? t.archiveDescription : t.restoreDescription}
      objectLabel={subject.code}
      onCancel={onClose}
      onConfirm={() => mutation.mutate({ csrfToken, subjectId: subject.id, status: archiving ? "archived" : "active" }, { onSuccess: onComplete })}
      open
      pending={mutation.isPending}
      pendingLabel={archiving ? t.archiving : t.restoring}
      title={archiving ? t.archiveTitle : t.restoreTitle}
    >
      {mutation.isError ? <InlineFeedback tone="error">{errorMessage}</InlineFeedback> : null}
    </DestructiveConfirmDialog>
  );
}
