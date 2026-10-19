module.exports = {
    "api": "api.httpGet",
    run: function(ctx, http, api) {
        return function httpGet(url, customHeaders) {
            return http.get(url, customHeaders);
        };
    }
};
