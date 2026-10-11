'use strict';

const utils = require('../../utils');
const { handleRedirect, bypassCheckpoint049 } = require('./checkpointHandler');
const { resolveUserID } = require('./checkAppState');

/**
 * Gửi request ban đầu và xử lý luồng kết nối cho phiên đăng nhập
 * @param {object} jar 
 * @param {object} globalOptions 
 * @param {Array} appState 
 * @returns {Promise<{html: string, userID: string}>}
 */
async function connectSession(jar, globalOptions, appState) {
    let res = await utils.get('https://www.facebook.com/', jar, null, globalOptions, { noRef: true })
        .then(utils.saveCookies(jar));

    // Xử lý chuyển hướng nếu có
    res = await handleRedirect(res, jar, globalOptions);
    res = await handleRedirect(res, jar, globalOptions);

    // Xác định User ID
    const userID = resolveUserID(jar, res.body, appState);

    // Xử lý checkpoint 049 nếu Meta trả về trang cảnh báo cào dữ liệu
    const cpResult = await bypassCheckpoint049(res.body, jar, globalOptions, userID);
    const html = cpResult.html;

    return {
        html,
        userID
    };
}

module.exports = {
    connectSession
};
