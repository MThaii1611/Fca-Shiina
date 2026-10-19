api: "api.changeThreadColor";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function changeThreadColor(color, threadID, callback) {
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
        const task = buildTask(LS_LABELS.SET_THREAD_COLOR || "38", {
            thread_key: Number(threadID) || String(threadID),
            theme_color: String(color || ""),
            sync_group: 1
        }, String(threadID));
        sendTask(ctx, task, { noWaitAck: true }).then(() => callback(null, { success: true })).catch(callback);
    };
};
