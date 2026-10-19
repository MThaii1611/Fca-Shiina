"use strict";
/**
 * login/cookie-parser.js
 * Parse và chuẩn hoá cookie đầu vào mọi định dạng (appState, cookie string, json string)
 * Bám sát normalizeCookieInput & filterKeysAppState của fca-shiina-lightspeed
 */

const CORE_COOKIE_KEYS = ["c_user", "xs", "datr", "fr", "sb", "i_user"];

function detectType(input) {
    if (!input) return "unknown";
    if (Array.isArray(input)) return "appstate";
    if (typeof input === "string") {
        const trimmed = input.trim();
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed) && parsed[0] && (parsed[0].key || parsed[0].name)) {
                    return "appstate";
                }
            } catch (_) {}
        }
        if (trimmed.includes("=")) return "cookie";
    }
    return "unknown";
}

function parseRawCookie(cookies) {
    if (!cookies || typeof cookies !== "string") return [];
    const trimmed = cookies.includes("useragent=") ? cookies.split("useragent=")[0] : cookies;
    return trimmed.split(";").map((pair) => {
        const idx = pair.indexOf("=");
        if (idx === -1) return null;
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (!key || !value) return null;
        return {
            key,
            value,
            domain: "facebook.com",
            path: "/"
        };
    }).filter(Boolean);
}

function parseToCookieArray(input) {
    let raw = input;
    if (typeof input === "string") {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed)) raw = parsed;
        } catch (_) {
            return parseRawCookie(input);
        }
    }

    if (Array.isArray(raw)) {
        return raw.map((c) => {
            if (!c) return null;
            const key = c.key || c.name || "";
            const value = c.value !== undefined ? String(c.value) : "";
            if (!key || !value) return null;
            return {
                key,
                value,
                domain: (c.domain || "facebook.com").replace(/^\./, ""),
                path: c.path || "/",
                secure: c.secure !== undefined ? c.secure : true,
                httpOnly: c.httpOnly !== undefined ? c.httpOnly : true,
                expires: c.expires || c.expirationDate
                    ? new Date((c.expires || c.expirationDate) * 1000)
                    : undefined
            };
        }).filter(Boolean);
    }

    return [];
}

function extractUID(cookieArr) {
    if (!Array.isArray(cookieArr)) return null;
    const found = cookieArr.find((c) => ["c_user", "i_user"].includes(c.key || c.name));
    return found && found.value ? String(found.value) : null;
}

function toCookieHeader(cookieArr) {
    return cookieArr.map((c) => `${c.key || c.name}=${c.value}`).join("; ");
}

module.exports = {
    CORE_COOKIE_KEYS,
    detectType,
    parseToCookieArray,
    extractUID,
    toCookieHeader
};
