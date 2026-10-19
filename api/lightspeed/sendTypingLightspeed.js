api: "api.sendTypingLightspeed";

module.exports = function(ctx, http, api) {
    return function sendTypingLightspeed(threadID, callback) {
        return api.sendTypingIndicator(threadID, callback);
    };
};
