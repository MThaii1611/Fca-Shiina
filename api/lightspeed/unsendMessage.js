module.exports = {
    "api": "api.unsendMessage",
    run: function(ctx, http, api) {
        const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
        return function unsendMessage(messageID, callback) {
            if (!callback) {
                return new Promise((resolve, reject) => {
                    unsendMessage(messageID, (err, r) => err ? reject(err) : resolve(r));
                });
            }
            if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));

            const task = buildTask(LS_LABELS.UNSEND_MESSAGE, {
                message_id: String(messageID),
                sync_group: 1
            }, "unsend_message");

            sendTask(ctx, task).then(() => callback(null, { success: true })).catch(callback);
        };
    }
};
