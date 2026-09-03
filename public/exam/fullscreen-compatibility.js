export function getFullscreenElement(documentRef = document) {
    return documentRef.fullscreenElement ?? documentRef.webkitFullscreenElement ?? null;
}
export function isFullscreenAvailable(documentRef = document, element = documentRef.documentElement) {
    const enabled = documentRef.fullscreenEnabled ?? documentRef.webkitFullscreenEnabled;
    const hasRequestMethod = typeof element?.requestFullscreen === "function"
        || typeof element?.webkitRequestFullscreen === "function";
    return enabled === undefined ? hasRequestMethod : Boolean(enabled && hasRequestMethod);
}
export async function requestFullscreen(element) {
    const request = element?.requestFullscreen ?? element?.webkitRequestFullscreen;
    if (typeof request !== "function")
        return false;
    await request.call(element);
    return true;
}
export function observeFullscreenChanges(documentRef, listener) {
    const usesStandardEvent = "fullscreenEnabled" in documentRef
        || "fullscreenElement" in documentRef
        || "onfullscreenchange" in documentRef;
    const eventName = usesStandardEvent ? "fullscreenchange" : "webkitfullscreenchange";
    documentRef.addEventListener(eventName, listener);
    return () => documentRef.removeEventListener(eventName, listener);
}
