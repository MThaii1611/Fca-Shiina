api: "api.sendMqttMessage";

/**
 * api/lightspeed/sendMqttMessage.js
 * Upload và gửi tin nhắn đính kèm (ảnh/video/audio/file) qua Lightspeed MQTT Task 46
 */

module.exports = function(ctx, http, api) {
    return async function sendMqttMessage(msg, threadID, replyToID, callback) {
        if (typeof replyToID === "function") {
            callback = replyToID;
            replyToID = null;
        }

        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof callback !== "function") {
            callback = (err, data) => (err ? rejectFunc(err) : resolveFunc(data));
        }

        try {
            const rawMsg = typeof msg === "string" ? { body: msg } : (Array.isArray(msg) ? { attachment: msg } : { ...msg });
            let uploaded = [];

            if (rawMsg.attachment && typeof api.uploadAttachment === "function") {
                uploaded = await new Promise((res, rej) => {
                    api.uploadAttachment(rawMsg.attachment, (err, r) => err ? rej(err) : res(r));
                });
            }

            const sendPayload = {
                ...rawMsg,
                attachment: undefined, // Xoá trường attachment để tránh đệ quy gọi lại sendMqttMessage
                attachmentInfo: uploaded
            };

            return api.sendMessage(sendPayload, threadID, callback, replyToID);
        } catch (e) {
            callback(e);
            rejectFunc(e);
            return returnPromise;
        }
    };
};
