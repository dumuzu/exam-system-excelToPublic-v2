import type { AdminLocale } from "../../shared/i18n/AdminLocaleProvider.tsx";
import type { RoomSummaryKey, RoomVisibleStatus } from "./types.ts";

interface ExamRoomCopy {
  title: string;
  assignmentTitle: string;
  description: string;
  assignmentDescription: string;
  back: string;
  refresh: string;
  refreshing: string;
  loading: string;
  search: string;
  searchPlaceholder: string;
  allStatuses: string;
  rollCallTitle: string;
  rollCallDescription: string;
  selectAllWaiting: (count: number) => string;
  clearSelection: (count: number) => string;
  admitSelected: (count: number) => string;
  student: string;
  status: string;
  arrival: string;
  activity: string;
  submitted: string;
  attempts: string;
  actions: string;
  admit: string;
  resume: string;
  retake: string;
  emptyRoster: string;
  emptyFiltered: string;
  clearFilters: string;
  loadError: string;
  loadErrorDescription: string;
  sessionError: string;
  permissionError: string;
  notFoundError: string;
  syncError: string;
  failureSyncError: string;
  lastUpdated: (time: string) => string;
  retry: string;
  actionError: string;
  violations: (count: number, limit: number) => string;
  attemptCount: (count: number) => string;
  resumeTitle: string;
  resumeDescription: string;
  suspendedResumeDescription: string;
  resumeConfirm: string;
  resumePending: string;
  resumeDone: string;
  retakeTitle: string;
  retakeDescription: string;
  retakeConfirm: string;
  retakePending: string;
  retakeDone: string;
  cancel: string;
  terminate: string;
  terminateTitle: string;
  terminateDescription: string;
  terminateConfirm: string;
  terminatePending: string;
  terminateCollecting: (seconds: number) => string;
  terminateProcessing: (count: number) => string;
  terminateDone: (count: number) => string;
  failureTitle: string;
  failureDescription: string;
  failureCount: (count: number) => string;
  failureAttempts: string;
  failureLastAt: string;
  retryFailure: string;
  retryFailureTitle: string;
  retryFailureDescription: string;
  retryFailurePending: string;
  retryFailureDone: string;
  statusLabels: Record<RoomVisibleStatus, string>;
  summaryLabels: Record<RoomSummaryKey, string>;
}

const jaStatusLabels: Record<RoomVisibleStatus, string> = {
  not_entered: "未入室",
  waiting_approval: "確認待ち",
  admitted: "開始待ち",
  in_progress: "受験中",
  policy_suspended: "規則違反・一時停止",
  disconnected: "接続切れ",
  resume_ready: "再開許可済み",
  submitted: "提出済み",
  auto_submitted: "時間切れ提出",
  teacher_submitted: "教師回収済み",
  policy_submitted: "規則による提出",
  expired: "終了時刻超過",
  review_required: "確認必要",
  assignment_not_started: "未開始",
  assignment_in_progress: "取組中",
  assignment_second_ready: "2回目待ち",
  assignment_submitted_once: "1回提出",
  assignment_completed_twice: "2回完了",
};

const zhStatusLabels: Record<RoomVisibleStatus, string> = {
  not_entered: "未进入",
  waiting_approval: "等待确认",
  admitted: "等待开始",
  in_progress: "考试中",
  policy_suspended: "违规暂停",
  disconnected: "连接中断",
  resume_ready: "已允许继续",
  submitted: "已提交",
  auto_submitted: "到时提交",
  teacher_submitted: "教师已收卷",
  policy_submitted: "按规则提交",
  expired: "已超过结束时间",
  review_required: "需要确认",
  assignment_not_started: "未开始",
  assignment_in_progress: "练习中",
  assignment_second_ready: "第二次待开始",
  assignment_submitted_once: "已提交一次",
  assignment_completed_twice: "已完成两次",
};

const enStatusLabels: Record<RoomVisibleStatus, string> = {
  not_entered: "Not entered", waiting_approval: "Awaiting approval", admitted: "Ready to start", in_progress: "In progress",
  policy_suspended: "Suspended for integrity review", disconnected: "Disconnected", resume_ready: "Resume approved", submitted: "Submitted",
  auto_submitted: "Submitted at time limit", teacher_submitted: "Collected by teacher", policy_submitted: "Submitted by policy", expired: "Past end time",
  review_required: "Review required", assignment_not_started: "Not started", assignment_in_progress: "In progress", assignment_second_ready: "Second attempt ready",
  assignment_submitted_once: "Submitted once", assignment_completed_twice: "Completed twice",
};

export const examRoomCopy = {
  ja: {
    title: "考場管理",
    assignmentTitle: "課題進捗管理",
    description: "到着・開始・接続状態を確認し、本人確認が完了した学生を許可します。",
    assignmentDescription: "学生の開始状況と提出回数を確認します。課題では入室許可は不要です。",
    back: "考場一覧へ戻る",
    refresh: "更新",
    refreshing: "更新中…",
    loading: "考場情報を読み込み中",
    search: "学生を検索",
    searchPlaceholder: "学生番号または氏名",
    allStatuses: "すべて",
    rollCallTitle: "点名確認",
    rollCallDescription: "教室内で本人を確認した学生だけを選択してください。",
    selectAllWaiting: (count) => `確認待ちを選択（${count}）`,
    clearSelection: (count) => `選択解除（${count}）`,
    admitSelected: (count) => `選択した学生を許可（${count}）`,
    student: "学生",
    status: "状態",
    arrival: "申請時刻",
    activity: "最終アクセス",
    submitted: "提出時刻",
    attempts: "受験回数",
    actions: "操作",
    admit: "許可する",
    resume: "続きから再開",
    retake: "再受験を開く",
    emptyRoster: "受験者名簿に学生がいません。",
    emptyFiltered: "条件に一致する学生はいません。",
    clearFilters: "絞り込みを解除",
    loadError: "考場情報を読み込めませんでした",
    loadErrorDescription: "ネットワークまたは権限状態を確認して、もう一度お試しください。",
    sessionError: "ログインの有効期限が切れました。ログイン画面へ移動します。",
    permissionError: "この考場を表示する権限がありません。担当科目またはアカウント権限を確認してください。",
    notFoundError: "この考場は存在しないか、すでに削除されています。考場一覧へ戻って確認してください。",
    syncError: "考場との同期が中断しています。表示中の情報は最新ではない可能性があります。更新をお試しください。",
    failureSyncError: "答案収集の失敗記録を更新できません。表示内容が古い可能性があります。",
    lastUpdated: (time) => `更新 ${time}`,
    retry: "再読み込み",
    actionError: "操作を完了できませんでした。",
    violations: (count, limit) => `警告 ${count} / ${limit}`,
    attemptCount: (count) => `${count}回`,
    resumeTitle: "試験を再開する",
    resumeDescription: "旧端末のセッションを無効にし、保存済み答案と元の終了時刻を維持したまま再入室を許可します。",
    suspendedResumeDescription: "一時停止した同じ答案を、停止時に残っていた時間から再開します。",
    resumeConfirm: "再開を許可",
    resumePending: "許可中…",
    resumeDone: "再開を許可しました。",
    retakeTitle: "再受験を許可する",
    retakeDescription: "提出済み答案を監査記録として保持し、同じ問題で新しい空の答案を開きます。",
    retakeConfirm: "再受験を許可",
    retakePending: "処理中…",
    retakeDone: "新しい受験を開放しました。",
    cancel: "戻る",
    terminate: "答案を回収して終了",
    terminateTitle: "答案を回収して考場を終了する",
    terminateDescription: "オンライン答案の最終同期を待った後、未提出答案をサーバー上の最新保存内容で回収します。この操作は取り消せません。",
    terminateConfirm: "答案を回収して終了",
    terminatePending: "回収中…",
    terminateCollecting: (seconds) => `学生の最新入力を同期しています（残り ${seconds} 秒）`,
    terminateProcessing: (count) => `保存済み答案を回収しています（残り ${count} 件）`,
    terminateDone: (count) => `考場を終了し、${count} 件の答案を回収しました。`,
    failureTitle: "答案収集の失敗",
    failureDescription: "失敗した答案は未提出のまま保護されています。原因を確認して個別に再試行してください。",
    failureCount: (count) => `答案収集の失敗は${count}件です。`,
    failureAttempts: "失敗回数",
    failureLastAt: "最終失敗",
    retryFailure: "再試行",
    retryFailureTitle: "この答案を再収集する",
    retryFailureDescription: "サーバーに保存された最新答案を使用して、この答案だけを再度提出します。",
    retryFailurePending: "再試行中…",
    retryFailureDone: "答案の再収集を実行しました。",
    statusLabels: jaStatusLabels,
    summaryLabels: { ...jaStatusLabels, assignment_total: "名簿合計" },
  },
  zh: {
    title: "考场管理",
    assignmentTitle: "课堂练习进度",
    description: "查看到场、开始和连接状态，仅放行已经完成身份确认的学生。",
    assignmentDescription: "查看学生的开始状态和提交次数；课堂练习无需逐一放行。",
    back: "返回考场列表",
    refresh: "刷新",
    refreshing: "刷新中…",
    loading: "正在加载考场信息",
    search: "搜索学生",
    searchPlaceholder: "学号或姓名",
    allStatuses: "全部",
    rollCallTitle: "点名确认",
    rollCallDescription: "只选择已在教室内核对身份的学生。",
    selectAllWaiting: (count) => `选择等待学生（${count}）`,
    clearSelection: (count) => `清空选择（${count}）`,
    admitSelected: (count) => `放行选中学生（${count}）`,
    student: "学生",
    status: "状态",
    arrival: "申请时间",
    activity: "最后访问",
    submitted: "交卷时间",
    attempts: "考试次数",
    actions: "操作",
    admit: "通过",
    resume: "继续原答卷",
    retake: "再次开放考试",
    emptyRoster: "当前考试名单中没有学生。",
    emptyFiltered: "没有符合当前条件的学生。",
    clearFilters: "清除筛选",
    loadError: "无法读取考场信息",
    loadErrorDescription: "请检查网络或权限状态后重新尝试。",
    sessionError: "登录会话已失效，正在返回登录页面。",
    permissionError: "当前账户没有查看这个考场的权限，请检查所属科目或账户权限。",
    notFoundError: "这个考场不存在或已被删除，请返回考场列表确认。",
    syncError: "考场同步已中断，当前显示的数据可能不是最新状态，请尝试刷新。",
    failureSyncError: "收卷失败记录暂时无法同步，当前显示的记录可能不是最新状态。",
    lastUpdated: (time) => `更新于 ${time}`,
    retry: "重新加载",
    actionError: "操作未能完成。",
    violations: (count, limit) => `警告 ${count} / ${limit}`,
    attemptCount: (count) => `${count} 次`,
    resumeTitle: "允许继续考试",
    resumeDescription: "旧设备会话将失效，已保存答案和原结束时间保持不变。",
    suspendedResumeDescription: "继续同一份暂停的答卷，并从暂停时保留的剩余时间继续计时。",
    resumeConfirm: "允许继续",
    resumePending: "处理中…",
    resumeDone: "已允许学生继续考试。",
    retakeTitle: "允许再次参加考试",
    retakeDescription: "已提交答卷会保留为审计记录，系统将使用同一套题目创建新的空白答卷。",
    retakeConfirm: "允许再次考试",
    retakePending: "处理中…",
    retakeDone: "新的考试次数已开放。",
    cancel: "返回",
    terminate: "收卷并结束考试",
    terminateTitle: "收集答卷并结束考场",
    terminateDescription: "系统等待在线答卷完成最后同步，再按服务器保存的最新内容回收未提交答卷。此操作无法撤销。",
    terminateConfirm: "收卷并结束",
    terminatePending: "正在收卷…",
    terminateCollecting: (seconds) => `正在同步学生的最新输入（剩余 ${seconds} 秒）`,
    terminateProcessing: (count) => `正在回收服务器保存的答卷（剩余 ${count} 份）`,
    terminateDone: (count) => `考场已结束，共回收 ${count} 份答卷。`,
    failureTitle: "收卷失败记录",
    failureDescription: "失败的答卷仍保持未提交状态，请确认原因后单独重试。",
    failureCount: (count) => `当前有 ${count} 份答卷收集失败。`,
    failureAttempts: "失败次数",
    failureLastAt: "最后失败",
    retryFailure: "重新收集",
    retryFailureTitle: "重新收集这份答卷",
    retryFailureDescription: "使用服务器保存的最新答案，仅重新提交这一份答卷。",
    retryFailurePending: "正在重试…",
    retryFailureDone: "已执行单份答卷重试。",
    statusLabels: zhStatusLabels,
    summaryLabels: { ...zhStatusLabels, assignment_total: "名单总数" },
  },
  en: {
    title: "Exam room", assignmentTitle: "Assignment progress", description: "Review arrival, start, and connection status, then admit only students whose identity has been confirmed.",
    assignmentDescription: "Review each student's start status and submission count. Assignments do not require individual admission.", back: "Back to exam rooms", refresh: "Refresh", refreshing: "Refreshing…", loading: "Loading exam room",
    search: "Search students", searchPlaceholder: "Student number or name", allStatuses: "All statuses", rollCallTitle: "Identity check", rollCallDescription: "Select only students whose identity has been confirmed in the room.",
    selectAllWaiting: (count) => `Select waiting students (${count})`, clearSelection: (count) => `Clear selection (${count})`, admitSelected: (count) => `Admit selected students (${count})`,
    student: "Student", status: "Status", arrival: "Requested at", activity: "Last activity", submitted: "Submitted at", attempts: "Attempts", actions: "Actions", admit: "Admit", resume: "Resume paper", retake: "Open another attempt",
    emptyRoster: "There are no students on this exam roster.", emptyFiltered: "No students match the current filters.", clearFilters: "Clear filters", loadError: "Exam room information could not be loaded", loadErrorDescription: "Check the connection or your permissions and try again.",
    sessionError: "Your session has expired. Returning to the sign-in page.", permissionError: "This account cannot view the exam room. Check the subject assignment and account permissions.", notFoundError: "This exam room does not exist or has been deleted. Return to the exam room list to confirm.",
    syncError: "Exam room synchronization has stopped. The displayed information may be out of date; try refreshing.", failureSyncError: "Collection failures could not be synchronized. The displayed records may be out of date.", lastUpdated: (time) => `Updated ${time}`, retry: "Reload", actionError: "The operation could not be completed.",
    violations: (count, limit) => `Warnings ${count} / ${limit}`, attemptCount: (count) => `${count} attempts`, resumeTitle: "Resume exam", resumeDescription: "Invalidate the previous device session and allow re-entry with saved answers and the original end time intact.",
    suspendedResumeDescription: "Resume the same suspended paper from the time that remained when it was paused.", resumeConfirm: "Allow resume", resumePending: "Authorizing…", resumeDone: "The student may resume the exam.",
    retakeTitle: "Allow another attempt", retakeDescription: "Keep the submitted paper as an audit record and open a new blank paper with the same questions.", retakeConfirm: "Allow another attempt", retakePending: "Processing…", retakeDone: "A new attempt is available.",
    cancel: "Back", terminate: "Collect papers and end exam", terminateTitle: "Collect papers and close the exam room", terminateDescription: "Wait for online papers to complete a final sync, then collect every unsubmitted paper using the latest server copy. This action cannot be undone.",
    terminateConfirm: "Collect and end", terminatePending: "Collecting…", terminateCollecting: (seconds) => `Synchronizing students' latest input (${seconds} seconds remaining)`, terminateProcessing: (count) => `Collecting saved papers (${count} remaining)`, terminateDone: (count) => `The exam room is closed and ${count} papers were collected.`,
    failureTitle: "Collection failures", failureDescription: "Failed papers remain unsubmitted and protected. Review the cause and retry each one separately.", failureCount: (count) => `${count} papers failed to collect.`, failureAttempts: "Failed attempts", failureLastAt: "Last failure", retryFailure: "Retry", retryFailureTitle: "Collect this paper again", retryFailureDescription: "Submit only this paper again using the latest answers saved on the server.", retryFailurePending: "Retrying…", retryFailureDone: "The paper collection was retried.",
    statusLabels: enStatusLabels, summaryLabels: { ...enStatusLabels, assignment_total: "Roster total" },
  },
} as const satisfies Record<AdminLocale, ExamRoomCopy>;
