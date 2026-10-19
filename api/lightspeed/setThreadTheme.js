api: "api.setThreadTheme";

module.exports = function(ctx, http, api) {
    return function setThreadTheme(themeID, threadID, callback) {
        return api.changeThreadColor(themeID, threadID, callback);
    };
};
