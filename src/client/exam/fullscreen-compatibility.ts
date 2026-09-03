interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
}

interface WebkitFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export function getFullscreenElement(documentRef: WebkitDocument = document): Element | null {
  return documentRef.fullscreenElement ?? documentRef.webkitFullscreenElement ?? null;
}

export function isFullscreenAvailable(documentRef: WebkitDocument = document, element: WebkitFullscreenElement = documentRef.documentElement): boolean {
  const enabled = documentRef.fullscreenEnabled ?? documentRef.webkitFullscreenEnabled;
  const hasRequestMethod = typeof element?.requestFullscreen === "function"
    || typeof element?.webkitRequestFullscreen === "function";
  return enabled === undefined ? hasRequestMethod : Boolean(enabled && hasRequestMethod);
}

export async function requestFullscreen(element: WebkitFullscreenElement | null | undefined): Promise<boolean> {
  const request = element?.requestFullscreen ?? element?.webkitRequestFullscreen;
  if (typeof request !== "function") return false;
  await request.call(element);
  return true;
}

export function observeFullscreenChanges(documentRef: WebkitDocument, listener: EventListener): () => void {
  const usesStandardEvent = "fullscreenEnabled" in documentRef
    || "fullscreenElement" in documentRef
    || "onfullscreenchange" in documentRef;
  const eventName = usesStandardEvent ? "fullscreenchange" : "webkitfullscreenchange";
  documentRef.addEventListener(eventName, listener);
  return () => documentRef.removeEventListener(eventName, listener);
}
