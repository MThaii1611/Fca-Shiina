module.exports = {
    "api": "api.httpPostFormData",
    run: function(ctx, http, api) {
        return function httpPostFormData(url, form, customHeaders) {
            return http.post(url, form, customHeaders);
        };
    }
};
