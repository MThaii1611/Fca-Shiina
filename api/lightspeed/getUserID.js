api: "api.getUserID";

/**
 * api/lightspeed/getUserID.js
 * Shiina Framework - Lấy UID người dùng từ link Facebook hoặc vanity name
 */

module.exports = function(ctx, http, api) {
    return async function getUserID(linkOrVanity, callback) {
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
            let target = String(linkOrVanity || "").trim();
            if (/^\d+$/.test(target)) {
                const res = [ { id: target, name: "Facebook User" } ];
                callback(null, res);
                resolveFunc(res);
                return returnPromise;
            }

            const cleanUrl = target.startsWith("http") ? target : `https://www.facebook.com/${target}`;
            const res = await http.get(cleanUrl);
            const html = typeof res.data === "string" ? res.data : "";

            const match = html.match(/"userID":"(\d+)"/) || html.match(/"entity_id":"(\d+)"/) || html.match(/"id":"(\d+)"/);
            const uid = match ? match[1] : null;

            if (uid) {
                const nameMatch = html.match(/<title>([^<]+)<\/title>/i);
                const name = nameMatch ? nameMatch[1].replace(/\s*\|\s*Facebook/i, "").trim() : "Facebook User";
                const result = [ { id: uid, name: name } ];
                callback(null, result);
                resolveFunc(result);
            } else {
                throw new Error("getUserID: Không tìm thấy ID cho " + target);
            }
        } catch (err) {
            callback(err);
            rejectFunc(err);
        }

        return returnPromise;
    };
};
