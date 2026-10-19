api: "api.removeUserFromGroup";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function removeUserFromGroup(userID, threadID, callback) {
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
        const task = buildTask(LS_LABELS.REMOVE_MEMBER, {
            thread_fbid:    String(threadID),
            contact_id:     String(userID),
            sync_group:     1
        }, String(threadID));
        sendTask(ctx, task).then(() => callback(null, { success: true })).catch(callback);
    };
};
