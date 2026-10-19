api: "api.createPoll";

module.exports = function(ctx, http, api) {
    return async function createPoll(title, threadID, options, callback) {
        if (!callback) callback = () => {};
        try {
            const form = {
                target_id: String(threadID),
                question_text: String(title || ""),
                option_text_array: Object.keys(options || {}),
                options_num_count: Object.keys(options || {}).length
            };
            const res = await http.post("https://www.facebook.com/messaging/polls/create/", form);
            callback(null, { success: true });
        } catch (e) {
            callback(e);
        }
    };
};
