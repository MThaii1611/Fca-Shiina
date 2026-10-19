api: "api.markAsDelivered";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function markAsDelivered(threadID, messageID, callback) {
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
        const task = buildTask(LS_LABELS.MARK_DELIVERED || "26", {
            thread_id: String(threadID),
            message_id: String(messageID),
            watermark_timestamp: Date.now()
        }, String(threadID));
        sendTask(ctx, task, { noWaitAck: true }).then(() => callback(null, { success: true })).catch(callback);
    };
};
