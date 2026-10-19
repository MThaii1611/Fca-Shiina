api: "api.getUserInfo";

/**
 * api/http/getUserInfo.js
 * Lấy thông tin người dùng Facebook (User Profile).
 * An toàn tuyệt đối, không crash SyntaxError khi Meta trả về rỗng/HTML.
 * Tích hợp đa tầng:
 *   1. Cache bộ nhớ SQLite / Json
 *   2. Comet Profile GraphQL Query
 *   3. Fallback chuẩn đảm bảo luôn có Object { [id]: { name, firstName, vanity, thumbSrc, profileUrl, ... } }
 */

const COMET_DOC_ID = "28575618488710252";

function parseCometGraphQL(resText) {
    if (!resText) return null;
    if (typeof resText === "object") return resText;
    const clean = String(resText).replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");
    const lines = clean.split(/\r?\n/).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
        try {
            const obj = JSON.parse(lines[i]);
            if (obj && obj.data && obj.data.user) {
                return obj;
            }
        } catch (_) {}
    }
    try {
        return JSON.parse(clean);
    } catch (_) {
        return null;
    }
}

function normalizeUser(userID, data) {
    const u = data && data.user && data.user.profile_header_renderer && data.user.profile_header_renderer.user;
    if (!u) {
        return {
            name: "Facebook User",
            firstName: "User",
            vanity: String(userID),
            thumbSrc: `https://graph.facebook.com/${userID}/picture?height=720&width=720&access_token=6628568379|c1e620fa708a1d5696fb991c1bde5662`,
            profileUrl: "https://www.facebook.com/" + userID,
            gender: null,
            type: "User",
            isFriend: false,
            isBirthday: false
        };
    }

    let vanity = null;
    if (u.url) {
        try {
            const parsedUrl = new URL(u.url);
            vanity = parsedUrl.pathname.replace(/^\/|\/$/g, "");
        } catch (_) {
            vanity = u.url.replace(/https?:\/\/(www\.)?facebook\.com\//, "");
        }
    }

    const name = u.name || "Facebook User";
    const parts = name.split(" ");
    const firstName = u.short_name || (parts.length > 0 ? parts[parts.length - 1] : name);
    const thumbSrc = (u.profile_picture_for_sticky_bar && u.profile_picture_for_sticky_bar.uri) ||
        `https://graph.facebook.com/${userID}/picture?height=720&width=720&access_token=6628568379|c1e620fa708a1d5696fb991c1bde5662`;

    return {
        name: name,
        firstName: firstName,
        vanity: vanity || String(userID),
        thumbSrc: thumbSrc,
        profileUrl: u.url || ("https://www.facebook.com/" + userID),
        gender: u.gender || null,
        type: u.__isProfile || "User",
        isFriend: !!u.is_viewer_friend,
        isBirthday: false
    };
}

module.exports = function(ctx, http, api) {
    const { getUser, saveUser } = require("../../shiina/database");

    function getFallbackUsers(ids, originalIsArray) {
        const out = {};
        for (const uId of ids) {
            const cached = getUser(String(uId));
            const cName = cached?.name || (global.Fca?.Data?.Userinfo?.get(String(uId))?.name);
            out[String(uId)] = {
                name: cName || "Facebook User",
                firstName: cName ? cName.split(" ").pop() : "User",
                vanity: String(uId),
                thumbSrc: `https://graph.facebook.com/${uId}/picture?height=720&width=720&access_token=6628568379|c1e620fa708a1d5696fb991c1bde5662`,
                profileUrl: `https://www.facebook.com/${uId}`,
                gender: "unknown",
                type: "User",
                isFriend: false,
                isBirthday: false
            };
        }
        if (!originalIsArray && ids.length === 1) {
            const single = out[ids[0]];
            Object.assign(out, single);
        }
        return out;
    }

    return async function getUserInfo(id, callback) {
        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof callback !== "function") {
            callback = (err, data) => (err ? rejectFunc(err) : resolveFunc(data));
        }

        const originalIsArray = Array.isArray(id);
        const ids = (originalIsArray ? id : [id]).map(String).filter(Boolean);

        if (ids.length === 0) {
            const empty = {};
            callback(null, empty);
            resolveFunc(empty);
            return returnPromise;
        }

        const resultMap = {};
        const pendingIds = [];

        // 1. Kiểm tra cache trước
        for (const uid of ids) {
            const cached = getUser(uid);
            if (cached && cached.name && cached.name !== "Facebook User") {
                resultMap[uid] = {
                    name: cached.name,
                    firstName: cached.name.split(" ").pop(),
                    vanity: uid,
                    thumbSrc: `https://graph.facebook.com/${uid}/picture?height=720&width=720&access_token=6628568379|c1e620fa708a1d5696fb991c1bde5662`,
                    profileUrl: `https://www.facebook.com/${uid}`,
                    gender: "unknown",
                    type: "User",
                    isFriend: false,
                    isBirthday: false
                };
            } else {
                pendingIds.push(uid);
            }
        }

        if (pendingIds.length === 0) {
            const finalRes = { ...resultMap };
            if (!originalIsArray && ids.length === 1) {
                Object.assign(finalRes, resultMap[ids[0]]);
            }
            callback(null, finalRes);
            resolveFunc(finalRes);
            return returnPromise;
        }

        // 2. Fetch qua GraphQL Comet Header
        try {
            await Promise.all(pendingIds.map(async (uId) => {
                try {
                    const form = {
                        av: ctx.globalOptions?.pageID || ctx.userID || "",
                        fb_api_caller_class: "RelayModern",
                        fb_api_req_friendly_name: COMET_FRIENDLY_NAME,
                        fb_dtsg: ctx.fb_dtsg,
                        doc_id: COMET_DOC_ID,
                        variables: JSON.stringify({
                            scale: 3,
                            selectedID: String(uId),
                            selectedSpaceType: "profile",
                            shouldUseFXIMProfilePicEditor: false,
                            userID: String(uId)
                        }),
                        server_timestamps: true
                    };
                    const res = await http.post("https://www.facebook.com/api/graphql/", form);
                    const parsed = parseCometGraphQL(typeof res.data === "string" ? res.data : JSON.stringify(res.data));
                    if (parsed?.data) {
                        const normalized = normalizeUser(uId, parsed.data);
                        resultMap[uId] = normalized;
                        if (normalized.name && normalized.name !== "Facebook User") {
                            saveUser(uId, normalized.name, normalized);
                        }
                    }
                } catch (_) {}
            }));
        } catch (_) {}

        // 3. Fallback cho các ID chưa fetch được thông tin
        for (const uId of ids) {
            if (!resultMap[uId]) {
                const fb = getFallbackUsers([uId], true)[uId];
                resultMap[uId] = fb;
            }
        }

        const finalRes = { ...resultMap };
        if (!originalIsArray && ids.length === 1) {
            Object.assign(finalRes, resultMap[ids[0]]);
        }

        callback(null, finalRes);
        resolveFunc(finalRes);
        return returnPromise;
    };
};
