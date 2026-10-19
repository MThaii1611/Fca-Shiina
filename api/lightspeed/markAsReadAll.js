api: "api.markAsReadAll";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function markAsReadAll(callback) {
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
        const task = buildTask(LS_LABELS.MARK_READ, {
            thread_id: 0,
            last_read_watermark_ts: Date.now(),
            sync_group: 95
        }, "mark_all_read");
        sendTask(ctx, task).then(() => callback(null, { success: true })).catch(callback);
    };
};
