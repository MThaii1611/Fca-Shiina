api: "api.changeArchivedStatus";

/**
 * api/lightspeed/changeArchivedStatus.js
 * Shiina Framework - Lưu trữ hoặc bỏ lưu trữ cuộc trò chuyện
 */

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected } = require("../../shiina/lightspeed/ls-tasks");

    return function changeArchivedStatus(threadID, archive, callback) {
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
            const err = new Error("changeArchivedStatus: Chưa kết nối Lightspeed");
            callback(err);
            return returnPromise;
        }

        const task = buildTask("34", {
            thread_id: String(threadID),
            is_archived: Boolean(archive),
            sync_group: 1
        }, String(threadID));

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
