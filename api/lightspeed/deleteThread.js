api: "api.deleteThread";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function deleteThread(threadID, callback) {
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
        const task = buildTask(LS_LABELS.DELETE_THREAD || "146", {
            thread_id: String(threadID),
            sync_group: 1
        }, String(threadID));
        sendTask(ctx, task).then(() => callback(null, { success: true })).catch(callback);
    };
};
