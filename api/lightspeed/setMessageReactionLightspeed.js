api: "api.setMessageReactionLightspeed";

module.exports = function(ctx, http, api) {
    return function setMessageReactionLightspeed(reaction, messageID, threadID, callback) {
        return api.setMessageReaction(reaction, messageID, threadID, callback);
    };
};
