api: "api.markAsSeen";

module.exports = function(ctx, http, api) {
    return function markAsSeen(seen_timestamp, callback) {
        if (typeof seen_timestamp === "function") { callback = seen_timestamp; seen_timestamp = Date.now(); }
        if (!callback) callback = () => {};
        if (typeof api.markAsReadAll === "function") return api.markAsReadAll(callback);
        callback(null, { success: true });
    };
};
