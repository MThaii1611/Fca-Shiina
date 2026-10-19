api: "api.changeNickname";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    function genOTID() {
        return ((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 0x3fffff))).toString();
    }
    return function changeNickname(nickname, threadID, participantID, callback) {
        if (!callback) {
            return new Promise((resolve, reject) => {
                changeNickname(nickname, threadID, participantID, (err, r) => err ? reject(err) : resolve(r));
            });
        }
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));

        const task = buildTask(LS_LABELS.SET_NICKNAME, {
            thread_key:           Number(threadID) || String(threadID),
            thread_id:            String(threadID),
            contact_id:           Number(participantID) || String(participantID),
            participant_id:       Number(participantID) || String(participantID),
            nickname:             String(nickname || ""),
            custom_nickname:      String(nickname || ""),
            sync_group:           1,
            offline_threading_id: genOTID()
        }, "thread_participant_nickname");

        sendTask(ctx, task, { noWaitAck: true })
            .then(() => callback(null, { success: true }))
            .catch(callback);
    };
};
