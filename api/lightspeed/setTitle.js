api: "api.setTitle";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    function genOTID() {
        return ((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 0x3fffff))).toString();
    }
    return function setTitle(newTitle, threadID, callback) {
        if (!callback) {
            return new Promise((resolve, reject) => {
                setTitle(newTitle, threadID, (err, r) => err ? reject(err) : resolve(r));
            });
        }
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));

        const task = buildTask(LS_LABELS.SET_THREAD_NAME, {
            thread_key:           Number(threadID) || String(threadID),
            thread_id:            String(threadID),
            thread_name:          String(newTitle || ""),
            sync_group:           1,
            offline_threading_id: genOTID()
        }, "thread_name");

        sendTask(ctx, task, { noWaitAck: true })
            .then(() => callback(null, { success: true }))
            .catch(callback);
    };
};
