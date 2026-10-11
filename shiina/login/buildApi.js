'use strict';

const fs = require('fs');
const path = require('path');
const utils = require('../../utils');
const logger = require('../logger');
const getText = global.Fca.getText;
const Language = global.Fca.Require.Language.Index;

const {
    getFBDTSG,
    getJazoest,
    getLsd,
    getIrisSeqID,
    getMqttEndpoint,
    fetchFallbackTokens
} = require('./extractToken');
const { resolveUserID } = require('./checkAppState');
const { bypassCheckpoint049 } = require('./checkpointHandler');

const Boolean_Option = ['online', 'selfListen', 'listenEvents', 'updatePresence', 'forceLogin', 'autoMarkDelivery', 'autoMarkRead', 'listenTyping', 'autoReconnect', 'emitReady'];

function setOptions(globalOptions, options) {
    const log = require('npmlog');
    Object.keys(options).map(function(key) {
        if (Boolean_Option.includes(key)) {
            globalOptions[key] = Boolean(options[key]);
        } else {
            switch (key) {
                case 'pauseLog': {
                    if (options.pauseLog) log.pause();
                    else log.resume();
                    break;
                }
                case 'logLevel': {
                    log.level = options.logLevel;
                    globalOptions.logLevel = options.logLevel;
                    break;
                }
                case 'userAgent': {
                    globalOptions.userAgent = (options.userAgent || utils.DEFAULT_UA);
                    break;
                }
                default: {
                    globalOptions[key] = options[key];
                    break;
                }
            }
        }
    });
}

/**
 * Xây dựng toàn bộ đối tượng API từ HTML và jar
 * @param {object} globalOptions 
 * @param {string} html 
 * @param {object} jar 
 * @returns {{ ctx: object, defaultFuncs: object, api: object }}
 */
async function buildAPI(globalOptions, html, jar) {
    let fb_dtsg = getFBDTSG(html);
    let jazoest = getJazoest(html);
    let lsd = getLsd(html);
    const irisSeqID = getIrisSeqID(html);

    if (!fb_dtsg) {
        const fallback = await fetchFallbackTokens(jar, globalOptions);
        if (fallback.fb_dtsg) {
            fb_dtsg = fallback.fb_dtsg;
            if (!jazoest) jazoest = fallback.jazoest;
            if (!lsd) lsd = fallback.lsd;
        }
    }

    if (!fb_dtsg) {
        logger.Error("Cookie/Appstate hiện tại đã bị đăng xuất hoặc hết hạn trên máy chủ Meta! Vui lòng thay appstate/cookie mới.");
        throw new Error("Not logged in: Cookie/Appstate đã hết hạn hoặc không hợp lệ trên máy chủ Meta");
    }

    logger.Normal("Shiina Fca v" + (global.Fca.Require.FastConfig?.version || global.Fca.Version || "1.0.0"));

    const userID = resolveUserID(jar, html, global.Fca.Data.AppState);
    if (!userID) {
        logger.Error("Appstate không hợp lệ hoặc đã hết hạn! Vui lòng thay appstate mới.");
        throw new Error("Appstate không hợp lệ hoặc đã hết hạn!");
    }

    process.env['UID'] = logger.Normal(getText(Language.UID, userID), userID);
    let mqttEndpoint, region;

    const extractedEndpoint = getMqttEndpoint(html);
    if (extractedEndpoint) {
        mqttEndpoint = extractedEndpoint;
        try {
            const url = new URL(mqttEndpoint);
            region = url.searchParams.get('region')?.toUpperCase() || "PRN";
        } catch (_) {
            region = "PRN";
        }

        logger.Normal(`Khu vực MQTT: ${region}`);
    } else {
        logger.Warning('Sử dụng MQTT endpoint mặc định');
        mqttEndpoint = `wss://edge-chat.facebook.com/chat?region=prn&sid=${userID}`;
        region = "PRN";
    }

    const ctx = {
        userID,
        jar,
        clientID: utils.getGUID(),
        globalOptions,
        loggedIn: true,
        access_token: 'NONE',
        clientMutationId: 0,
        mqttClient: undefined,
        lastSeqId: irisSeqID,
        syncToken: undefined,
        mqttEndpoint,
        region,
        firstListen: true,
        _ending: false,
        fb_dtsg,
        jazoest,
        lsd,
        req_ID: 0,
        lastPresence: Date.now(),
        debug: false
    };

    const defaultFuncs = utils.makeDefaults(html, userID, ctx);

    async function clearWarning() {
        const result = await bypassCheckpoint049(html, jar, globalOptions, userID);
        if (result.resolved && result.wasCheckpoint) {
            const fresh = getFBDTSG(result.html);
            if (fresh) ctx.fb_dtsg = fresh;
        }
        return result.resolved;
    }

    const api = {
        setOptions: setOptions.bind(null, globalOptions),
        getAppState: () => utils.getAppState(jar),

        refreshDTSG: async function() {
            try {
                const res = await defaultFuncs.get('https://www.facebook.com/', jar, null, globalOptions);
                let newDtsg = getFBDTSG(res.body);

                if (!newDtsg) {
                    const isDead = (res && res.body && res.body.includes('login_form')) ||
                                   (res && res.headers && res.headers.location && (res.headers.location.includes('/login/') || res.headers.location.includes('checkpoint')));
                    if (isDead) {
                        logger.Error("Cookie/Appstate hiện tại đã bị đăng xuất hoặc hết hạn trên máy chủ Meta! Vui lòng thay appstate/cookie mới.");
                    } else {
                        logger.Warning("Failed to refresh fb_dtsg - no pattern matched");
                    }
                    return ctx.fb_dtsg;
                }

                logger.Normal("Successfully refreshed fb_dtsg");
                ctx.fb_dtsg = newDtsg;

                const jazoestMatch = getJazoest(res.body);
                if (jazoestMatch) ctx.jazoest = jazoestMatch;

                const lsdMatch = getLsd(res.body);
                if (lsdMatch) ctx.lsd = lsdMatch;

                return newDtsg;
            } catch (error) {
                logger.Warning("Error while refreshing fb_dtsg:", error.message);
                return ctx.fb_dtsg;
            }
        },

        sendRequest: async function(url, form = {}, qs = {}) {
            if (!form.fb_dtsg && ctx.fb_dtsg) {
                form.fb_dtsg = ctx.fb_dtsg;
            }
            try {
                const res = await defaultFuncs.post(url, ctx.jar, form, qs);
                if (res.body && res.body.includes('invalid_fb_dtsg')) {
                    logger.Warning("Invalid fb_dtsg detected, refreshing...");
                    await this.refreshDTSG();
                    form.fb_dtsg = ctx.fb_dtsg;
                    return await defaultFuncs.post(url, ctx.jar, form, qs);
                }
                return res;
            } catch (error) {
                throw error;
            }
        },

        postFormData: function(url, body) {
            return defaultFuncs.postFormData(url, ctx.jar, body);
        },

        clearWarning: async function() {
            return await clearWarning();
        }
    };

    let _knownApiNames = new Set();
    const srcDir = path.join(__dirname, '../../src');

    function loadApiFiles() {
        const srcFiles = fs.readdirSync(srcDir)
            .filter(f => f.endsWith(".js") && !f.includes('Dev_') && f !== 'lightspeedGateway.js');

        let loaded = 0;
        let failed = 0;
        const errors = [];
        const currentNames = new Set();

        srcFiles.forEach(f => {
            const name = f.split('.')[0];
            currentNames.add(name);
            try {
                const isGetThreadSwap = (f === 'getThreadInfo.js' && !global.Fca.Require.FastConfig?.AntiGetInfo?.AntiGetThreadInfo);
                const targetFile = isGetThreadSwap ? path.join(srcDir, 'getThreadMain.js') : path.join(srcDir, f);
                const resolvedPath = require.resolve(targetFile);
                delete require.cache[resolvedPath];
                api[name] = require(resolvedPath)(defaultFuncs, api, ctx);
                loaded++;
            } catch (e) {
                failed++;
                errors.push({ file: f, error: e.message || String(e) });
                logger.Warning(`Lỗi khi load: ${f} => ${e.message || e}`);
            }
        });

        for (const oldName of _knownApiNames) {
            if (!currentNames.has(oldName)) {
                delete api[oldName];
            }
        }

        api.sendMessageMqtt = api.sendMessage;
        api.setMessageReactionMqtt = api.setMessageReaction;
        if (api.sendTypingIndicator) {
            api.sendTypingLightspeed = api.sendTypingIndicator;
        }

        return { total: srcFiles.length, loaded, failed, errors };
    }

    const _firstLoad = loadApiFiles();
    logger.Normal(`Tổng: ${_firstLoad.total} | Thành công: ${_firstLoad.loaded} | Lỗi: ${_firstLoad.failed}`);
    if (_firstLoad.failed > 0) {
        logger.Warning(`${_firstLoad.failed} api load thất bại:`);
        _firstLoad.errors.forEach(({ file, error }) => {
            logger.Warning(`  ✗ ${file}: ${error}`);
        });
    } else {
        logger.Normal(`Tất cả api fca đã load thành công!`);
    }

    global.Fca.ApiLoadResult = _firstLoad;

    api.reloadFca = function() {
        const result = loadApiFiles();
        logger.Normal(`[RELOAD-FCA] Tổng: ${result.total} | Thành công: ${result.loaded} | Lỗi: ${result.failed}`);
        if (result.failed > 0) {
            result.errors.forEach(({ file, error }) => {
                logger.Warning(`  ✗ ${file}: ${error}`);
            });
        }
        global.Fca.ApiLoadResult = result;
        return result;
    };

    api.listApi = function() {
        return Object.keys(api)
            .filter(name => typeof api[name] === "function")
            .sort((a, b) => a.localeCompare(b));
    };

    api.getTokens = function() {
        return {
            fb_dtsg: ctx.fb_dtsg || "",
            jazoest: ctx.jazoest || "",
            lsd: ctx.lsd || "",
            userID: ctx.userID || ""
        };
    };

    return { ctx, defaultFuncs, api };
}

module.exports = {
    setOptions,
    buildAPI
};
