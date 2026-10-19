api: "api.setMessageReaction";

/**
 * api/lightspeed/setMessageReaction.js
 * Thả reaction (icon cảm xúc) vào tin nhắn:
 * - Hỗ trợ cả Lightspeed Task 29 và GraphQL fallback
 * - Hỗ trợ đủ mọi cú pháp gọi:
 *   api.setMessageReaction(reaction, messageID, callback)
 *   api.setMessageReaction(reaction, messageID, callback, forceCustom, threadID)
 *   api.setMessageReaction(reaction, messageID, threadID, callback)
 * - Tự động parse từ khoá (like, love, haha, wow, sad, angry...) thành emoji
 */

function isEmoji(str) {
    if (!str) return false;
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    return emojiRegex.test(str);
}

function parseReaction(reaction) {
    if (!reaction || isEmoji(reaction)) return reaction || "";
    const map = {
        "like": "👍",
        ":like:": "👍",
        "love": "❤️",
        "heart": "❤️",
        ":love:": "❤️",
        "haha": "😆",
        ":haha:": "😆",
        "wow": "😮",
        ":wow:": "😮",
        "sad": "😢",
        ":sad:": "😢",
        "angry": "😠",
        ":angry:": "😠",
        "none": "",
        "clear": "",
        "remove": ""
    };
    return map[String(reaction).toLowerCase()] || reaction;
}

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected } = require("../../shiina/lightspeed/ls-tasks");

    return function setMessageReaction(reaction, messageID, callback, forceCustom = false, threadID = null) {
        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        // Xử lý biến đổi tham số
        if (typeof forceCustom === "string" || typeof forceCustom === "number") {
            threadID = forceCustom;
            forceCustom = false;
        }
        if (typeof callback === "string" || typeof callback === "number") {
            const tmp = callback;
            callback = typeof forceCustom === "function" ? forceCustom : null;
            threadID = tmp;
            forceCustom = false;
        }
        if (typeof threadID === "function" && !callback) {
            callback = threadID;
            threadID = null;
        }

        if (!callback) {
            callback = (err, data) => (err ? rejectFunc(err) : resolveFunc(data));
        }

        if (!messageID) {
            const err = new Error("setMessageReaction: messageID là bắt buộc");
            callback(err);
            return returnPromise;
        }

        const mid = String(messageID);
        const resolvedEmoji = parseReaction(reaction);
        const targetThread = threadID ? (Number(threadID) || String(threadID)) : 0;

        function doGraphQL() {
            if (!ctx.fb_dtsg) {
                const err = new Error("setMessageReaction: Không thể gửi GraphQL do thiếu fb_dtsg");
                callback(err);
                return;
            }
            if (!ctx.clientMutationId) ctx.clientMutationId = 0;
            const variables = {
                data: {
                    client_mutation_id: String(++ctx.clientMutationId),
                    actor_id: String(ctx.userID || ""),
                    action: resolvedEmoji === "" ? "REMOVE_REACTION" : "ADD_REACTION",
                    message_id: mid,
                    reaction: resolvedEmoji || ""
                }
            };
            const form = {
                fb_dtsg: ctx.fb_dtsg,
                doc_id: "1491398900900362",
                variables: JSON.stringify(variables)
            };
            http.post("https://www.facebook.com/api/graphql/", form)
                .then((res) => {
                    const data = typeof res.data === "object" ? res.data : JSON.parse(String(res.data || "").replace(/^[^{[]*/, ""));
                    if (data?.error) throw data.error;
                    callback(null, { success: true });
                    resolveFunc({ success: true });
                })
                .catch((err) => {
                    callback(err);
                    rejectFunc(err);
                });
        }

        // 1. Thử Lightspeed Task 29 chuẩn
        if (isConnected(ctx)) {
            const task = buildTask("29", {
                thread_key: targetThread,
                timestamp_ms: Date.now(),
                message_id: mid,
                reaction: resolvedEmoji,
                actor_id: Number(ctx.userID) || ctx.userID,
                reaction_style: null,
                sync_group: 1,
                send_attribution: 65537
            }, JSON.stringify(["reaction", mid]));

            sendTask(ctx, task, { noWaitAck: true })
                .then(() => {
                    callback(null, { success: true });
                    resolveFunc({ success: true });
                })
                .catch(() => {
                    doGraphQL();
                });
        } else {
            doGraphQL();
        }

        return returnPromise;
    };
};
