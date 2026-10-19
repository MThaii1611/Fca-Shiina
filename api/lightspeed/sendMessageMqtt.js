api: "api.sendMessageMqtt";

module.exports = function(ctx, http, api) {
    return function sendMessageMqtt(msg, threadID, replyToID, callback) {
        return api.sendMessage(msg, threadID, replyToID, callback);
    };
};
