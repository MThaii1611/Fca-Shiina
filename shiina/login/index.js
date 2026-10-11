'use strict';

const utils = require('../../utils');
const logger = require('../logger');
const Database = require('../Extra/database');

const { validateAppState } = require('./checkAppState');
const { normalizeCookieInput, populateJar } = require('./checkCookie');
const { connectSession } = require('./connectSession');
const { setOptions, buildAPI } = require('./buildApi');

function backup(data, globalOptions, callback, prCallback) {
    try {
        let appstate = data;
        if (typeof data === 'string') {
            try {
                appstate = JSON.parse(data);
            } catch (_) {}
        }
        logger.Warning(global.Fca.Require.Language?.Index?.BackupNoti || "Đang thay AppState từ bản sao lưu...");
        loginHelper(appstate, globalOptions, callback, prCallback);
    } catch (e) {
        logger.Error(global.Fca.Require.Language?.Index?.ErrBackup || "Lỗi sao lưu AppState!");
        process.exit(0);
    }
}

/**
 * Điều phối toàn bộ quy trình login
 */
async function loginHelper(appState, globalOptions, callback, prCallback) {
    const jar = utils.getJar();

    try {
        let normalized = normalizeCookieInput(appState);
        normalized = validateAppState(normalized);

        if (!Array.isArray(normalized) || normalized.length === 0) {
            logger.Warning(global.Fca.Require.Language?.Index?.InvaildAppState || "AppState không hợp lệ!");
            process.exit(0);
        }

        global.Fca.Data.AppState = normalized;
        populateJar(jar, normalized);

        try {
            Database().set('Backup', normalized);
        } catch (_) {}

        // Kết nối phiên làm việc với Facebook
        const { html } = await connectSession(jar, globalOptions, normalized);

        // Khởi tạo context và nạp API
        const { ctx, api } = await buildAPI(globalOptions, html, jar);

        // Xử lý pageID nếu có
        if (globalOptions.pageID) {
            const pageRes = await utils.get('https://www.facebook.com/' + ctx.globalOptions.pageID + '/messages/?section=messages&subsection=inbox', ctx.jar, null, globalOptions);
            let url = utils.getFrom(pageRes.body, 'window.location.replace("https:\\/\\/www.facebook.com\\', '");').split('\\').join('');
            url = url.substring(0, url.length - 1);
            await utils.get('https://www.facebook.com' + url, ctx.jar, null, globalOptions);
        }

        return callback(null, api);
    } catch (err) {
        if (Database().has('Backup') && !global.Fca.Data._triedBackup) {
            global.Fca.Data._triedBackup = true;
            return backup(Database().get('Backup'), globalOptions, callback, prCallback);
        }
        callback(err);
    }
}

/**
 * Entry point đăng nhập FCA
 */
function login(loginData, options, callback) {
    if (utils.getType(options) === 'Function' || utils.getType(options) === 'AsyncFunction') {
        callback = options;
        options = {};
    }

    const globalOptions = {
        selfListen: false,
        listenEvents: true,
        listenTyping: false,
        updatePresence: false,
        forceLogin: false,
        autoMarkDelivery: false,
        autoMarkRead: false,
        autoReconnect: true,
        logRecordSize: 100,
        online: false,
        emitReady: false,
        userAgent: utils.DEFAULT_UA
    };

    let prCallback = null;
    let returnPromise = null;

    if (utils.getType(callback) !== "Function" && utils.getType(callback) !== "AsyncFunction") {
        returnPromise = new Promise(function(resolve, reject) {
            prCallback = function(error, api) {
                if (error) return reject(error);
                return resolve(api);
            };
            callback = prCallback;
        });
    }

    const state = loginData?.appState || loginData?.cookie;
    if (state) {
        setOptions(globalOptions, options || {});
        loginHelper(state, globalOptions, callback, prCallback);
        return returnPromise;
    }

    logger.Warning("Chỉ hỗ trợ đăng nhập bằng appState hoặc cookie. Vui lòng cung cấp loginData.appState hoặc loginData.cookie.");
    return returnPromise;
}

module.exports = login;
