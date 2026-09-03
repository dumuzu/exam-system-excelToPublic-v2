import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { AuthoringPreviewResponse } from "../../../../types/contracts/exam-authoring.ts";
import type { ManagedAssessmentTypeKey } from "../../../../types/contracts/account-administration.ts";
import type { WorkspaceSubject } from "../../../../types/contracts/admin-auth.ts";
import type { AdminLocale } from "../../../shared/i18n/AdminLocaleProvider.tsx";
import { AsyncButton } from "../../../shared/patterns/AsyncButton.tsx";
import { PageSkeleton, QueryErrorState } from "../../../shared/patterns/PageStates.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { TextField } from "../../../shared/ui/TextField.tsx";
import {
  authoringConfigurationQueryOptions,
  authoringFunctionQueryOptions,
  authoringModeQueryOptions,
  preparationQueryOptions,
} from "../api/authoringQueries.ts";
import { authoringCopy, authoringErrorMessage } from "../copy.ts";
import {
  useAssessmentPreviewMutation,
  useAuthoringConfigurationMutation,
  usePublishAssessmentMutation,
  useSaveAuthoringConfigurationMutation,
} from "../hooks/useAuthoringMutations.ts";
import { activePreparationStorageKey, usePreparationRunner } from "../hooks/usePreparationRunner.ts";
import {
  authoringDraftReducer,
  buildAuthoringConfigurationBody,
  buildAuthoringPreviewBody,
  buildPublishAssessmentBody,
  createAuthoringDraft,
  draftFromConfiguration,
} from "../model/authoringDraft.ts";
import {
  importRosterFiles,
  jsonRequestByteLength,
  maximumExcelExamRequestBytes,
  maximumManualExamRequestBytes,
} from "../model/rosterImport.ts";
import type { AuthoringDraftAction, ManualQuestionDraft, RosterImportResult } from "../types.ts";
import { AuthoringPreviewPanel } from "./AuthoringPreviewPanel.tsx";
import { ConfigurationHistoryPanel } from "./ConfigurationHistoryPanel.tsx";
import { ExcelAuthoringEditor } from "./ExcelAuthoringEditor.tsx";
import { ManualAuthoringEditor } from "./ManualAuthoringEditor.tsx";
import { PreparationDialog } from "./PreparationDialog.tsx";
import { RosterImportField } from "./RosterImportField.tsx";

interface AuthoringWorkspaceProps {
  assessmentTypeKey: ManagedAssessmentTypeKey;
  csrfToken: string;
  locale: AdminLocale;
  onAssessmentTypeChange: (assessmentTypeKey: ManagedAssessmentTypeKey) => void;
  subject: WorkspaceSubject;
}

interface PreviewSnapshot {
  readonly revision: number;
  readonly result: Extract<AuthoringPreviewResponse, { ok: true }>;
}

export function AuthoringWorkspace({ assessmentTypeKey, csrfToken, locale, onAssessmentTypeChange, subject }: AuthoringWorkspaceProps) {
  const [draft, dispatch] = useReducer(authoringDraftReducer, assessmentTypeKey, createAuthoringDraft);
  const [preview, setPreview] = useState<PreviewSnapshot | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterImportResult | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [recoveryCode] = useState(() => globalThis.sessionStorage.getItem(activePreparationStorageKey));
  const recoveryStarted = useRef(false);
  const t = authoringCopy[locale];
  const modesQuery = useQuery(authoringModeQueryOptions(subject.id, assessmentTypeKey));
  const functionsQuery = useQuery(authoringFunctionQueryOptions(subject.id, assessmentTypeKey));
  const configurationsQuery = useQuery(authoringConfigurationQueryOptions(subject.id, assessmentTypeKey));
  const recoveryQuery = useQuery({
    ...preparationQueryOptions(subject.id, recoveryCode ?? ""),
    enabled: recoveryCode !== null,
    retry: false,
  });
  const previewMutation = useAssessmentPreviewMutation();
  const saveMutation = useSaveAuthoringConfigurationMutation(subject.id);
  const useConfigurationMutation = useAuthoringConfigurationMutation(subject.id);
  const publishMutation = usePublishAssessmentMutation(subject.id);
  const {
    clear: clearPreparation,
    recover: recoverPreparation,
    run: runPreparation,
    state: preparationState,
  } = usePreparationRunner(subject.id, csrfToken);
  const maximumStudents = draft.kind === "excel" && draft.mode === "assignment" ? 500 : 200;
  const stalePreview = preview !== null && preview.revision !== draft.revision;

  useEffect(() => {
    if (!recoveryCode || recoveryStarted.current) return;
    if (recoveryQuery.isError) {
      globalThis.sessionStorage.removeItem(activePreparationStorageKey);
      recoveryStarted.current = true;
      return;
    }
    if (!recoveryQuery.data) return;
    recoveryStarted.current = true;
    recoverPreparation(
      { code: recoveryCode, rosterCount: recoveryQuery.data.rosterCount },
      recoveryQuery.data,
    );
  }, [recoverPreparation, recoveryCode, recoveryQuery.data, recoveryQuery.isError]);

  const updateDraft = useCallback((action: AuthoringDraftAction) => {
    dispatch(action);
    setPreviewError(null);
  }, []);

  const previewDraft = useCallback(async (candidate = draft) => {
    try {
      setPreviewError(null);
      const result = await previewMutation.mutateAsync({
        assessmentTypeKey,
        body: buildAuthoringPreviewBody(candidate),
        subjectId: subject.id,
      });
      if (!result.ok) throw Object.assign(new Error(result.errors[0]?.message ?? "PREVIEW_FAILED"), {
        code: result.errors[0]?.code,
      });
      setPreview({ revision: candidate.revision, result });
      return result;
    } catch (error) {
      const message = authoringErrorMessage(error, locale);
      setPreviewError(message);
      throw error;
    }
  }, [assessmentTypeKey, draft, locale, previewMutation, subject.id]);

  const handleRosterFiles = useCallback(async (files: readonly File[]) => {
    setRosterBusy(true);
    setRosterError(null);
    try {
      setRoster(await importRosterFiles(files, maximumStudents));
    } catch (error) {
      setRoster(null);
      setRosterError(authoringErrorMessage(error, locale));
    } finally {
      setRosterBusy(false);
    }
  }, [locale, maximumStudents]);

  const handleSave = async () => {
    try {
      await previewDraft();
    } catch {
      return;
    }
    try {
      await saveMutation.mutateAsync({
        assessmentTypeKey,
        body: buildAuthoringConfigurationBody(draft),
        csrfToken,
        subjectId: subject.id,
      });
      toast.success(t.saved);
    } catch (error) {
      toast.error(authoringErrorMessage(error, locale));
    }
  };

  const handlePublish = async () => {
    let body: ReturnType<typeof buildPublishAssessmentBody>;
    try {
      if (!roster) throw Object.assign(new Error("ROSTER_FILE_REQUIRED"), { code: "ROSTER_FILE_REQUIRED" });
      body = buildPublishAssessmentBody(draft, roster.text);
      const maximumBytes = draft.kind === "manual" ? maximumManualExamRequestBytes : maximumExcelExamRequestBytes;
      if (jsonRequestByteLength(body) > maximumBytes) {
        throw Object.assign(new Error("ROSTER_REQUEST_TOO_LARGE"), { code: "ROSTER_REQUEST_TOO_LARGE" });
      }
    } catch (error) {
      toast.error(authoringErrorMessage(error, locale));
      return;
    }
    try {
      await previewDraft();
    } catch {
      return;
    }
    try {
      const exam = await publishMutation.mutateAsync({ assessmentTypeKey, body, csrfToken, subjectId: subject.id });
      void runPreparation(exam);
    } catch (error) {
      toast.error(authoringErrorMessage(error, locale));
    }
  };

  const handleUseConfiguration = async (configurationId: string) => {
    let loadedDraft: ReturnType<typeof draftFromConfiguration>;
    try {
      const configuration = await useConfigurationMutation.mutateAsync({ assessmentTypeKey, configurationId, csrfToken, subjectId: subject.id });
      loadedDraft = draftFromConfiguration(configuration, `${configuration.name}${t.copySuffix}`);
      updateDraft({ type: "replace_draft", draft: loadedDraft });
      setPreview(null);
      setRoster(null);
    } catch (error) {
      toast.error(authoringErrorMessage(error, locale));
      return;
    }
    try {
      await previewDraft(loadedDraft);
    } catch {
      // 预览错误已显示在配置面板中，避免重复 Toast。
    }
  };

  const manualChange = useCallback(
    (question: ManualQuestionDraft) => updateDraft({ type: "replace_manual_question", question }),
    [updateDraft],
  );
  const manualMove = useCallback(
    (questionKey: string, direction: -1 | 1) => updateDraft({ type: "move_manual_question", questionKey, direction }),
    [updateDraft],
  );
  const manualRemove = useCallback(
    (questionKey: string) => updateDraft({ type: "remove_manual_question", questionKey }),
    [updateDraft],
  );

  const retryBootstrap = () => {
    void Promise.all([modesQuery.refetch(), functionsQuery.refetch()]);
  };
  if (modesQuery.isLoading || functionsQuery.isLoading) return <PageSkeleton rows={9} />;
  if (modesQuery.isError || functionsQuery.isError) {
    return <QueryErrorState description={t.loadErrorDescription} onRetry={retryBootstrap} retryLabel={t.retry} title={t.loadError} />;
  }

  const actionBusy = previewMutation.isPending || saveMutation.isPending || publishMutation.isPending;
  return (
    <>
      <div className="authoringWorkspaceGrid">
        <section aria-labelledby="authoringConfigurationTitle" className="authoringMainPanel">
          <header className="authoringPanelHeader"><h2 id="authoringConfigurationTitle">{t.configuration}</h2></header>
          <div className="authoringFormFlow">
            {subject.assessmentTypeKeys.length > 1 ? (
              <fieldset className="authoringCapabilityFieldset">
                <legend>{t.authoringCapability}</legend>
                <div className="authoringSegmented">
                  {subject.assessmentTypeKeys.map((key) => (
                    <label key={key}>
                      <input
                        checked={assessmentTypeKey === key}
                        name="assessmentTypeKey"
                        onChange={() => onAssessmentTypeChange(key)}
                        type="radio"
                      />
                      <span>{key === "excel_formula" ? t.excelCapability : t.manualCapability}</span>
                    </label>
                  ))}
                </div>
                <p>{t.authoringCapabilityHint}</p>
              </fieldset>
            ) : null}
            <div className="authoringCoreFields" data-has-duration={draft.kind === "manual" || draft.mode === "exam"}>
              <TextField
                id="configurationName"
                label={t.configurationName}
                maxLength={100}
                onChange={(event) => updateDraft({ type: "set_name", name: event.currentTarget.value })}
                placeholder={t.configurationPlaceholder}
                value={draft.name}
              />
              {draft.kind === "manual" || draft.mode === "exam" ? (
                <TextField
                  className="authoringDurationField"
                  hint={t.durationHint}
                  id="durationMinutes"
                  label={t.duration}
                  max={240}
                  min={1}
                  onChange={(event) => {
                    const value = Number.parseInt(event.currentTarget.value, 10);
                    if (Number.isInteger(value) && value >= 1 && value <= 240) {
                      updateDraft({ type: "set_duration_minutes", durationMinutes: value });
                    }
                  }}
                  required
                  step={1}
                  type="number"
                  value={draft.durationMinutes}
                />
              ) : null}
            </div>
            <RosterImportField
              busy={rosterBusy}
              error={rosterError}
              locale={locale}
              onFilesSelected={(files) => void handleRosterFiles(files)}
              result={roster}
            />
            {draft.kind === "excel" ? (
              <ExcelAuthoringEditor
                draft={draft}
                functions={functionsQuery.data ?? []}
                locale={locale}
                modes={modesQuery.data ?? []}
                onDifficultyChange={(difficulty) => updateDraft({ type: "set_excel_difficulty", difficulty })}
                onFunctionToggle={(functionName) => updateDraft({ type: "toggle_function", functionName })}
                onModeChange={(mode) => {
                  if (mode === "exam" && roster && roster.count > 200) {
                    setRoster(null);
                    setRosterError(authoringErrorMessage({ code: "ROSTER_TOO_LARGE" }, locale));
                  }
                  updateDraft({ type: "set_excel_mode", mode });
                }}
                onQuestionsPerFunctionChange={(count) => updateDraft({ type: "set_questions_per_function", count })}
                onSelectFunctions={(functionNames) => updateDraft({ type: "select_functions", functionNames })}
              />
            ) : (
              <ManualAuthoringEditor
                draft={draft}
                locale={locale}
                onAdd={(questionType) => updateDraft({ type: "add_manual_question", questionType })}
                onChange={manualChange}
                onMove={manualMove}
                onPaperRuleChange={(paperRule) => updateDraft({ type: "set_manual_paper_rule", paperRule })}
                onRemove={manualRemove}
              />
            )}
          </div>
          {previewError ? <p className="inlineFeedback authoringActionError" data-tone="error" role="alert">{previewError}</p> : null}
          <footer className="authoringActions">
            <AsyncButton
              disabled={actionBusy}
              onClick={() => void previewDraft()}
              pending={previewMutation.isPending && !saveMutation.isPending && !publishMutation.isPending}
              pendingLabel={t.previewWorking}
              variant="secondary"
            >{t.preview}</AsyncButton>
            <AsyncButton
              disabled={actionBusy}
              onClick={() => void handleSave()}
              pending={saveMutation.isPending}
              pendingLabel={t.saving}
              variant="primary"
            >{t.save}</AsyncButton>
            <AsyncButton
              disabled={actionBusy || rosterBusy}
              onClick={() => void handlePublish()}
              pending={publishMutation.isPending}
              pendingLabel={t.publishing}
              variant="primary"
            >{t.publish}</AsyncButton>
          </footer>
        </section>

        <aside className="authoringSideColumn">
          <AuthoringPreviewPanel
            error={previewError}
            locale={locale}
            preview={preview?.result ?? null}
            stale={stalePreview}
            working={previewMutation.isPending}
          />
          <ConfigurationHistoryPanel
            configurations={configurationsQuery.data ?? []}
            error={configurationsQuery.isError}
            loading={configurationsQuery.isLoading}
            loadingId={useConfigurationMutation.isPending ? useConfigurationMutation.variables?.configurationId ?? null : null}
            locale={locale}
            onRefresh={() => void configurationsQuery.refetch()}
            onUse={(configurationId) => void handleUseConfiguration(configurationId)}
            refreshing={configurationsQuery.isFetching && !configurationsQuery.isLoading}
          />
        </aside>
      </div>
      <PreparationDialog
        locale={locale}
        onClose={clearPreparation}
        state={preparationState}
      />
    </>
  );
}
