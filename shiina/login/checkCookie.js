'use strict';

/**
 * Phân tích chuỗi raw cookie thành mảng đối tượng cookie chuẩn
 * @param {string} cookies 
 * @returns {Array}
 */
function parseRawCookie(cookies) {
    if (!cookies || typeof cookies !== 'string') return [];
    var trimmed = cookies.includes('useragent=') ? cookies.split('useragent=')[0] : cookies;
    return trimmed.split(';').map(function(pair) {
        var idx = pair.indexOf('=');
        if (idx === -1) return null;
        var key = pair.slice(0, idx).trim();
        var value = pair.slice(idx + 1).trim();
        if (!key || !value) return null;
        return {
            key: key,
            value: value,
            domain: "facebook.com",
            path: "/"
        };
    }).filter(Boolean);
}

/**
 * Nạp mảng cookie vào CookieJar
 * @param {object} jar 
 * @param {Array} cookieList 
 */
function populateJar(jar, cookieList) {
    if (!jar || !Array.isArray(cookieList)) return;
    cookieList.forEach(function(c) {
        if (!c) return;
        var key = c.key || c.name;
        var value = c.value;
        if (!key || value === undefined || value === null) return;
        var rawDomain = (c.domain || "facebook.com").replace(/^\./, "");
        var path = c.path || "/";
        var str = key + "=" + value + "; domain=." + rawDomain + "; path=" + path + ";";
        if (c.expires) {
            var exp = new Date(c.expires);
            if (!isNaN(exp.getTime())) {
                str += " expires=" + exp.toUTCString() + ";";
            }
        }
        jar.setCookie(str, "https://www.facebook.com");
        jar.setCookie(str, "https://facebook.com");
        jar.setCookie(key + "=" + value + "; path=" + path + ";", "https://www.facebook.com");
    });
}

/**
 * Chuẩn hóa input đăng nhập thành danh sách cookie hợp lệ
 * @param {string|Array} input 
 * @returns {Array}
 */
function normalizeCookieInput(input) {
    if (typeof input === 'string') {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed)) return parsed;
        } catch (_) {}
        return parseRawCookie(input);
    }
    if (Array.isArray(input)) return input;
    return [];
}

module.exports = {
    parseRawCookie,
    populateJar,
    normalizeCookieInput
};
