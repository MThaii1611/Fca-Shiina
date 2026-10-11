'use strict';

const CORE_COOKIE_KEYS = ["c_user", "xs", "datr", "fr", "sb", "i_user"];

/**
 * Lọc và chuẩn hóa danh sách cookie trong appState
 * @param {Array} appState
 * @returns {Array}
 */
function filterKeysAppState(appState) {
    if (!Array.isArray(appState)) return [];
    var filtered = appState.filter(function(item) {
        if (!item) return false;
        var key = item.key || item.name;
        return CORE_COOKIE_KEYS.includes(key);
    });
    return filtered.length > 0 ? filtered : appState;
}

/**
 * Trích xuất User ID (UID) từ cookie jar, html hoặc appState
 * @param {object} jar 
 * @param {string} html 
 * @param {Array} appState 
 * @returns {string|null}
 */
function resolveUserID(jar, html, appState) {
    var cookies = []
        .concat((jar && typeof jar.getCookies === 'function' ? jar.getCookies("https://www.facebook.com") : []) || [])
        .concat((jar && typeof jar.getCookies === 'function' ? jar.getCookies("https://facebook.com") : []) || [])
        .concat((jar && typeof jar.getCookies === 'function' ? jar.getCookies("http://www.facebook.com") : []) || []);
    var found = cookies.find(function(c) {
        return ["c_user", "i_user"].includes(c.key || c.name);
    });
    if (found && found.value) return String(found.value);

    if (Array.isArray(appState)) {
        var inState = appState.find(function(c) {
            return ["c_user", "i_user"].includes(c.key || c.name);
        });
        if (inState && inState.value) return String(inState.value);
    }

    if (html && typeof html === 'string') {
        var m = html.match(/"USER_ID":"(\d+)"/) || html.match(/"ACCOUNT_ID":"(\d+)"/) || html.match(/c_user=(\d+)/);
        if (m && m[1]) return String(m[1]);
    }

    return null;
}

/**
 * Kiểm tra tính hợp lệ của AppState
 * @param {any} state 
 * @returns {Array|null}
 */
function validateAppState(state) {
    if (!state) return null;
    let parsedState = state;
    if (typeof state === 'string') {
        try {
            parsedState = JSON.parse(state);
        } catch (_) {
            return null;
        }
    }
    if (!Array.isArray(parsedState) || parsedState.length === 0) {
        return null;
    }
    return filterKeysAppState(parsedState);
}

module.exports = {
    CORE_COOKIE_KEYS,
    filterKeysAppState,
    resolveUserID,
    validateAppState
};
