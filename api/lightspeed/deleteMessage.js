api: "api.deleteMessage";

module.exports = function(ctx, http, api) {
    return function deleteMessage(messageID, callback) {
        return api.unsendMessage(messageID, callback);
    };
};
