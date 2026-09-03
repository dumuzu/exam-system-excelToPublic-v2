import { useEffect, useRef, useState, type FormEvent } from "react";

import type { StudentIdentity } from "../../../types/contracts/student-entry.ts";
import {
  STUDENT_ENTRY_CONTROLLER_READY_EVENT,
  STUDENT_ENTRY_SHOW_EVENT,
  dispatchStudentEntryVerified,
} from "../../exam/student-entry-bridge.ts";
import { ApiRequestError } from "../../shared/api/httpClient.ts";
import { useStudentVerification } from "../hooks/useStudentVerification.ts";

type EntryStage = "identity" | "confirmation" | "handoff";

function emptyIdentity(): StudentIdentity {
  return { examCode: "", studentNumber: "" };
}

function normalizeIdentity(identity: StudentIdentity): StudentIdentity {
  return {
    examCode: identity.examCode.normalize("NFKC").trim().toUpperCase(),
    studentNumber: identity.studentNumber.normalize("NFKC").trim(),
  };
}

function verificationErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "ROOM_COLLECTION_ACTIVE") return "答案を回収中です。この試験には入場できません。 / Answers are being collected. You cannot enter this exam.";
    if (error.code === "EXAM_CLOSED") return "この試験は終了しました。再入場や回答の再開はできません。 / This exam has ended. You cannot re-enter or resume answering.";
    if (error.status === 401) return "試験コードまたは学生番号を確認してください。";
    if (error.status === 429) return "しばらく待ってから、もう一度入力してください。";
  }
  return "確認できませんでした。先生に知らせてください。";
}

export function StudentEntryIsland() {
  const [stage, setStage] = useState<EntryStage>("identity");
  const [identity, setIdentity] = useState<StudentIdentity>(emptyIdentity);
  const [identityMessage, setIdentityMessage] = useState("");
  const [controllerReady, setControllerReady] = useState(
    () => document.documentElement.dataset["studentEntryController"] === "ready",
  );
  const verification = useStudentVerification();
  const examCodeInput = useRef<HTMLInputElement>(null);
  const studentNumberInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const showIdentityEntry = () => {
      verification.reset();
      setIdentityMessage("");
      setStage("identity");
      window.requestAnimationFrame(() => examCodeInput.current?.focus());
    };
    document.addEventListener(STUDENT_ENTRY_SHOW_EVENT, showIdentityEntry);
    return () => document.removeEventListener(STUDENT_ENTRY_SHOW_EVENT, showIdentityEntry);
  }, [verification.reset]);

  useEffect(() => {
    const markControllerReady = () => setControllerReady(true);
    document.addEventListener(STUDENT_ENTRY_CONTROLLER_READY_EVENT, markControllerReady);
    if (document.documentElement.dataset["studentEntryController"] === "ready") markControllerReady();
    return () => document.removeEventListener(STUDENT_ENTRY_CONTROLLER_READY_EVENT, markControllerReady);
  }, []);

  function handleIdentitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    verification.reset();
    const normalizedIdentity = normalizeIdentity(identity);
    if (!normalizedIdentity.examCode || !normalizedIdentity.studentNumber) {
      setIdentityMessage("試験コードと学生番号を入力してください。");
      return;
    }
    setIdentity(normalizedIdentity);
    setIdentityMessage("");
    setStage("confirmation");
  }

  function editIdentity() {
    verification.reset();
    setStage("identity");
    window.requestAnimationFrame(() => studentNumberInput.current?.focus());
  }

  function confirmIdentity() {
    verification.mutate(identity, {
      onSuccess: (result) => {
        // React 只负责入口校验；候场、入场和考试生命周期继续由既有控制器接管。
        dispatchStudentEntryVerified({ identity, result });
        setStage("handoff");
        setIdentity(emptyIdentity());
      },
    });
  }

  return (
    <>
      <section className="examCard" id="identity-card" hidden={stage !== "identity"}>
        <p className="kicker">IDENTITY CHECK</p>
        <h1><ruby>本人確認<rt>ほんにんかくにん</rt></ruby></h1>
        <p className="intro">
          試験コードと学校に登録した<ruby>学生番号<rt>がくせいばんごう</rt></ruby>を入力してください。
          <br />
          <small>Enter the exam code and your registered student number.</small>
        </p>
        <form className="identityForm" id="identityForm" noValidate onSubmit={handleIdentitySubmit}>
          <label>
            <span><ruby>試験コード<rt>しけんこーど</rt></ruby></span>
            <input
              ref={examCodeInput}
              id="exam-code"
              name="examCode"
              type="text"
              autoComplete="off"
              maxLength={50}
              required
              value={identity.examCode}
              onChange={(event) => setIdentity((current) => ({ ...current, examCode: event.target.value }))}
            />
          </label>
          <label>
            <span><ruby>学生番号<rt>がくせいばんごう</rt></ruby></span>
            <input
              ref={studentNumberInput}
              id="student-number"
              name="studentNumber"
              type="text"
              autoComplete="off"
              maxLength={32}
              required
              value={identity.studentNumber}
              onChange={(event) => setIdentity((current) => ({ ...current, studentNumber: event.target.value }))}
            />
          </label>
          <p className="status" id="identity-message" role="alert">{identityMessage}</p>
          <button type="submit">
            <ruby>入力内容<rt>にゅうりょくないよう</rt></ruby>を確認する
            <br />
            <small>CHECK MY DETAILS</small>
          </button>
        </form>
      </section>

      <section
        className="examCard confirmationCard"
        id="identity-confirm-card"
        hidden={stage !== "confirmation"}
        aria-busy={verification.isPending}
      >
        <p className="kicker">CONFIRM YOUR STUDENT NUMBER</p>
        <h1>
          学生番号を確認してください。
          <br />
          <small>Check your student number carefully.</small>
        </h1>
        <p className="identityWarning">
          間違った学生番号で受験すると、答案が別の学生として記録されます。
          <br />
          <small>If the number is wrong, your answers will be recorded for another student.</small>
        </p>
        <dl className="identityConfirmation">
          <dt>試験コード<br /><small>Exam code</small></dt>
          <dd id="confirm-exam-code">{identity.examCode}</dd>
          <dt>学生番号<br /><small>Student number</small></dt>
          <dd id="confirm-student-number">{identity.studentNumber}</dd>
        </dl>
        <div className="confirmationActions">
          <button className="secondaryAction" id="identity-edit" type="button" disabled={verification.isPending} onClick={editIdentity}>
            入力し直す<br /><small>EDIT</small>
          </button>
          <button id="identity-confirm" type="button" disabled={!controllerReady || verification.isPending} onClick={confirmIdentity}>
            {!controllerReady
              ? <>読み込み中…<br /><small>LOADING…</small></>
              : verification.isPending
                ? <>確認中…<br /><small>CHECKING…</small></>
                : <>この学生番号で進む<br /><small>YES, CONTINUE</small></>}
          </button>
        </div>
        <p className="status" id="confirm-message" role="alert">
          {verification.isError ? verificationErrorMessage(verification.error) : ""}
        </p>
      </section>
    </>
  );
}
