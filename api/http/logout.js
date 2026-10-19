api: "api.logout";

module.exports = function(ctx, http, api) {
    return async function logout(callback) {
        if (!callback) callback = () => {};
        try {
            if (typeof api.stopListenMqtt === "function") await api.stopListenMqtt();
            await http.post("https://www.facebook.com/bluebar/modern_settings_menu/?help_type=36", {
                pmid: "0"
            });
            ctx.loggedIn = false;
            callback(null, { success: true });
        } catch (e) {
            callback(e);
        }
    };
};
