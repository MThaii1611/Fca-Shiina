api: "api.setProfileLock";

module.exports = function(ctx, http, api) {
    return async function setProfileLock(status, callback) {
        if (!callback) callback = () => {};
        try {
            const form = {
                fb_api_caller_class: "RelayModern",
                fb_api_req_friendly_name: "ProfileCometSetLockStatusMutation",
                variables: JSON.stringify({
                    input: { is_profile_locked: !!status, actor_id: ctx.userID }
                }),
                doc_id: "4843924292318041"
            };
            await http.graphql(form, ctx);
            callback(null, { success: true });
        } catch (e) {
            callback(e);
        }
    };
};
