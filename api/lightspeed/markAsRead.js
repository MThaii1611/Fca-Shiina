module.exports = {
    "api": "api.markAsRead",
    run: function(ctx, http, api) {
        const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
        return function markAsRead(threadID, read, callback) {
            if (typeof read === "function") { callback = read; read = true; }
            if (read === undefined) read = true;
            if (!callback) callback = () => {};
            if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));

            const task = buildTask(LS_LABELS.MARK_READ, {
                thread_id:              Number(threadID) || String(threadID),
                last_read_watermark_ts: Date.now(),
                sync_group:             95,
                offline_threading_id:   null
            }, String(threadID));

            sendTask(ctx, task).then(() => callback(null, { success: true })).catch(callback);
        };
    }
};
