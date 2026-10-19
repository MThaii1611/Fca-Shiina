api: "api.changeBio";

module.exports = function(ctx, http, api) {
    return async function changeBio(bio, publish, callback) {
        if (typeof publish === "function") { callback = publish; publish = false; }
        if (!callback) callback = () => {};
        try {
            const form = {
                fb_api_caller_class: "RelayModern",
                fb_api_req_friendly_name: "ProfileCometSetBioMutation",
                variables: JSON.stringify({
                    input: { bio: String(bio || ""), publish_bio_feed_story: !!publish, actor_id: ctx.userID }
                }),
                doc_id: "2725043627607610"
            };
            const res = await http.graphql(form, ctx);
            callback(null, { success: true });
        } catch (e) {
            callback(e);
        }
    };
};
