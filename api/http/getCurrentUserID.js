module.exports = {
    "api": "api.getCurrentUserID",
    run: function(ctx, http, api) {
        return function getCurrentUserID() {
            return ctx ? ctx.userID : null;
        };
    }
};
