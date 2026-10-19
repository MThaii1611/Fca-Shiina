"use strict";
/**
 * login/jar-builder.js
 * Xây dựng RequestJar chuẩn (dựa trên request.jar) từ mảng cookie đã parse
 * Đảm bảo các hàm getCookies, getCookieString luôn đồng bộ (synchronous)
 * Tránh lỗi trả về Promise dẫn đến Cookie: [object Promise] làm Facebook từ chối kết nối (CONNACK 21)
 * Không duplicate cookie khi xuất Cookie header
 */

let request;
try {
    request = require("request");
} catch (_) {}

const { CookieJar, Cookie } = require("tough-cookie");

const FB_DOMAINS = [
    "https://www.facebook.com"
];

function buildJar(cookieArr) {
    let jar;
    if (request && typeof request.jar === "function") {
        jar = request.jar();
        jar.getCookiesSync = function(uri) { return jar.getCookies(uri); };
        jar.getCookieStringSync = function(uri) { return jar.getCookieString(uri); };
        jar.setCookieSync = function(c, uri) { return jar.setCookie(c, uri); };
    } else {
        const rawJar = new CookieJar();
        jar = {
            _jar: rawJar,
            setCookie: function(c, uri) { return rawJar.setCookieSync(c, uri); },
            setCookieSync: function(c, uri) { return rawJar.setCookieSync(c, uri); },
            getCookies: function(uri) { return rawJar.getCookiesSync(uri); },
            getCookiesSync: function(uri) { return rawJar.getCookiesSync(uri); },
            getCookieString: function(uri) { return rawJar.getCookieStringSync(uri); },
            getCookieStringSync: function(uri) { return rawJar.getCookieStringSync(uri); }
        };
    }

    if (Array.isArray(cookieArr)) {
        for (const c of cookieArr) {
            if (!c) continue;
            const key = c.key || c.name;
            const value = c.value;
            if (!key || value === undefined || value === null) continue;

            const rawDomain = (c.domain || "facebook.com").replace(/^\./, "");
            const path = c.path || "/";
            let str = `${key}=${value}; domain=.${rawDomain}; path=${path};`;
            if (c.expires) {
                const exp = new Date(c.expires);
                if (!isNaN(exp.getTime())) {
                    str += ` expires=${exp.toUTCString()};`;
                }
            }

            try {
                jar.setCookie(str, "https://www.facebook.com");
            } catch (_) {}
        }
    }

    return jar;
}

function jarToArray(jar) {
    const seen = new Set();
    const result = [];
    for (const domain of FB_DOMAINS) {
        let cookies = [];
        try {
            if (typeof jar.getCookiesSync === "function") {
                cookies = jar.getCookiesSync(domain);
            } else if (typeof jar.getCookies === "function") {
                cookies = jar.getCookies(domain);
            }
        } catch (_) {}

        if (!Array.isArray(cookies)) continue;

        for (const c of cookies) {
            const id = `${c.key}:${c.domain}`;
            if (seen.has(id)) continue;
            seen.add(id);
            let exp = c.expires;
            if (!exp || exp === "Infinity") {
                exp = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
            } else if (exp instanceof Date) {
                exp = exp.toISOString();
            } else if (typeof exp === "number") {
                exp = new Date(exp > 1e11 ? exp : exp * 1000).toISOString();
            } else {
                exp = String(exp);
            }
            result.push({
                key:          c.key,
                value:        c.value,
                domain:       c.domain || "facebook.com",
                path:         c.path || "/",
                hostOnly:     c.hostOnly !== undefined ? c.hostOnly : false,
                creation:     c.creation instanceof Date ? c.creation.toISOString() : new Date().toISOString(),
                lastAccessed: c.lastAccessed instanceof Date ? c.lastAccessed.toISOString() : new Date().toISOString(),
                expires:      exp
            });
        }
    }
    return result;
}

function saveCookies(jar) {
    return (res) => {
        if (!res || !res.headers) return res;
        const setCookie = res.headers["set-cookie"];
        if (setCookie) {
            const url = res.url || res.config?.url || "https://www.facebook.com";
            const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
            for (const c of arr) {
                try {
                    if (typeof jar.setCookieSync === "function") {
                        jar.setCookieSync(c, url);
                    } else if (typeof jar.setCookie === "function") {
                        jar.setCookie(c, url);
                    }
                } catch (_) {}
            }
        }
        return res;
    };
}

module.exports = { buildJar, jarToArray, saveCookies };
