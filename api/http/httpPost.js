module.exports = {
    "api": "api.httpPost",
    run: function(ctx, http, api) {
        return function httpPost(url, form, customHeaders) {
            return http.post(url, form, customHeaders);
        };
    }
};
