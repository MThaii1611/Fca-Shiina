"use strict";
/**
 * login/checkpoint.js
 * Xử lý checkpoint tự động (checkpoint 049 scraping warning)
 * Chuẩn GraphQL mutation theo fca-shiina-lightspeed
 */

const logger = require("../logger");

function isCheckpoint049(html) {
    if (!html || typeof html !== "string") return false;
    return html.includes("6339492849481770") ||
           html.includes("FBScrapingWarningMutation") ||
           html.includes("601051028565049") ||
           html.includes("XCheckpointFBScrapingWarningController") ||
           html.includes("/checkpoint/828229238992394/") ||
           (html.includes("checkpoint") && html.includes("trích xuất dữ liệu"));
}

async function bypass049(html, http, tokens, userID) {
    if (!isCheckpoint049(html)) {
        return { resolved: true, html };
    }

    const { fb_dtsg, jazoest, lsd } = tokens;

    if (!fb_dtsg) {
        logger.Warn("Checkpoint 049: Không tìm thấy fb_dtsg để bypass tự động.");
        return { resolved: false, html };
    }

    logger.Normal("Phát hiện checkpoint 049 (cảnh báo cào dữ liệu). Đang tự động xử lý...");

    try {
        await http.graphql({
            av: userID,
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: "FBScrapingWarningMutation",
            doc_id: "6339492849481770",
            variables: JSON.stringify({}),
            server_timestamps: true,
            fb_dtsg,
            jazoest: jazoest || undefined,
            lsd: lsd || undefined
        });

        const refreshRes = await http.get("https://www.facebook.com/", { "Cache-Control": "no-cache" });
        const newHtml = typeof refreshRes.data === "string" ? refreshRes.data : "";

        if (isCheckpoint049(newHtml)) {
            logger.Warn("Đã thử gỡ checkpoint 049 nhưng vẫn còn tồn tại. Bot tiếp tục chạy.");
            return { resolved: false, html: newHtml };
        }

        logger.Success("Gỡ checkpoint 049 thành công, tiếp tục đăng nhập bình thường!");
        return { resolved: true, html: newHtml };
    } catch (e) {
        logger.Warn("Lỗi khi xử lý checkpoint 049: " + (e.message || e));
        return { resolved: false, html };
    }
}

async function handleCheckpoint(checkpointType, html, http, tokens, userID) {
    if (isCheckpoint049(html) || checkpointType === "049") {
        return bypass049(html, http, tokens, userID);
    }

    switch (checkpointType) {
        case "282":
            logger.Warn("Checkpoint 282 phát hiện - Cần xác minh ảnh khuôn mặt trên trình duyệt");
            return { resolved: false, html };
        case "956":
            logger.Warn("Checkpoint 956 phát hiện - Cần xác minh tài khoản trên trình duyệt");
            return { resolved: false, html };
        case "login_blocked":
            logger.Error("Tài khoản bị chặn đăng nhập (1357001) - Kiểm tra tài khoản");
            return { resolved: false, html };
        case "generic":
            logger.Warn("Checkpoint phát hiện - Kiểm tra tài khoản trên trình duyệt");
            return { resolved: false, html };
        default:
            return { resolved: true, html };
    }
}

module.exports = { isCheckpoint049, bypass049, handleCheckpoint };
