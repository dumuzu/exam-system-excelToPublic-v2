const SUPPORTED_BROWSERS = Object.freeze({
    chrome: { pattern: /(?:^|\s)Chrome\/(\d+)/, minimumVersion: 109 },
    edge: { pattern: /(?:^|\s)Edg\/(\d+)/, minimumVersion: 109 },
    firefox: { pattern: /(?:^|\s)Firefox\/(\d+)/, minimumVersion: 115 },
    safari: { pattern: /(?:^|\s)Version\/(\d+(?:\.\d+)?).*\sSafari\//, minimumVersion: 16.4 },
});
export function detectSupportedBrowser(userAgent = "") {
    const source = String(userAgent);
    const desktopSafari = source.includes("Macintosh") && !source.includes("Mobile/") && SUPPORTED_BROWSERS.safari.pattern.test(source);
    const family = source.includes("Edg/")
        ? "edge"
        : source.includes("Firefox/")
            ? "firefox"
            : source.includes("Chrome/")
                ? "chrome"
                : desktopSafari
                    ? "safari"
                    : "unknown";
    if (family === "unknown")
        return { family, version: null, minimumVersion: null, supported: false };
    const policy = SUPPORTED_BROWSERS[family];
    const version = Number.parseFloat(source.match(policy.pattern)?.[1] ?? "");
    return {
        family,
        version: Number.isFinite(version) ? version : null,
        minimumVersion: policy.minimumVersion,
        supported: Number.isFinite(version) && version >= policy.minimumVersion,
    };
}
