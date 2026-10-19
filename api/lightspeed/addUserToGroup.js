api: "api.addUserToGroup";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function addUserToGroup(userID, threadID, callback) {
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
        const ids = Array.isArray(userID) ? userID : [userID];
        const task = buildTask(LS_LABELS.ADD_MEMBER, {
            thread_fbid:    String(threadID),
            contact_ids:    ids.map(String),
            sync_group:     1
        }, String(threadID));
        sendTask(ctx, task).then(() => callback(null, { success: true })).catch(callback);
    };
};
