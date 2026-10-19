api: "api.setMessageReactionMqtt";

module.exports = function(ctx, http, api) {
    return function setMessageReactionMqtt(reaction, messageID, threadID, callback) {
        return api.setMessageReaction(reaction, messageID, threadID, callback);
    };
};
