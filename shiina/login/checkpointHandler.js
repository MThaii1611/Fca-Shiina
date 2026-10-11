'use strict';

const utils = require('../../utils');
const logger = require('../logger');

/**
 * Kiểm tra xem HTML có phải là trang checkpoint 049 không
 * @param {string} html 
 * @returns {boolean}
 */
function isCheckpoint049(html) {
    if (!html || typeof html !== 'string') return false;
    return html.includes('6339492849481770') ||
           html.includes('FBScrapingWarningMutation') ||
           html.includes('/checkpoint/828229238992394/') ||
           (html.includes('checkpoint') && html.includes('trích xuất dữ liệu'));
}

/**
 * Tự động gửi GraphQL mutation để bypass checkpoint 049
 * @param {string} html 
 * @param {object} jar 
 * @param {object} globalOptions 
 * @param {string} userID 
 * @returns {Promise<{html: string, wasCheckpoint: boolean, resolved: boolean}>}
 */
async function bypassCheckpoint049(html, jar, globalOptions, userID) {
    if (!isCheckpoint049(html)) {
        return { html, wasCheckpoint: false, resolved: true };
    }

    logger.Normal("Phát hiện checkpoint 049 (cảnh báo cào dữ liệu). Đang tự động xử lý...");

    try {
        let fb_dtsg = null;
        let jazoest = null;
        let lsd = null;

        const dtsgMatch = html.match(/\["DTSGInitialData",\[\],{"token":"([^"]+)"}/) ||
                          html.match(/\["DTSGInitData",\[\],{"token":"([^"]+)"/) ||
                          html.match(/<input type="hidden" name="fb_dtsg" value="([^"]+)"/);
        if (dtsgMatch) fb_dtsg = dtsgMatch[1].replace(/\\/g, '');

        const jazoestMatch = html.match(/name="jazoest" value="([^"]+)"/) || html.match(/jazoest=([0-9]+)/);
        if (jazoestMatch) jazoest = jazoestMatch[1];

        const lsdMatch = html.match(/\["LSD",\[\],{"token":"([^"]+)"}/) || html.match(/name="lsd" value="([^"]+)"/);
        if (lsdMatch) lsd = lsdMatch[1];

        if (!fb_dtsg) {
            logger.Warning("Không trích xuất được fb_dtsg từ trang checkpoint 049. Tiếp tục thử nạp...");
            return { html, wasCheckpoint: true, resolved: false };
        }

        const form = {
            av: userID,
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: "FBScrapingWarningMutation",
            doc_id: "6339492849481770",
            variables: JSON.stringify({}),
            server_timestamps: true,
            fb_dtsg,
            jazoest: jazoest || undefined,
            lsd: lsd || undefined
        };

        await utils.post("https://www.facebook.com/api/graphql/", jar, form, globalOptions).then(utils.saveCookies(jar));

        const refreshed = await utils.get("https://www.facebook.com/", jar, null, globalOptions, { noRef: true })
            .then(utils.saveCookies(jar));

        if (isCheckpoint049(refreshed.body)) {
            logger.Warning("Đã thử gỡ checkpoint 049 nhưng vẫn còn tồn tại. Bot sẽ tiếp tục chạy, có thể cần xác minh thủ công trên trình duyệt.");
            return { html: refreshed.body, wasCheckpoint: true, resolved: false };
        }

        logger.Normal("Gỡ checkpoint 049 thành công, tiếp tục đăng nhập bình thường (không cần restart).");
        return { html: refreshed.body, wasCheckpoint: true, resolved: true };
    } catch (e) {
        logger.Warning("Lỗi khi xử lý checkpoint 049: " + (e.message || e));
        return { html, wasCheckpoint: true, resolved: false };
    }
}

/**
 * Xử lý chuyển hướng thẻ meta refresh
 * @param {object} res 
 * @param {object} jar 
 * @param {object} globalOptions 
 * @returns {Promise<object>}
 */
function handleRedirect(res, jar, globalOptions) {
    if (!res || !res.body) return res;
    var reg = /<meta http-equiv="refresh" content="0;url=([^"]+)[^>]+>/;
    var redirect = reg.exec(res.body);
    if (redirect && redirect[1]) {
        return utils.get(redirect[1], jar, null, globalOptions).then(utils.saveCookies(jar));
    }
    return res;
}

module.exports = {
    isCheckpoint049,
    bypassCheckpoint049,
    handleRedirect
};
