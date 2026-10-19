api: "api.changeThreadEmoji";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function changeThreadEmoji(emoji, threadID, callback) {
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
        const task = buildTask(LS_LABELS.SET_EMOJI || "39", {
            thread_key: Number(threadID) || String(threadID),
            custom_emoji: String(emoji || ""),
            sync_group: 1
        }, String(threadID));
        sendTask(ctx, task, { noWaitAck: true }).then(() => callback(null, { success: true })).catch(callback);
    };
};
