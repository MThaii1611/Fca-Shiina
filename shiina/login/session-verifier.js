"use strict";
/**
 * login/session-verifier.js
 * Shiina Framework - Session Verifier
 * Luồng: facebook.com -> fallback m.facebook.com -> fallback messages/t/
 * Xử lý checkpoint 049 và kiểm tra USER_ID !== "0"
 */

const logger = require("../logger");
const { extractAllTokens, extractFbDtsg } = require("./token-extractor");

async function verifySession(http, options = {}) {
    let finalHtml = "";
    let finalTokens = {};
    let isAlive = false;

    // 1. Gửi request đến facebook.com trước
    const targetUrls = [
        "https://www.facebook.com/",
        "https://m.facebook.com/",
        "https://www.facebook.com/messages/t/"
    ];

    for (const url of targetUrls) {
        try {
            const res = await http.get(url);
            const html = typeof res.data === "string" ? res.data : JSON.stringify(res.data || "");
            const tokens = extractAllTokens(html);

            const isLoginRedirect = res && res.headers && res.headers.location && (res.headers.location.includes("/login") || res.headers.location.includes("checkpoint"));
            const isLoginForm = html.includes('id="login_form"') || html.includes('name="login_form"') || (html.includes("/login.php") && !html.includes("DTSGInitialData"));
            
            const userMatch = html.match(/\["CurrentUserInitialData",\[\],\{.*?"USER_ID":"(\d+)"/) ||
                              html.match(/"USER_ID":"(\d+)"/) ||
                              html.match(/"ACCOUNT_ID":"(\d+)"/);
            const isZeroUser = userMatch && userMatch[1] === "0";

            if (!finalHtml) {
                finalHtml = html;
                finalTokens = tokens;
            }

            if (tokens.fb_dtsg && !isZeroUser && !isLoginForm && !isLoginRedirect) {
                finalHtml = html;
                finalTokens = tokens;
                isAlive = true;
                break;
            }

            // Nếu tìm thấy fb_dtsg từ nguồn dự phòng, cập nhật vào tokens
            if (tokens.fb_dtsg && !finalTokens.fb_dtsg) {
                finalTokens.fb_dtsg = tokens.fb_dtsg;
                finalTokens.jazoest = tokens.jazoest || finalTokens.jazoest;
                finalTokens.lsd = tokens.lsd || finalTokens.lsd;
                if (!isZeroUser && !isLoginForm) isAlive = true;
            }
        } catch (e) {
            logger.Warn(`Lỗi xác minh tại ${url}: ${e.message || e}`);
        }
    }

    return { alive: isAlive, html: finalHtml, tokens: finalTokens };
}

module.exports = { verifySession };
