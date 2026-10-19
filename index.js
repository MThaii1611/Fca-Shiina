"use strict";
/**
 * index.js — FCA Shiina
 * Entry point: login, load api, expose api object
 * Bám sát spec setupfca.txt & chuẩn fca-shiina-lightspeed
 */

const logger    = require("./shiina/logger");
const lang      = require("./shiina/Languages/vi.json");
const Database  = require("./shiina/database");

const { parseToCookieArray, detectType, extractUID } = require("./shiina/login/cookie-parser");
const { buildJar, jarToArray }  = require("./shiina/login/jar-builder");
const { createHttpClient }      = require("./shiina/login/http-client");
const { verifySession }         = require("./shiina/login/session-verifier");
const { extractUserIDFromHtml } = require("./shiina/login/token-extractor");
const { handleCheckpoint }      = require("./shiina/login/checkpoint");
const { buildContext }          = require("./shiina/login/context-builder");
const path      = require("path");
const fs        = require("fs");
const { loadAllApis }           = require("./shiina/load-api");

const _startTime = Date.now();

// Khởi tạo file cấu hình Shiina_ConfigFca.json ngay tại index.js
const CONFIG_FILE = path.join(process.cwd(), "Shiina_ConfigFca.json");
const DEFAULT_CONFIG = {
    name: "FCA-Shiina",
    version: "1.0.0",
    Language: "vi",
    PreKey: "Shiina",
    AutoUpdate: false,
    MainColor: "#9900FF",
    MainName: "[ SHIINA-FCA ]",
    Uptime: false,
    Config: "default",
    DevMode: false,
    BroadCast: false,
    EncryptFeature: false,
    AntiSendAppState: true,
    AutoRestartMinutes: 0,
    RestartMQTT_Minutes: 0,
    autoReconnect: true,
    antiZombie: true,
    zombieTimeout: 90,
    maxCacheEvents: 200,
    logLevel: "normal"
};

let shiinaConfig = {};
try {
    if (!fs.existsSync(CONFIG_FILE)) {
        shiinaConfig = Object.assign({}, DEFAULT_CONFIG);
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(shiinaConfig, null, "\t"), "utf8");
        logger.Normal("Đã khởi tạo file cấu hình: Shiina_ConfigFca.json");
    } else {
        const raw = fs.readFileSync(CONFIG_FILE, "utf8");
        shiinaConfig = JSON.parse(raw);
        let updated = false;
        for (const k of Object.keys(DEFAULT_CONFIG)) {
            if (shiinaConfig[k] === undefined) {
                shiinaConfig[k] = DEFAULT_CONFIG[k];
                updated = true;
            }
        }
        if (updated) {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(shiinaConfig, null, "\t"), "utf8");
        }
    }
} catch (e) {
    shiinaConfig = Object.assign({}, DEFAULT_CONFIG);
}

if (!global.Fca) {
    global.Fca = {
        isThread: new Map(),
        isUser: new Map(),
        startTime: _startTime,
        Config: shiinaConfig,
        Require: {
            FastConfig: shiinaConfig
        },
        Data: {
            MsgCount: new Map(),
            event: new Map()
        }
    };
} else {
    global.Fca.Config = shiinaConfig;
    if (!global.Fca.Require) global.Fca.Require = {};
    global.Fca.Require.FastConfig = shiinaConfig;
}

function getText(key, ...args) {
    let s = lang[key] || key;
    for (let i = 0; i < args.length; i++) s = s.replace(`%${i + 1}`, args[i]);
    return s;
}

async function getServerLocation(http) {
    try {
        const res = await http.get("http://ip-api.com/json/?fields=query,country,city,isp&lang=en");
        const d = typeof res.data === "object" ? res.data : JSON.parse(res.data);
        return `${d.query} - ${d.country}${d.city ? " - " + d.city : ""}${d.isp ? " - " + d.isp : ""}`;
    } catch (_) {
        return "Không xác định";
    }
}

/**
 * Main login function
 * @param {object} credentials - { cookie: "..." } hoặc { appstate: [...] } hoặc raw string/array
 * @param {object} [options]   - globalOptions
 * @param {Function} callback  - (err, api) => void
 */
async function login(credentials, options, callback) {
    if (typeof options === "function") {
        callback = options;
        options = {};
    }
    if (!callback) throw new Error("login() cần callback");

    try { Database.init(); } catch (_) {}

    const rawCred = credentials?.appState || credentials?.appstate || credentials?.cookie || credentials;
    const credType = detectType(rawCred);

    if (credType === "unknown") {
        logger.Error(getText("LOGIN_FAILED"));
        return callback(new Error("Credential không hợp lệ: cần cookie string hoặc appstate array"));
    }

    const cookieArr = parseToCookieArray(rawCred);
    if (!cookieArr.length) {
        logger.Error(getText("LOGIN_FAILED"));
        return callback(new Error("Không parse được cookie/appstate"));
    }

    const jar = buildJar(cookieArr);
    const http = createHttpClient(jar, options || {});

    // Xác minh session qua hệ thống kiểm tra danh tính nghiêm ngặt
    const { alive, html, tokens } = await verifySession(http).catch((e) => {
        return { alive: false, html: "", tokens: {} };
    });

    let userID = extractUID(cookieArr) || extractUserIDFromHtml(html) || "unknown";

    if (tokens.checkpoint && userID !== "unknown") {
        await handleCheckpoint(tokens.checkpoint, html, http, tokens, userID);
    }

    // Một session chỉ coi là sống nếu server trả về ACCOUNT_ID/USER_ID !== 0 và alive = true
    const isDead = !alive || tokens.isDead || !tokens.fb_dtsg;

    if (isDead) {
        logger.Error(getText("LOGIN_FAILED"));
        logger.Error(getText("LOGIN_DEAD_STOP"));
    } else {
        logger.Success(getText(credType === "appstate" ? "LOGIN_SUCCESS_APPSTATE" : "LOGIN_SUCCESS_COOKIE"));
    }

    if (userID && userID !== "unknown") logger.Normal(getText("UID", userID));
    if (tokens.name) logger.Normal(getText("NAME", tokens.name));

    const location = await getServerLocation(http);
    logger.Normal(getText("SERVER_LOCATION", location));

    const ctx = buildContext({
        userID,
        userName: tokens.name || "Unknown",
        tokens,
        jar,
        options: options || {},
        region: tokens.mqttEndpoint ? null : null
    });

    ctx.globalOptions = ctx.options || {};

    if (isDead) {
        ctx._dead = true;
    }

    const api = {
        ctx,
        setOptions: (opt = {}) => {
            if (typeof opt === "object" && opt !== null) {
                Object.assign(ctx.options, opt);
            }
        },
        getAppState: () => jarToArray(jar),
        getCurrentUserID: () => ctx.userID,
        refreshDTSG: async () => {
            try {
                const res = await http.get("https://www.facebook.com/settings");
                const newHtml = typeof res.data === "string" ? res.data : "";
                const { extractAllTokens } = require("./shiina/login/token-extractor");
                const t = extractAllTokens(newHtml);
                if (t.fb_dtsg) {
                    ctx.fb_dtsg = t.fb_dtsg;
                    ctx.jazoest = t.jazoest || ctx.jazoest;
                    ctx.lsd     = t.lsd     || ctx.lsd;
                    logger.Normal("Đã refresh fb_dtsg");
                }
            } catch (_) {}
            return ctx.fb_dtsg;
        },
        getTokens: () => ({
            fb_dtsg: ctx.fb_dtsg || "",
            jazoest: ctx.jazoest || "",
            lsd: ctx.lsd || ""
        }),
        listApi: () => {
            return Object.keys(api)
                .filter(name => typeof api[name] === "function" && name !== "reloadFca" && name !== "listApi")
                .sort((a, b) => a.localeCompare(b));
        },
        reloadFca: () => {
            try {
                const { ls, http: httpApis } = loadAllApis(api, ctx, http);
                const total = (ls?.total || 0) + (httpApis?.total || 0);
                const loaded = (ls?.success || 0) + (httpApis?.success || 0);
                const failed = (ls?.fail || 0) + (httpApis?.fail || 0);
                const errors = [...(ls?.errors || []), ...(httpApis?.errors || [])];

                logger.Normal(`[RELOAD-FCA] Tổng: ${total} | Thành công: ${loaded} | Lỗi: ${failed}`);
                if (failed > 0) {
                    for (const e of errors) logger.Warn(`  ✗ ${e.file}: ${e.error}`);
                }
                return { total, loaded, failed, errors };
            } catch (err) {
                logger.Error(`[RELOAD-FCA] Lỗi reload: ${err?.message || err}`);
                return { total: 0, loaded: 0, failed: 1, errors: [{ file: "all", error: err?.message || String(err) }] };
            }
        }
    };

    logger.Normal(getText("LOAD_API"));
    const { ls, http: httpApis } = loadAllApis(api, ctx, http);

    logger.Normal(getText("API_LIGHTSPEED", ls.total, ls.success, ls.fail));
    if (ls.fail > 0) {
        for (const e of ls.errors) logger.Warn(getText("API_FAIL_FILE", e.file, e.error));
    }
    logger.Normal(getText("API_HTTP", httpApis.total, httpApis.success, httpApis.fail));
    if (httpApis.fail > 0) {
        for (const e of httpApis.errors) logger.Warn(getText("API_FAIL_FILE", e.file, e.error));
    }

    const elapsed = ((Date.now() - _startTime) / 1000).toFixed(2);
    logger.Success(getText("START_SUCCESS", elapsed));



    if (isDead) {
        logger.Error(getText("LOGIN_DEAD"));
        logger.Error(getText("LOGIN_DEAD_STOP"));
        setInterval(() => {}, 1000 * 60 * 60);
        return callback(new Error("Not logged in: Cookie/appstate đã die vui lòng thay mới"), api);
    }

    callback(null, api);
}

module.exports = login;
