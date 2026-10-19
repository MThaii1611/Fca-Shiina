module.exports = {
    "api": "api.editMessage",
    run: function(ctx, http, api) {
        const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");

        return function editMessage(newText, messageID, callback) {
            if (!callback) {
                return new Promise((resolve, reject) => {
                    editMessage(newText, messageID, (err, r) => err ? reject(err) : resolve(r));
                });
            }

            if (!messageID || newText == null) {
                return callback(new Error("Thiếu text hoặc messageID"));
            }

            if (!isConnected(ctx)) {
                return callback(new Error("Chưa kết nối Lightspeed/MQTT"));
            }

            const task = buildTask(LS_LABELS?.EDIT_MESSAGE || "742", {
                message_id: String(messageID),
                text: String(newText || "")
            }, "edit_message");

            sendTask(ctx, task)
                .then(() => callback(null, { success: true, body: String(newText || ""), messageID: String(messageID) }))
                .catch(callback);
        };
    }
};
