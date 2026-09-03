export const STUDENT_ENTRY_VERIFIED_EVENT = "student-entry:verified";
export const STUDENT_ENTRY_SHOW_EVENT = "student-entry:show";
export const STUDENT_ENTRY_CONTROLLER_READY_EVENT = "student-entry:controller-ready";
export function dispatchStudentEntryVerified(detail) {
    document.dispatchEvent(new CustomEvent(STUDENT_ENTRY_VERIFIED_EVENT, { detail }));
}
