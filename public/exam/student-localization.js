export function formatStudentText(copy, locale) {
    return locale === "legacy_bilingual" ? `${copy.ja} / ${copy.en}` : copy[locale];
}
export function studentLanguageTag(locale) {
    if (locale === "zh")
        return "zh-CN";
    if (locale === "en")
        return "en";
    return "ja";
}
export function isStudentDisplayLocale(value) {
    return value === "legacy_bilingual" || value === "ja" || value === "zh" || value === "en";
}
export function resolveStudentDisplayLocale(...candidates) {
    return candidates.find(isStudentDisplayLocale) ?? "legacy_bilingual";
}
const shellCopy = {
    brand: { ja: "Web 試験", zh: "在线考试", en: "Web Exam" },
    waitingKicker: { ja: "試験規則・待機室", zh: "考试规则 · 候考室", en: "Exam rules · Waiting room" },
    waitingTitle: { ja: "試験規則を必ず読んでください。", zh: "请仔细阅读考试规则。", en: "Read all exam rules before you begin." },
    strictRule1: { ja: "全画面を維持してください。解除されると試験内容は直ちに隠れます。復帰猶予は1回目10秒、2回目5秒、3回目以降3秒で、時間内に戻らない場合のみ警告として記録されます。", zh: "请保持全屏。退出全屏后试卷会立即隐藏；恢复时限依次为10秒、5秒，之后均为3秒，只有超时才会记录警告。", en: "Stay in fullscreen. The paper is hidden immediately if fullscreen closes. Recovery time is 10 seconds, then 5 seconds, then 3 seconds thereafter; only a timeout records a warning." },
    strictRule2: { ja: "別のタブ、ウィンドウ、アプリへ切り替えてはいけません。", zh: "请勿切换到其他标签页、窗口或应用。", en: "Do not switch to another tab, window, or application." },
    strictRule3: { ja: "コピー、貼り付け、他人との相談は禁止です。", zh: "禁止复制、粘贴或与他人讨论答案。", en: "Copying, pasting, and communicating with others are prohibited." },
    strictRule4: { ja: "禁止操作は警告として記録されます。", zh: "违规操作会被记录为警告。", en: "Every prohibited action is recorded as a warning." },
    strictRule5: { ja: "禁止操作が3回記録されると答案と残り時間を保存して一時停止します。再開には教師の許可が必要です。", zh: "累计3次违规后，系统会保存答卷和剩余时间并暂停考试；恢复考试需要教师许可。", en: "After 3 recorded violations, the answer sheet and remaining time are preserved and the exam is paused. Teacher approval is required to resume." },
    waitingPending: { ja: "先生の入室許可を待っています。", zh: "正在等待教师批准进入考场。", en: "Waiting for the teacher to approve your entry." },
    rulesContinue: { ja: "規則を理解しました・開始確認へ進む", zh: "我已了解规则，继续考试准备", en: "I understand — continue" },
    waitingInstruction: { ja: "この画面を閉じず、先生の指示を待ってください。", zh: "请勿关闭此页面，并等待教师指示。", en: "Keep this page open and wait for your teacher." },
    assignmentKicker: { ja: "課題モード", zh: "课堂练习", en: "Classroom practice" },
    assignmentTitle: { ja: "課題を始めます。", zh: "开始课堂练习。", en: "Start the classroom practice." },
    assignmentRule1: { ja: "制限時間と全画面の指定はありません。", zh: "本练习没有时间限制，也不要求全屏。", en: "There is no time limit or fullscreen requirement." },
    assignmentRule2: { ja: "回答はこのページを開いている間だけ保持されます。途中で終了すると入力内容は保存されません。", zh: "答案只会在当前页面打开期间保留；中途退出会丢失未提交内容。", en: "Answers are kept only while this page stays open. Closing it discards unfinished work." },
    assignmentRule3: { ja: "提出後に点数を確認できます。提出は最大2回です。", zh: "提交后可以查看得分，每名学生最多提交2次。", en: "You can see your score after submission. Each student may submit at most twice." },
    assignmentStart: { ja: "課題を開始する", zh: "开始练习", en: "Start practice" },
    terminalKicker: { ja: "答案の状態", zh: "答卷状态", en: "Attempt status" },
    terminalTitle: { ja: "この答案はすでに提出されています。", zh: "这份答卷已经提交。", en: "This attempt has already been submitted." },
    terminalBody: { ja: "同じ答案を再び開くことはできません。再度ログインすると教師への入室申請になり、許可後は最初に準備された同じ問題を空の答案と新しい制限時間で開始します。", zh: "已提交的答卷不能重新打开。再次登录会向教师发送新的入场申请；批准后将使用原试题、空白答卷和新的考试时限重新开始。", en: "The submitted answer sheet stays locked. Signing in again sends a new admission request. After teacher approval, the original prepared paper opens with blank answers and a new timer." },
    terminalBack: { ja: "別の試験コードを入力", zh: "输入其他考试代码", en: "Enter another code" },
    terminalRecheck: { ja: "受験資格を再確認", zh: "重新检查考试资格", en: "Check again" },
    preflightKicker: { ja: "試験開始前の確認", zh: "考前检查", en: "Pre-exam check" },
    preflightTitle: { ja: "環境を確認してください。", zh: "请检查考试环境。", en: "Check your exam environment." },
    preflightIntro: { ja: "試験を開始する前に、ブラウザと全画面モードを確認します。", zh: "开始考试前，系统会检查浏览器和全屏模式。", en: "Before the exam starts, the browser and fullscreen mode will be checked." },
    preflightInstruction: { ja: "すべて確認できたら、下のボタンを押してください。", zh: "所有项目通过后，请点击下方按钮。", en: "When every check passes, select the button below." },
    fullscreenStart: { ja: "全画面で試験を始める", zh: "全屏开始考试", en: "Start exam in fullscreen" },
    studentLabel: { ja: "学生", zh: "学生", en: "Student" },
    questionLabel: { ja: "問題", zh: "题目", en: "Question" },
    timeRemaining: { ja: "残り時間", zh: "剩余时间", en: "Time remaining" },
    examRulesKicker: { ja: "試験規則", zh: "考试规则", en: "Exam rules" },
    examRulesTitle: { ja: "試験ルール", zh: "考试规则", en: "Exam rules" },
    examRule1: { ja: "全画面解除時は試験内容を隠す", zh: "退出全屏后立即隐藏试卷", en: "The paper is hidden when fullscreen closes." },
    examRule2: { ja: "復帰猶予は10秒 → 5秒 → 以降3秒", zh: "恢复时限：10秒 → 5秒 → 之后3秒", en: "Recovery grace: 10s → 5s → 3s thereafter." },
    examRule3: { ja: "時間内に戻らない場合のみ警告を記録", zh: "只有超时未返回才记录警告", en: "Only a timeout records a warning." },
    examRule4: { ja: "コピー・貼り付けは禁止", zh: "禁止复制和粘贴", en: "No copy or paste." },
    examRule5: { ja: "禁止操作3回で答案と残り時間を保存して一時停止", zh: "违规3次后保存答卷和剩余时间并暂停", en: "3 violations pause the saved answer sheet and timer." },
    examRule6: { ja: "再開には教師の許可が必要", zh: "恢复考试需要教师许可", en: "Teacher approval is required to resume." },
    choiceLegend: { ja: "正しい関数を一つ選んでください。", zh: "请选择一个正确的函数。", en: "Choose one correct function." },
    manualChoiceLegend: { ja: "回答を選択してください", zh: "请选择答案", en: "Select your answer" },
    manualShortLabel: { ja: "回答", zh: "回答", en: "Answer" },
    markdownPreview: { ja: "回答プレビュー", zh: "回答预览", en: "Answer preview" },
    questionList: { ja: "問題一覧", zh: "题目列表", en: "Questions" },
    previousQuestion: { ja: "← 前の問題", zh: "← 上一题", en: "← Previous" },
    nextQuestion: { ja: "次の問題 →", zh: "下一题 →", en: "Next →" },
    guideKicker: { ja: "操作ガイド", zh: "操作指南", en: "Quick guide" },
    guideTitle: { ja: "操作ガイド", zh: "操作指南", en: "Quick guide" },
    excelGuide1: { ja: "関数名を入力すると候補と使い方が表示されます", zh: "输入函数名后会显示候选项和用法", en: "Type a function name to see suggestions and syntax." },
    excelGuide2: { ja: "セルをクリック、またはドラッグ", zh: "点击或拖动单元格", en: "Click or drag cells." },
    excelGuide3: { ja: "選択範囲が数式欄に入ります", zh: "所选区域会填入公式栏", en: "The selected range enters the formula bar." },
    excelGuide4: { ja: "問題番号で移動できます", zh: "可以通过题号切换题目", en: "Use question numbers to navigate." },
    excelGuide5: { ja: "緑の番号は回答済み", zh: "绿色题号表示已作答", en: "Green means answered." },
    manualGuide1: { ja: "表示された形式に従って回答します", zh: "请按照显示的题型作答", en: "Answer each question in its displayed format." },
    manualGuide2: { ja: "記述式は Markdown を使用できます", zh: "简答题支持 Markdown", en: "Short answers support Markdown text." },
    manualGuide3: { ja: "答案は入力後に自動保存されます", zh: "输入的答案会自动保存", en: "Your response is autosaved." },
    manualGuide4: { ja: "添付ファイルは提出できません", zh: "不能上传附件", en: "Student attachments are not accepted." },
    manualGuide5: { ja: "緑の番号は回答済みです", zh: "绿色题号表示已作答", en: "Green means answered." },
    submittedKicker: { ja: "提出完了", zh: "提交完成", en: "Submitted" },
    submittedTitle: { ja: "答案を提出しました", zh: "答卷已提交", en: "Your answers were submitted" },
    submittedBody: { ja: "提出後は問題や回答を再度見ることはできません。採点結果は先生から案内されます。", zh: "提交后不能再次查看题目或答案，评分结果由教师另行通知。", en: "Questions and answers cannot be reopened after submission. Your teacher will provide the result." },
    submittedAt: { ja: "提出時刻", zh: "提交时间", en: "Submitted at" },
    submittedMethod: { ja: "提出方法", zh: "提交方式", en: "Submission method" },
    scoreLabel: { ja: "今回の得点", zh: "本次得分", en: "Your score" },
    assignmentRetry: { ja: "2回目の課題に進む", zh: "开始第2次作答", en: "Start second submission" },
    submittedNote: { ja: "この画面を閉じて、先生の指示を待ってください。", zh: "请关闭此页面并等待教师指示。", en: "Close this page and wait for your teacher." },
    violationKicker: { ja: "試験規則の警告", zh: "考试规则警告", en: "Exam policy warning" },
    violationTitle: { ja: "禁止操作を検出しました", zh: "检测到违规操作", en: "Prohibited action detected" },
    violationRule: { ja: "全画面が解除されると試験内容は直ちに隠れます。復帰猶予は1回目10秒、2回目5秒、3回目以降3秒です。時間内に戻っても、次回の猶予は短くなります。", zh: "退出全屏后试卷会立即隐藏。恢复时限依次为10秒、5秒，之后均为3秒；即使及时返回，下一次时限仍会缩短。", en: "The paper is hidden immediately. Recovery grace is 10 seconds, then 5 seconds, then 3 seconds thereafter. Each interruption advances the schedule even when recovered in time." },
    violationZeroRule: { ja: "禁止操作が3回記録されると、答案と残り時間を保存して一時停止します。再開には教師の許可が必要です。", zh: "累计3次违规后，系统会保存答卷和剩余时间并暂停考试；恢复考试需要教师许可。", en: "After 3 recorded violations, the saved answer sheet and timer are paused. Teacher approval is required to resume." },
    violationReturn: { ja: "試験に戻る", zh: "返回考试", en: "Return to exam" },
    submitKicker: { ja: "答案提出", zh: "提交答卷", en: "Final submission" },
    submitTitle: { ja: "答案を提出しますか？", zh: "确认提交答卷吗？", en: "Submit your answers?" },
    submitCancel: { ja: "戻って確認する", zh: "返回检查", en: "Review answers" },
    submitConfirm: { ja: "確認して提出", zh: "确认提交", en: "Confirm submission" },
    finalKicker: { ja: "最終確認", zh: "最终确认", en: "Final confirmation" },
    finalTitle: { ja: "本当に答案を提出しますか？", zh: "确定要提交答卷吗？", en: "Are you sure you want to submit?" },
    finalWarning: { ja: "この操作を行うと、現在の答案は直ちに確定されます。提出後は問題画面へ戻れません。", zh: "确认后当前答卷会立即锁定，提交后不能返回题目页面。", en: "This action immediately locks your current answer sheet. You cannot return to the questions after submission." },
    finalStudentNumber: { ja: "学生番号", zh: "学号", en: "Student number" },
    finalCancel: { ja: "提出しない", zh: "暂不提交", en: "Do not submit" },
};
const shellBindings = [
    [".examHeader > span:last-child", "brand"],
    ["#waiting-card > .kicker", "waitingKicker"],
    ["#waiting-card > h1", "waitingTitle"],
    [".strictRules li:nth-child(1)", "strictRule1"],
    [".strictRules li:nth-child(2)", "strictRule2"],
    [".strictRules li:nth-child(3)", "strictRule3"],
    [".strictRules li:nth-child(4)", "strictRule4"],
    [".strictRules li:nth-child(5)", "strictRule5"],
    ["#waitingStatus strong", "waitingPending"],
    ["#rules-continue", "rulesContinue"],
    ["#waiting-card > .instruction", "waitingInstruction"],
    ["#assignmentIntroCard > .kicker", "assignmentKicker"],
    ["#assignmentIntroCard > h1", "assignmentTitle"],
    [".assignmentRules li:nth-child(1)", "assignmentRule1"],
    [".assignmentRules li:nth-child(2)", "assignmentRule2"],
    [".assignmentRules li:nth-child(3)", "assignmentRule3"],
    ["#assignment-start", "assignmentStart"],
    ["#terminalEntryCard > .kicker", "terminalKicker"],
    ["#terminalEntryCard > h1", "terminalTitle"],
    ["#terminalEntryBody", "terminalBody"],
    ["#terminal-back", "terminalBack"],
    ["#terminal-recheck", "terminalRecheck"],
    ["#preflight-card > .kicker", "preflightKicker"],
    ["#preflight-card > h1", "preflightTitle"],
    ["#preflight-card > .intro", "preflightIntro"],
    ["#preflight-card > .instruction", "preflightInstruction"],
    ["#fullscreen-button", "fullscreenStart"],
    [".examStudentIdentity > small", "studentLabel"],
    [".examProgress > small", "questionLabel"],
    [".examCountdown > small", "timeRemaining"],
    [".examRules > .sideKicker", "examRulesKicker"],
    [".examRules > h2", "examRulesTitle"],
    [".examRules li:nth-child(1)", "examRule1"],
    [".examRules li:nth-child(2)", "examRule2"],
    [".examRules li:nth-child(3)", "examRule3"],
    [".examRules li:nth-child(4)", "examRule4"],
    [".examRules li:nth-child(5)", "examRule5"],
    [".examRules li:nth-child(6)", "examRule6"],
    ["#choiceWorkbench > legend", "choiceLegend"],
    ["#manualChoiceResponse > legend", "manualChoiceLegend"],
    [".manualShortResponse > label", "manualShortLabel"],
    [".manualMarkdownPreview > span", "markdownPreview"],
    [".questionNavigator > div:first-child > strong", "questionList"],
    ["#previous-button", "previousQuestion"],
    ["#next-button", "nextQuestion"],
    [".examGuide > .sideKicker", "guideKicker"],
    [".examGuide > h2", "guideTitle"],
    ["#excel-quick-guide li:nth-child(1)", "excelGuide1"],
    ["#excel-quick-guide li:nth-child(2)", "excelGuide2"],
    ["#excel-quick-guide li:nth-child(3)", "excelGuide3"],
    ["#excel-quick-guide li:nth-child(4)", "excelGuide4"],
    ["#excel-quick-guide li:nth-child(5)", "excelGuide5"],
    ["#manual-quick-guide li:nth-child(1)", "manualGuide1"],
    ["#manual-quick-guide li:nth-child(2)", "manualGuide2"],
    ["#manual-quick-guide li:nth-child(3)", "manualGuide3"],
    ["#manual-quick-guide li:nth-child(4)", "manualGuide4"],
    ["#manual-quick-guide li:nth-child(5)", "manualGuide5"],
    [".submittedCard > .kicker", "submittedKicker"],
    [".submittedCard > h1", "submittedTitle"],
    ["#submittedBody", "submittedBody"],
    [".submittedCard dt:nth-of-type(1)", "submittedAt"],
    [".submittedCard dt:nth-of-type(2)", "submittedMethod"],
    ["#assignmentResult > span", "scoreLabel"],
    ["#assignment-retry", "assignmentRetry"],
    [".submittedNote", "submittedNote"],
    ["#violationDialog .kicker", "violationKicker"],
    ["#violationDialog h2", "violationTitle"],
    [".violationCheatingRule", "violationRule"],
    [".violationZeroRule", "violationZeroRule"],
    ["#violation-confirm", "violationReturn"],
    ["#submitDialog > .kicker", "submitKicker"],
    ["#submitDialog > h2", "submitTitle"],
    ["#submit-cancel", "submitCancel"],
    ["#submit-confirm", "submitConfirm"],
    ["#finalSubmitDialog > .kicker", "finalKicker"],
    ["#finalSubmitDialog > h2", "finalTitle"],
    [".finalSubmitWarning", "finalWarning"],
    [".finalSubmitIdentity > span", "finalStudentNumber"],
    ["#final-submit-cancel", "finalCancel"],
];
const legacyChildren = new WeakMap();
function cloneChildren(element) {
    return Array.from(element.childNodes, (node) => node.cloneNode(true));
}
export function applyStudentShellLocale(documentRef, locale) {
    documentRef.documentElement.dataset["studentLocale"] = locale;
    documentRef.documentElement.lang = studentLanguageTag(locale);
    documentRef.title = formatStudentText({ ja: "Web 試験", zh: "在线考试", en: "Web Exam" }, locale);
    for (const [selector, key] of shellBindings) {
        const element = documentRef.querySelector(selector);
        if (!element)
            continue;
        if (!legacyChildren.has(element))
            legacyChildren.set(element, cloneChildren(element));
        if (locale === "legacy_bilingual") {
            const children = legacyChildren.get(element) ?? [];
            element.replaceChildren(...children.map((node) => node.cloneNode(true)));
            continue;
        }
        element.textContent = formatStudentText(shellCopy[key], locale);
    }
    const shortAnswer = documentRef.querySelector("#manual-short-answer");
    if (shortAnswer) {
        shortAnswer.placeholder = formatStudentText({
            ja: "回答を入力してください。",
            zh: "请输入回答。",
            en: "Enter your answer.",
        }, locale);
    }
    const attributes = [
        ["#question-table", "aria-label", { ja: "問題データ", zh: "题目数据", en: "Question data" }],
        ["#formula-answer", "aria-label", { ja: "数式入力", zh: "公式输入", en: "Formula input" }],
        ["#formulaSuggestions", "aria-label", { ja: "関数候補", zh: "函数建议", en: "Function suggestions" }],
        [".questionNavigator", "aria-label", { ja: "問題ナビゲーション", zh: "题目导航", en: "Question navigation" }],
        ["#undo-button", "title", { ja: "元に戻す", zh: "撤销", en: "Undo" }],
        ["#redo-button", "title", { ja: "やり直す", zh: "重做", en: "Redo" }],
    ];
    for (const [selector, attribute, copy] of attributes) {
        documentRef.querySelector(selector)?.setAttribute(attribute, formatStudentText(copy, locale));
    }
}
