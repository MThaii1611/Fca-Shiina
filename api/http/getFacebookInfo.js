api: "api.getFacebookInfo";

module.exports = function(ctx, http, api) {
    return function getFacebookInfo(id, callback) {
        return api.getUserInfo(id, callback);
    };
};
