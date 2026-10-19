module.exports = {
    "api": "api.muteThread",
    run: function(ctx, http, api) {
        const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
        return function muteThread(threadID, muteSeconds, callback) {
            if (typeof muteSeconds === "function") { callback = muteSeconds; muteSeconds = -1; }
            if (!callback) callback = () => {};
            if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
            const task = buildTask(LS_LABELS.MUTE_THREAD, {
                thread_key:   Number(threadID) || String(threadID),
                mute_expire_time_ms: muteSeconds === -1 ? -1 : Date.now() + (muteSeconds * 1000),
                sync_group:   1
            }, String(threadID));
            sendTask(ctx, task, { noWaitAck: true }).then(() => callback(null, { success: true })).catch(callback);
        };
    }
};
