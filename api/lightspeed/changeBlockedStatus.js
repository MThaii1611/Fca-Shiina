api: "api.changeBlockedStatus";

/**
 * api/lightspeed/changeBlockedStatus.js
 * Shiina Framework - Chặn hoặc bỏ chặn người dùng trên Messenger
 */

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected } = require("../../shiina/lightspeed/ls-tasks");

    return function changeBlockedStatus(userID, block, callback) {
        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof callback !== "function") {
            callback = (err, data) => (err ? rejectFunc(err) : resolveFunc(data));
        }

        if (!isConnected(ctx)) {
            const err = new Error("changeBlockedStatus: Chưa kết nối Lightspeed");
            callback(err);
            return returnPromise;
        }

        const task = buildTask("31", {
            contact_id: String(userID),
            is_blocked: Boolean(block),
            sync_group: 1
        }, String(userID));

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
