api: "api.createNewGroup";

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected, LS_LABELS } = require("../../shiina/lightspeed/ls-tasks");
    return function createNewGroup(participantIDs, groupTitle, callback) {
        if (typeof groupTitle === "function") { callback = groupTitle; groupTitle = ""; }
        if (!callback) callback = () => {};
        if (!isConnected(ctx)) return callback(new Error("Chưa kết nối Lightspeed"));
        const ids = Array.isArray(participantIDs) ? participantIDs : [participantIDs];
        const task = buildTask(LS_LABELS.CREATE_GROUP || "130", {
            participant_ids: ids.map(String),
            thread_name: String(groupTitle || ""),
            sync_group: 1
        }, "create_group");
        sendTask(ctx, task).then((res) => callback(null, res)).catch(callback);
    };
};
