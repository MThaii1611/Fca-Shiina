api: "api.pinMessage";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function pinMessage(messageID, threadID, callback) {
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
        const task = buildTask(LS_LABELS.PIN_MESSAGE || "605", {
            message_id: String(messageID),
            thread_id: String(threadID),
            sync_group: 1
        }, String(threadID));
        sendTask(ctx, task, { noWaitAck: true }).then(() => callback(null, { success: true })).catch(callback);
    };
};
