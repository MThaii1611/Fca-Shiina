api: "api.getAvatarUser";

/**
 * api/http/getAvatarUser.js
 * Lấy avatar người dùng Facebook theo kích thước:
 * - Hỗ trợ cả single ID (chuỗi) hoặc mảng IDs
 * - Tự động fallback GraphQL/getUserInfo nếu Graph API token bị giới hạn
 * - Trả về object { [userID]: url } và nếu là single ID thì gán kèm url trực tiếp
 */

const axios = require("axios");
const DEFAULT_FB_TOKEN = "6628568379|c1e620fa708a1d5696fb991c1bde5662";

module.exports = function(ctx, http, api) {
    async function fetchSingleAvatar(uId, height, width) {
        const token = ctx.access_token || DEFAULT_FB_TOKEN;
        const graphUrl = `https://graph.facebook.com/${uId}/picture?height=${height}&width=${width}&redirect=false&access_token=${token}`;
        try {
            const res = await axios.get(graphUrl, {
                headers: {
                    "User-Agent": ctx.options?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "application/json,text/plain,*/*"
                },
                timeout: 10000
            });
            if (res.data) {
                if (typeof res.data === "string" && res.data.startsWith("http")) return res.data;
                if (res.data.data && res.data.data.url) return res.data.data.url;
            }
        } catch (_) {}

        // Fallback 1: Thử lấy qua getUserInfo
        try {
            if (typeof api.getUserInfo === "function") {
                const info = await api.getUserInfo(uId);
                const userObj = info[uId] || info;
                if (userObj && userObj.thumbSrc && !userObj.thumbSrc.includes("graph.facebook.com")) {
                    return userObj.thumbSrc;
                }
            }
        } catch (_) {}

        // Fallback 2: URL trực tiếp
        return `https://graph.facebook.com/${uId}/picture?height=${height}&width=${width}&access_token=${token}`;
    }

    return function getAvatarUser(userIDs, size = [720, 720], callback) {
        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof size === "function") {
            callback = size;
            size = [720, 720];
        }
        if (!callback) {
            callback = (err, data) => (err ? rejectFunc(err) : resolveFunc(data));
        }

        if (typeof size === "string" || typeof size === "number") {
            size = [Number(size) || 720, Number(size) || 720];
        } else if (Array.isArray(size) && size.length === 1) {
            size = [size[0], size[0]];
        }
        const [height, width] = size;

        const isSingle = !Array.isArray(userIDs);
        const ids = isSingle ? [userIDs] : userIDs;

        Promise.all(ids.map(async (uId) => {
            const idStr = String(uId);
            const url = await fetchSingleAvatar(idStr, height, width);
            return { id: idStr, url };
        }))
        .then((results) => {
            const out = {};
            results.forEach((r) => { out[r.id] = r.url; });
            if (isSingle) {
                const singleUrl = results[0]?.url || "";
                out.url = singleUrl;
            }
            callback(null, out);
            resolveFunc(out);
        })
        .catch((err) => {
            callback(err);
            rejectFunc(err);
        });

        return returnPromise;
    };
};
