api: "api.sendTypingIndicator";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function sendTypingIndicator(threadID, callback) {
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));

        const task = buildTask(LS_LABELS.SEND_TYPING, {
            thread_key: Number(threadID) || String(threadID),
            is_group_thread: threadID && String(threadID).length > 15 ? 1 : 0,
            is_typing: 1,
            attribution: 0
        }, String(threadID));

        sendTask(ctx, task, { noWaitAck: true }).then(() => callback(null)).catch(callback);

        return function stopTyping() {
            if (!isConnected(ctx)) return;
            const stopTask = buildTask(LS_LABELS.SEND_TYPING, {
                thread_key: Number(threadID) || String(threadID),
                is_group_thread: threadID && String(threadID).length > 15 ? 1 : 0,
                is_typing: 0,
                attribution: 0
            }, String(threadID));
            sendTask(ctx, stopTask, { noWaitAck: true }).catch(() => {});
        };
    };
};
