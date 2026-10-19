module.exports = {
    "api": "api.getAppState",
    run: function(ctx, http, api) {
        const { jarToArray } = require("../../shiina/login/jar-builder");
        return function getAppState() {
            return jarToArray(ctx.jar);
        };
    }
};
