api: "api.changeGroupImage";

/**
 * api/lightspeed/changeGroupImage.js
 * Shiina Framework - Thay đổi ảnh đại diện nhóm
 */

module.exports = function(ctx, http, api) {
    const { buildTask, sendTask, isConnected } = require("../../shiina/lightspeed/ls-tasks");

    return async function changeGroupImage(image, threadID, callback) {
        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof callback !== "function") {
            callback = (err, data) => (err ? rejectFunc(err) : resolveFunc(data));
        }

        if (!isConnected(ctx)) {
            const err = new Error("changeGroupImage: Chưa kết nối Lightspeed");
            callback(err);
            return returnPromise;
        }

        try {
            let uploaded = [];
            if (typeof api.uploadAttachment === "function") {
                uploaded = await new Promise((res, rej) => {
                    api.uploadAttachment(image, (err, r) => err ? rej(err) : res(r));
                });
            }
            const mediaId = uploaded[0]?.image_id || uploaded[0]?.media_id || uploaded[0]?.fbid;
            if (!mediaId) throw new Error("changeGroupImage: Không upload được ảnh nhóm");

            const task = buildTask("37", {
                thread_id: String(threadID),
                image_id: String(mediaId),
                sync_group: 1
            }, String(threadID));

            const res = await sendTask(ctx, task);
            callback(null, res);
            resolveFunc(res);
        } catch (err) {
            callback(err);
            rejectFunc(err);
        }

        return returnPromise;
    };
};