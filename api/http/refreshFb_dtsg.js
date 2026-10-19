api: "api.refreshFb_dtsg";

module.exports = function(ctx, http, api) {
    return function refreshFb_dtsg(callback) {
        return api.refreshDTSG ? api.refreshDTSG() : Promise.resolve(ctx.fb_dtsg);
    };
};
