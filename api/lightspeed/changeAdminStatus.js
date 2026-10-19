api: "api.changeAdminStatus";

/**
 * api/lightspeed/changeAdminStatus.js
 * Shiina Framework - Thay đổi quyền quản trị viên nhóm
 */

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected } = require("../../shiina/lightspeed/ls-tasks");

    return function changeAdminStatus(threadID, adminIDs, adminStatus, callback) {
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
            const err = new Error("changeAdminStatus: Chưa kết nối Lightspeed");
            callback(err);
            return returnPromise;
        }

        const ids = Array.isArray(adminIDs) ? adminIDs : [adminIDs];
        const task = buildTask("25", {
            thread_id: String(threadID),
            contact_ids: ids.map(String),
            is_admin: Boolean(adminStatus),
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