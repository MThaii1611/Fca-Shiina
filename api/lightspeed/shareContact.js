api: "api.shareContact";

/**
 * api/lightspeed/shareContact.js
 * Shiina Framework - Chia sẻ liên hệ (shareContact) vào nhóm Messenger
 */

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected } = require("../../shiina/lightspeed/ls-tasks");

    return function shareContact(text, senderID, threadID, callback) {
        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof callback !== "function") {
            callback = (err, data) => (err ? rejectFunc(err) : resolveFunc(data));
        }

        if (!senderID || !threadID) {
            const err = new Error("shareContact: senderID và threadID là bắt buộc");
            callback(err);
            return returnPromise;
        }

        if (!isConnected(ctx)) {
            const err = new Error("shareContact: Chưa kết nối Lightspeed");
            callback(err);
            return returnPromise;
        }

        const task = buildTask("359", {
            contact_id: String(senderID),
            sync_group: 1,
            text: text || "",
            thread_id: String(threadID)
        }, "xma_open_contact_share");

        sendTask(ctx, task)
            .then((res) => {
                callback(null, res);
                resolveFunc(res);
            })
            .catch((err) => {
                callback(err);
                rejectFunc(err);
            });

        return returnPromise;
    };
};