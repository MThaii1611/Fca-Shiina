
'use strict';

const utils = require('../utils');
const log = require('npmlog');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const HttpsProxyAgent = require('https-proxy-agent');
const EventEmitter = require('events');
const Duplexify = require('duplexify');
const { Transform, PassThrough } = require('stream');
const path = require('path');
const { createGatewayClient } = require('./lightspeedGateway');

var identity = function() {};
var form = {};
var getSeqID = function() {};
global.Fca.Data.MsgCount = new Map();
global.Fca.Data.event = new Map();

const seenMessageCache = new Map();
function isDuplicateEvent(eventData) {
    if (!eventData) return false;
    const now = Date.now();
    let key = null;
    if (eventData.type === "message" || eventData.type === "message_reply") {
        if (!eventData.messageID) return false;
        key = `msg_${eventData.threadID}_${eventData.messageID}`;
    } else if (eventData.type === "message_reaction") {
        key = `react_${eventData.threadID}_${eventData.messageID}_${eventData.userID}_${eventData.reaction}`;
    } else if (eventData.type === "message_unsend") {
        key = `unsend_${eventData.messageID}`;
    } else if (eventData.type === "read_receipt") {
        key = `read_${eventData.threadID}_${eventData.time}`;
    } else if (eventData.type === "typ") {
        key = `typ_${eventData.threadID}_${eventData.from}_${eventData.isTyping}`;
    } else if (eventData.type === "event" && eventData.logMessageType) {
        key = `evt_${eventData.threadID}_${eventData.logMessageType}_${JSON.stringify(eventData.logMessageData || {})}`;
    }

    if (key) {
        if (seenMessageCache.has(key)) return true;
        seenMessageCache.set(key, now);
        if (seenMessageCache.size > 3000) {
            for (const [k, ts] of seenMessageCache) {
                if (now - ts > 60000) seenMessageCache.delete(k);
            }
        }
    }
    return false;
}

const topics = [
    '/ls_req', '/ls_resp', '/ls_foreground_state', '/ls_app_settings'
];

let WebSocket_Global;
let mqttReconnectCount = 0;
const reconnectBackoff = 2000;
const maxReconnectBackoff = 60000;
const connectWatchdogMs = 20000;

let lastUptimeSeconds = 0;
let isUptimeTrackerInitialized = false;

function LogUptime() {
    try {
        const currentProcessUptime = process.uptime();
        const sessionUptimeDelta = currentProcessUptime - lastUptimeSeconds;
        lastUptimeSeconds = currentProcessUptime;
        const filePath = path.join(__dirname, '../shiina/CountTime.json');
        let totalUptime = 0;
        if (global.Fca.Require.fs.existsSync(filePath)) {
            const fileData = global.Fca.Require.fs.readFileSync(filePath, 'utf8');
            totalUptime = Number(fileData) || 0;
        }
        const newTotalUptime = totalUptime + sessionUptimeDelta;
        global.Fca.Require.fs.writeFileSync(filePath, String(newTotalUptime), 'utf8');
    } catch (e) {
        log.error('LogUptime', 'Lỗi khi lưu Uptime: ' + e.message);
    }
}

function InitUptimeTracker() {
    if (!isUptimeTrackerInitialized) {
        setInterval(LogUptime, 3 * 60 * 1000);
        isUptimeTrackerInitialized = true;
    }
}
InitUptimeTracker();

function buildProxy(ws) {
    const queue = [];
    let isConnecting = (ws && ws.readyState === 0); // 0 = CONNECTING

    if (ws && typeof ws.once === 'function') {
        ws.once('open', () => {
            isConnecting = false;
            while (queue.length > 0) {
                const item = queue.shift();
                try {
                    ws.send(item.data);
                } catch (err) {
                    log.warn('WebSocket', 'Lỗi gửi gói tin MQTT đã đệm: ' + (err.message || err));
                }
                if (typeof item.cb === 'function') item.cb();
            }
        });
    }

    const sendOrQueue = (chunk, cb) => {
        let data = (typeof chunk === 'string') ? Buffer.from(chunk, 'utf8') : chunk;
        if (ws && ws.readyState === 1) { // 1 = OPEN
            try {
                ws.send(data);
            } catch (err) {
                log.warn('WebSocket', 'Lỗi gửi gói tin MQTT: ' + (err.message || err));
            }
            if (typeof cb === 'function') cb();
        } else if (ws && ws.readyState === 0) { // 0 = CONNECTING
            queue.push({ data, cb });
        } else {
            if (typeof cb === 'function') cb();
        }
    };

    const Proxy = new Transform({
        objectMode: false,
        transform(chunk, enc, next) {
            sendOrQueue(chunk, next);
        },
        flush(done) {
            if (ws && ws.readyState === 1) {
                try { ws.close(); } catch (_) {}
            }
            done();
        },
        writev(chunks, cb) {
            for (let i = 0; i < chunks.length; i++) {
                sendOrQueue(chunks[i].chunk);
            }
            if (typeof cb === 'function') cb();
        },
    });
    return Proxy;
}

function buildStream(options, WebSocket_Instance) {
    const Proxy = buildProxy(WebSocket_Instance);
    const readable = new PassThrough();
    const Stream = Duplexify(Proxy, readable, options);
    Stream.socket = WebSocket_Instance;

    let pingInterval;
    let reconnectTimeout;

    const clearTimers = () => {
        if (pingInterval) clearInterval(pingInterval);
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };

    WebSocket_Instance.onclose = (event) => {
        if (event && event.code !== 1000) {
            console.warn('[FCA-LIGHTSPEED]', `WebSocket đóng kết nối bất thường (Mã: ${event.code}${event.reason ? ', lý do: ' + event.reason : ''})`);
        }
        clearTimers();
        readable.end();
        Stream.end();
        Stream.destroy();
    };

    WebSocket_Instance.onerror = (err) => {
        console.error('[FCA-LIGHTSPEED]', 'Lỗi kết nối WebSocket:', err?.message || err);
        clearTimers();
        readable.destroy(err);
        Stream.destroy(err);
    };

    Stream.forceClose = () => {
        clearTimers();
        try {
            if (typeof WebSocket_Instance.terminate === 'function') {
                WebSocket_Instance.terminate();
            } else {
                WebSocket_Instance.close();
            }
        } catch (_) {}
        try { readable.end(); } catch (_) {}
        try { Stream.end(); } catch (_) {}
        try { Stream.destroy(); } catch (_) {}
    };

    const resetReconnectTimeout = () => {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
            if (WebSocket_Instance.readyState === WebSocket_Instance.OPEN) {
                log.warn('WebSocket', 'Không nhận được dữ liệu từ Facebook quá lâu (120s), tiến hành làm mới kết nối...');
                try { WebSocket_Instance.close(); } catch (_) {}
                readable.end();
                Stream.end();
                Stream.destroy();
            }
        }, 120000);
    };

    WebSocket_Instance.onmessage = (event) => {
        resetReconnectTimeout();
        const data = event.data instanceof ArrayBuffer ? Buffer.from(event.data) : Buffer.from(event.data, 'utf8');
        if (data.length >= 4 && data[0] === 0x20) {
            const rc = data[3];
            if (rc === 0) {
                console.log('[FCA-LIGHTSPEED]', '✅ Facebook chấp thuận kết nối MQTT (CONNACK OK - Sẵn sàng nhận tin).');
            } else if (rc === 4 || rc === 5) {
                const logger = global.Fca.Require.logger;
                logger.Error("Cookie/Appstate hiện tại đã bị đăng xuất hoặc hết hạn trên máy chủ Meta! Vui lòng thay appstate/cookie mới.");
                global.Fca.Data.StopListening = true;
            }
        }
        readable.write(data);
    };

    if (typeof WebSocket_Instance.on === 'function') {
        WebSocket_Instance.on('pong', () => {
            resetReconnectTimeout();
        });
    }

    WebSocket_Instance.onopen = () => {
        console.log('[FCA-LIGHTSPEED]', 'Đã kết nối thành công WebSocket tới Facebook.');
        Stream.setReadable(readable);
        Stream.setWritable(Proxy);
        Stream.emit('connect');

        pingInterval = setInterval(() => {
            if (WebSocket_Instance.readyState === WebSocket_Instance.OPEN) {
                try { WebSocket_Instance.ping(); } catch (_) {}
            }
        }, 45000);

        resetReconnectTimeout();
    };

    WebSocket_Global = WebSocket_Instance;
    Proxy.on('close', () => {
        clearTimers();
        try { WebSocket_Instance.close(); } catch (_) {}
    });

    return Stream;
}

function listenMqtt(defaultFuncs, api, ctx, globalCallback) {
    if (!globalCallback._isWrapped) {
        const rawCallback = globalCallback;
        const wrapped = function(err, data) {
            if (err) return rawCallback(err);
            if (data && isDuplicateEvent(data)) return;
            return rawCallback(null, data);
        };
        wrapped._isWrapped = true;
        globalCallback = wrapped;
    }

    if (!ctx.gatewayClient) {
        try {
            const { createGatewayClient } = require("./lightspeedGateway");
            const gatewayClient = createGatewayClient(ctx, defaultFuncs);
            ctx.gatewayClient = gatewayClient;
            gatewayClient.on("stepProc", ({ procName, args, raw }) => {
                handleLsStepProc(defaultFuncs, api, ctx, globalCallback, procName, args, raw);
            });
            gatewayClient.connect().catch((err) => {
                log.warn("Gateway", "Lightspeed Gateway connection: " + (err.message || err));
            });
        } catch (e) {}
    }

    ctx._recreatingQueue = false;
    const chatOn = true;
    const foreground = true;

    const sessionID = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1;
    const GUID = utils.getGUID();
    const username = {
        u: ctx.userID,
        s: sessionID,
        chat_on: true,
        fg: true,
        d: GUID,
        ct: 'websocket',
        aid: '2220391788200892',
        mqtt_sid: '',
        cp: 3,
        ecp: 10,
        st: [],
        pm: [],
        dc: '',
        no_auto_fg: false,
        gas: null,
        pack: []
    };

    const cookies = ctx.jar.getCookies('https://www.facebook.com').join('; ');

    let hostUrl;
    try {
        if (ctx.mqttEndpoint) {
            hostUrl = new URL(ctx.mqttEndpoint.replace(/^http/i, 'ws'));
        } else {
            const reg = ctx.region ? `?region=${ctx.region.toLowerCase()}` : '';
            hostUrl = new URL(`wss://edge-chat.facebook.com/chat${reg}`);
        }
    } catch (_) {
        hostUrl = new URL('wss://edge-chat.facebook.com/chat');
    }
    if (hostUrl.protocol === 'ws:') hostUrl.protocol = 'wss:';
    hostUrl.pathname = '/chat';
    hostUrl.searchParams.set('sid', String(sessionID));
    if (ctx.region && !hostUrl.searchParams.has('region')) {
        hostUrl.searchParams.set('region', ctx.region.toLowerCase());
    }
    const host = hostUrl.toString();

    const options = {
        clientId: 'mqttwsclient',
        protocolId: 'MQIsdp',
        protocolVersion: 3,
        username: JSON.stringify(username),
        clean: true,
        wsOptions: {
            headers: {
                Cookie: cookies,
                Origin: 'https://www.facebook.com',
                'User-Agent': ctx.globalOptions.userAgent || utils.DEFAULT_UA,
                Referer: 'https://www.facebook.com/',
                Host: new URL(host).hostname
            },
            origin: 'https://www.facebook.com',
            protocolVersion: 13,
            binaryType: 'arraybuffer',
        },
        keepalive: 60,
        reschedulePings: true,
        reconnectPeriod: 0,
        connectTimeout: 15000,
    };

    if (ctx.globalOptions.proxy !== undefined) {
        const agent = new HttpsProxyAgent(ctx.globalOptions.proxy);
        options.wsOptions.agent = agent;
    }

    ctx.mqttClient = new mqtt.Client(() => buildStream(options, new WebSocket(host, options.wsOptions)), options);
    global.mqttClient = ctx.mqttClient;
    global.mqttClient.setMaxListeners(0);

    let reconnectScheduled = false;
    let connectWatchdog = setTimeout(() => {
        log.warn('System', `Không nhận được phản hồi kết nối MQTT sau ${connectWatchdogMs / 1000}s, tiến hành thử lại...`);
        scheduleReconnect('connect timeout');
    }, connectWatchdogMs);

    function clearWatchdog() {
        if (connectWatchdog) {
            clearTimeout(connectWatchdog);
            connectWatchdog = null;
        }
    }

    let zombieWatchdogInterval = null;

    function scheduleReconnect(reason, forceFetchSeq = false) {
        if (reconnectScheduled || global.Fca.Data.StopListening) return;
        reconnectScheduled = true;
        clearWatchdog();
        if (zombieWatchdogInterval) {
            clearInterval(zombieWatchdogInterval);
            zombieWatchdogInterval = null;
        }
        if (ctx._lsForegroundInterval) {
            clearInterval(ctx._lsForegroundInterval);
            ctx._lsForegroundInterval = null;
        }

        if (forceFetchSeq) {
            ctx.lastSeqId = null;
            ctx.syncToken = undefined;
        }

        mqttReconnectCount++;
        const backoffTime = Math.min(reconnectBackoff * Math.pow(2, Math.min(mqttReconnectCount - 1, 5)), maxReconnectBackoff);
        log.warn('System', `MQTT mất kết nối (${reason}). Thử kết nối lại lần ${mqttReconnectCount} sau ${backoffTime / 1000}s...`);

        if (mqttReconnectCount >= 2 && !global.Fca.Data.StopListening) {
            defaultFuncs.get('https://www.facebook.com/', ctx.jar, null, ctx.globalOptions).then(res => {
                const isLoginRedirect = res && res.headers && res.headers.location && (res.headers.location.includes('/login/') || res.headers.location.includes('checkpoint'));
                const hasDtsg = res && res.body && (/\["DTSGInitialData",\[\],{"token":"([^"]+)"}/.test(res.body) || /<input type="hidden" name="fb_dtsg"/.test(res.body));
                if (isLoginRedirect || (res && res.body && !hasDtsg && (res.body.includes('login_form') || res.body.includes('id="login_form"')))) {
                    const logger = global.Fca.Require.logger;
                    logger.Error("Cookie/Appstate hiện tại đã bị đăng xuất hoặc hết hạn trên máy chủ Meta! Vui lòng thay appstate/cookie mới.");
                    global.Fca.Data.StopListening = true;
                    if (typeof globalCallback === 'function') {
                        globalCallback({ type: "error", error: "Not logged in: Cookie/Appstate đã hết hạn hoặc không hợp lệ trên máy chủ Meta" });
                    }
                }
            }).catch(() => {});
        }

        // Capture references NOW before deferring — getSeqID() may replace global.mqttClient
        const oldMqttClient = global.mqttClient;
        const oldWebSocket = WebSocket_Global;

        // Defer teardown to next tick so current message handler (PUBACK write) finishes first
        setImmediate(() => {
            try {
                if (oldMqttClient) {
                    oldMqttClient.removeAllListeners();
                    oldMqttClient.end(true);
                }
            } catch (e) {}

            try {
                if (oldWebSocket) {
                    if (typeof oldWebSocket.terminate === 'function') {
                        oldWebSocket.terminate();
                    } else {
                        oldWebSocket.close();
                    }
                }
            } catch (e) {}

            global.Fca.Data.Setup = false;
        });

        setTimeout(() => {
            reconnectScheduled = false;
            if (ctx.globalOptions.autoReconnect !== false && !global.Fca.Data.StopListening) {
                getSeqID(forceFetchSeq);
            }
        }, backoffTime);
    }

    global.mqttClient.on('error', (err) => {
        log.error('listenMqtt Error', err.message || err);
        scheduleReconnect('error: ' + (err.message || err), true);
    });

    global.mqttClient.on('close', () => {
        if (global.Fca.Data.StopListening) return;
        if (zombieWatchdogInterval) {
            clearInterval(zombieWatchdogInterval);
            zombieWatchdogInterval = null;
        }
        scheduleReconnect('connection closed', false);
    });

    let lastPacketAt = Date.now();
    const ZOMBIE_CHECK_INTERVAL_MS = 30 * 1000;
    const ZOMBIE_TIMEOUT_MS = 90 * 1000;

    global.mqttClient.on('packetreceive', () => {
        lastPacketAt = Date.now();
    });

    if (zombieWatchdogInterval) clearInterval(zombieWatchdogInterval);
    zombieWatchdogInterval = setInterval(() => {
        if (global.Fca.Data.StopListening) {
            clearInterval(zombieWatchdogInterval);
            zombieWatchdogInterval = null;
            return;
        }
        if (Date.now() - lastPacketAt > ZOMBIE_TIMEOUT_MS) {
            log.warn('System', `Không nhận được bất kỳ packet nào từ MQTT trong ${ZOMBIE_TIMEOUT_MS / 1000}s (nghi ngờ kết nối chết lâm sàng - zombie connection), ép đóng và kết nối lại...`);
            clearInterval(zombieWatchdogInterval);
            zombieWatchdogInterval = null;
            scheduleReconnect('zombie connection detected', true);
        }
    }, ZOMBIE_CHECK_INTERVAL_MS);

    global.mqttClient.on('connect', () => {
        clearWatchdog();
        reconnectScheduled = false;
        log.info('System', 'Kết nối MQTT thành công.');
        mqttReconnectCount = 0;

        if (!global.Fca.Data.Setup || global.Fca.Data.Setup === undefined) {
            if (global.Fca.Require.FastConfig.RestartMQTT_Minutes && Number(global.Fca.Require.FastConfig.RestartMQTT_Minutes) > 0 && global.Fca.Data.StopListening !== true) {
                global.Fca.Data.Setup = true;
                const refreshMinutes = Number(global.Fca.Require.FastConfig.RestartMQTT_Minutes);
                log.info('System', `Kích hoạt cơ chế tự động làm mới MQTT định kỳ: mỗi ${refreshMinutes} phút.`);
                setTimeout(async () => {
                    if (global.Fca.Data.StopListening) return;
                    log.warn('System', 'Thực thi quy trình tự động Restart MQTT Client để làm mới kết nối theo cài đặt...');
                    try {
                        if (api && typeof api.refreshDTSG === 'function') {
                            await api.refreshDTSG().catch(() => {});
                        } else if (api && typeof api.refreshFb_dtsg === 'function') {
                            await api.refreshFb_dtsg().catch(() => {});
                        }
                    } catch (_) {}
                    global.Fca.Data.Setup = false;
                    scheduleReconnect('periodic auto-refresh', true);
                }, refreshMinutes * 60 * 1000);
            }
        }

        if (process.env.OnStatus === undefined) {
            log.info('System', 'Shiina Fca Premium - Khởi động Hệ Thống');

            const MemoryManager = require('../shiina/Extra/Release_Memory');
            const SettingMemoryManager = {
                warningThreshold: 0.7,
                releaseThreshold: 0.8,
                maxThreshold: 0.9,
                interval: 60 * 1000,
                logLevel: 'warn',
                logFile: path.join(process.cwd(), 'ShiinaFca_Database', 'memory.log'),
                smartReleaseEnabled: true,
                allowLog: (global.Fca.Require.FastConfig.AntiStuckAndMemoryLeak?.LogFile?.Use || false)
            };

            const memoryManager = new MemoryManager(SettingMemoryManager);
            memoryManager.autoStart(60 * 60 * 1000);

            if (global.Fca.Require.FastConfig.AntiStuckAndMemoryLeak?.AutoRestart?.Use) {
                memoryManager.onMaxMemory(function() {
                    log.warn('System', 'Bộ nhớ RAM đã vượt ngưỡng 90%. Thực hiện Restart tự động để chống Crash!');
                    LogUptime();
                    process.exit(1);
                });
            }
            process.env.OnStatus = true;
        }

        topics.forEach((topicsub) => global.mqttClient.subscribe(topicsub));

        // 1. Lightspeed foreground state & continuous heartbeat
        const sendForegroundState = () => {
            if (!global.mqttClient || !global.mqttClient.connected) return;
            global.mqttClient.publish("/ls_foreground_state", JSON.stringify({
                inForegroundApp: true,
                inForegroundDevice: true,
                keepAliveTimeout: 60
            }), { qos: 1, retain: false });
        };
        sendForegroundState();
        if (ctx._lsForegroundInterval) clearInterval(ctx._lsForegroundInterval);
        ctx._lsForegroundInterval = setInterval(sendForegroundState, 30000);

        // 2. Lightspeed Sync Groups (Database 1: Inbox/Messages, 95: Watermarks, 104: Requests, 2: Config, 16: Folders/Tags)
        const LIGHTSPEED_VERSION = 28890729100558484;
        const LIGHTSPEED_APP_ID = "2220391788200892";

        const sendMqttSyncAck = (database, epochId, cursor) => {
            if (!global.mqttClient || !global.mqttClient.connected) return;
            if (!ctx.wsReqNumber) ctx.wsReqNumber = 100;
            const reqID = ++ctx.wsReqNumber;
            const ackPayload = {
                database: Number(database),
                epoch_id: epochId != null ? (typeof epochId === "string" || typeof epochId === "number" ? String(epochId) : (BigInt(Date.now()) << 22n).toString()) : (BigInt(Date.now()) << 22n).toString(),
                failure_count: null,
                last_applied_cursor: String(cursor),
                sync_params: null,
                version: LIGHTSPEED_VERSION
            };
            const outer = {
                app_id: LIGHTSPEED_APP_ID,
                payload: JSON.stringify(ackPayload),
                request_id: reqID,
                type: 2
            };
            global.mqttClient.publish("/ls_req", JSON.stringify(outer), { qos: 1, retain: false });
        };
        ctx._sendMqttSyncAck = sendMqttSyncAck;

        const subscribeDb = (database) => {
            if (!ctx.wsReqNumber) ctx.wsReqNumber = 100;
            const reqID = ++ctx.wsReqNumber;
            const epoch = (BigInt(Date.now()) << 22n).toString();
            const subPayload = {
                database: database,
                epoch_id: epoch,
                failure_count: null,
                last_applied_cursor: null,
                sync_params: "{}",
                version: LIGHTSPEED_VERSION
            };
            const outer = {
                app_id: LIGHTSPEED_APP_ID,
                payload: JSON.stringify(subPayload),
                request_id: reqID,
                type: 1
            };
            global.mqttClient.publish("/ls_req", JSON.stringify(outer), { qos: 1, retain: false });
        };

        subscribeDb(1);
        subscribeDb(95);
        subscribeDb(104);
        subscribeDb(145);
        subscribeDb(2);
        subscribeDb(16);

        console.log('[LIGHTSPEED]', 'Khởi tạo 100% Pure Lightspeed thành công (Foreground Heartbeat 20s + Auto Ack Cursor + DB 1,95,104,145,2,16). Sạch bóng t_ms.');

        if (ctx.globalOptions.emitReady) {
            globalCallback({ type: "ready", error: null });
        }
    });

    global.mqttClient.on('message', (topic, message, _packet) => {
        try {
            const jsonMessage = JSON.parse(message.toString());
            if (topic === "/ls_resp") {
                if (ctx.callback_Task && jsonMessage.request_id && ctx.callback_Task[jsonMessage.request_id]) {
                    try {
                        ctx.callback_Task[jsonMessage.request_id].callback(null, jsonMessage);
                        delete ctx.callback_Task[jsonMessage.request_id];
                    } catch (e) {
                        log.error("LsCallbackError", e);
                    }
                }
                let payload = jsonMessage.payload;
                while (typeof payload === "string") {
                    try { payload = JSON.parse(payload); } catch (_) { break; }
                }
                const target = payload || jsonMessage;
                utils.walkLsStep(target, function(procName, args) {
                    handleLsStepProc(defaultFuncs, api, ctx, globalCallback, procName, args, jsonMessage);
                });
            } else if (topic === '/thread_typing' || topic === '/orca_typing_notifications') {
                const typ = {
                    type: "typ",
                    isTyping: !!jsonMessage.state,
                    from: jsonMessage.sender_fbid.toString(),
                    threadID: utils.formatID((jsonMessage.thread || jsonMessage.sender_fbid).toString())
                };
                globalCallback(null, typ);
            } else if (topic === '/orca_presence' && !ctx.globalOptions.updatePresence) {
                if (jsonMessage.list) {
                    for (let i in jsonMessage.list) {
                        const data = jsonMessage.list[i];
                        const presence = {
                            type: "presence",
                            userID: data["u"].toString(),
                            timestamp: data["l"] * 1000,
                            statuses: data["p"]
                        };
                        globalCallback(null, presence);
                    }
                }
            }
        } catch (error) {
            log.error('Mqtt Payload Error', 'Lỗi khi parse message MQTT: ' + error.message);
        }
    });
}

function extractAttachmentsFromStep(step, targetMid) {
    const attachments = [];
    if (!step) return attachments;
    utils.walkLsStep(step, (procName, args) => {
        if (!args || !Array.isArray(args)) return;

        if (procName === "insertXmaAttachment") {
            const mid = utils.unwrapLsVal(args[28]) || utils.unwrapLsVal(args[30]);
            if (!targetMid || mid === targetMid || String(mid).includes(String(targetMid))) {
                const title = utils.unwrapLsVal(args[53]) || utils.unwrapLsVal(args[54]) || utils.unwrapLsVal(args[44]);
                const previewUrl = utils.unwrapLsVal(args[7]) || utils.unwrapLsVal(args[8]) || utils.unwrapLsVal(args[49]) || utils.unwrapLsVal(args[60]);
                const playableUrl = utils.unwrapLsVal(args[3]) || utils.unwrapLsVal(args[4]) || utils.unwrapLsVal(args[117]);
                const actionUrl = utils.unwrapLsVal(args[52]);
                attachments.push({
                    type: "share",
                    title: title ? String(title) : "",
                    url: actionUrl ? String(actionUrl) : (playableUrl ? String(playableUrl) : (previewUrl ? String(previewUrl) : "")),
                    image: previewUrl ? String(previewUrl) : "",
                    playableUrl: playableUrl ? String(playableUrl) : null,
                    description: utils.unwrapLsVal(args[58]) ? String(utils.unwrapLsVal(args[58])) : ""
                });
            }
        } else if (procName === "insertAttachmentItem") {
            const mid = utils.unwrapLsVal(args[4]);
            if (!targetMid || mid === targetMid || String(mid).includes(String(targetMid))) {
                const title = utils.unwrapLsVal(args[6]) || utils.unwrapLsVal(args[7]) || utils.unwrapLsVal(args[8]);
                const imageUrl = utils.unwrapLsVal(args[19]) || utils.unwrapLsVal(args[13]) || utils.unwrapLsVal(args[14]);
                const originalUrl = utils.unwrapLsVal(args[24]) || utils.unwrapLsVal(args[8]) || utils.unwrapLsVal(args[19]);
                if (imageUrl || originalUrl || title) {
                    attachments.push({
                        type: "share",
                        title: title ? String(title) : "",
                        url: originalUrl ? String(originalUrl) : (imageUrl ? String(imageUrl) : ""),
                        image: imageUrl ? String(imageUrl) : ""
                    });
                }
            }
        } else if (procName === "insertBlobAttachment") {
            // args[0]=Filename, args[3]=PlayableUrl, args[6]=PlayableUrlMimeType, args[8]=PreviewUrl
            // args[29]=AttachmentType, args[30]=AttachmentMimeType, args[32]=MessageId, args[34]=AttachmentFbid
            const blobMid = utils.unwrapLsVal(args[32]);
            if (!targetMid || blobMid === targetMid || String(blobMid).includes(String(targetMid))) {
                const fbid = String(utils.unwrapLsVal(args[34]) || "");
                const filename = String(utils.unwrapLsVal(args[0]) || "");
                const playableUrl = utils.unwrapLsVal(args[3]);
                const previewUrl = utils.unwrapLsVal(args[8]) || utils.unwrapLsVal(args[45]);
                const mimeType = String(utils.unwrapLsVal(args[6]) || utils.unwrapLsVal(args[30]) || "image/jpeg");
                const filesize = Number(utils.unwrapLsVal(args[1]) || 0);
                if (playableUrl || previewUrl || fbid) {
                    attachments.push({
                        type: mimeType.startsWith("video") ? "video" : (mimeType.startsWith("audio") ? "audio" : "photo"),
                        ID: fbid,
                        filename: filename,
                        fileSize: filesize,
                        mimeType: mimeType,
                        url: String(playableUrl || previewUrl || ""),
                        previewUrl: String(previewUrl || playableUrl || "")
                    });
                }
            }
        } else if (procName === "insertStickerAttachment") {
            // args[0]=PlayableUrl (animated webp), args[4]=PreviewUrl (static png)
            // args[13]=AccessibilitySummaryText, args[18]=MessageId, args[19]=AttachmentFbid (sticker FBID)
            const mid = utils.unwrapLsVal(args[18]);
            if (!targetMid || mid === targetMid || String(mid).includes(String(targetMid))) {
                const stickerId = String(utils.unwrapLsVal(args[19]) || utils.unwrapLsVal(args[27]) || "");
                const animatedUrl = utils.unwrapLsVal(args[0]);
                const staticUrl = utils.unwrapLsVal(args[4]);
                const desc = utils.unwrapLsVal(args[13]);
                attachments.push({
                    type: "sticker",
                    ID: stickerId,
                    url: String(animatedUrl || staticUrl || ""),
                    staticUrl: String(staticUrl || animatedUrl || ""),
                    caption: desc ? String(desc) : "",
                    description: desc ? String(desc) : ""
                });
            }
        }
    });
    return attachments;
}

function handleLsStepProc(defaultFuncs, api, ctx, globalCallback, procName, args, jsonMessage) {
    if (!args || !Array.isArray(args)) return;

    const pName = String(procName || "").toLowerCase();

    if (pName === "insertmessage" || pName === "upsertmessage" || pName === "deletetheninsertmessage" || pName === "lsupsertmessage" || pName === "lsinsertmessage" || pName === "lsdeletetheninsertmessage") {
        const rawThreadID = utils.unwrapLsVal(args[3]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(utils.unwrapLsVal(args[8]) || "");
        const rawSenderID = utils.unwrapLsVal(args[10]);
        const senderID = String(rawSenderID != null ? rawSenderID : "");
        const rawBody = utils.unwrapLsVal(args[0]);
        const body = rawBody != null ? String(rawBody) : "";
        const timestamp = Number(utils.unwrapLsVal(args[5]) || Date.now());
        const isGroup = String(threadID) !== String(senderID);

        if (!messageID || !threadID || threadID === "0") return;
        if (!ctx.globalOptions.selfListen && ctx.userID && utils.formatID(senderID) === utils.formatID(ctx.userID)) {
            return;
        }

        const mentions = {};
        const mOffset = utils.unwrapLsVal(args[19]);
        const mLength = utils.unwrapLsVal(args[20]);
        const mUser = utils.unwrapLsVal(args[21]);
        if (mOffset != null && mLength != null && mUser != null) {
            const off = parseInt(mOffset, 10);
            const len = parseInt(mLength, 10);
            if (!isNaN(off) && !isNaN(len) && off >= 0 && off + len <= body.length) {
                mentions[String(mUser)] = body.substring(off, off + len);
            }
        }

        const step = jsonMessage?.payload?.step || jsonMessage?.step;
        const attachments = extractAttachmentsFromStep(step, messageID);

        const rawStickerId = utils.unwrapLsVal(args[11]);
        if (rawStickerId && attachments.length === 0) {
            attachments.push({
                type: "sticker",
                ID: String(rawStickerId),
                url: `https://static.xx.fbcdn.net/rsrc.php/v3/y4/r/${rawStickerId}.png`,
                caption: "",
                description: ""
            });
        }

        const replyMid = utils.unwrapLsVal(args[23]);
        const isReply = Boolean(replyMid);

        const fmtMsg = {
            type: isReply ? "message_reply" : "message",
            senderID: senderID,
            body: body,
            args: body === "" ? [] : body.trim().split(/\s+/),
            threadID: threadID,
            messageID: messageID,
            attachments: attachments,
            mentions: mentions,
            timestamp: timestamp,
            isGroup: isGroup,
            participantIDs: [senderID],
            offlineThreadingID: String(utils.unwrapLsVal(args[9]) || "")
        };

        if (isReply) {
            const rawReplyMid = String(replyMid || "");
            const mappedOtid = ctx.midToOtid ? ctx.midToOtid.get(rawReplyMid) : null;
            const replyBody = String(utils.unwrapLsVal(args[28]) || "");
            const replySenderID = String(utils.unwrapLsVal(args[29]) || "");
            const replyTimestamp = Number(utils.unwrapLsVal(args[59]) || 0);

            fmtMsg.messageReply = {
                messageID: rawReplyMid,
                otid: mappedOtid || null,
                senderID: replySenderID,
                body: replyBody,
                args: replyBody === "" ? [] : replyBody.trim().split(/\s+/),
                threadID: threadID,
                attachments: [],
                mentions: {},
                timestamp: replyTimestamp || timestamp,
                isGroup: isGroup,
                participantIDs: replySenderID ? [replySenderID] : []
            };

            const replyMediaUrl = utils.unwrapLsVal(args[31]);
            if (replyMediaUrl) {
                fmtMsg.messageReply.attachments.push({
                    type: "share",
                    url: String(replyMediaUrl)
                });
            }
        }

        cacheMessageThread(ctx, messageID, threadID);

        global.Fca.Data.event.set("Data", { isGroup, threadID, messageID });
        globalCallback(null, fmtMsg);

        if (ctx.globalOptions.autoMarkDelivery) {
            setImmediate(() => markDelivery(ctx, api, threadID, messageID));
        }
    } else if (procName === "upsertReaction") {
        // args[0]=ThreadKey, args[1]=TimestampMs, args[2]=MessageId, args[3]=ActorId, args[4]=Reaction
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(utils.unwrapLsVal(args[2]) || "");
        const rawUserID = utils.unwrapLsVal(args[3]);
        const userID = String(rawUserID != null ? rawUserID : "");
        const reaction = String(utils.unwrapLsVal(args[4]) || "");
        const timestamp = Number(utils.unwrapLsVal(args[1]) || Date.now());

        if (threadID && messageID) {
            cacheMessageThread(ctx, messageID, threadID);
            globalCallback(null, {
                type: "message_reaction",
                threadID: threadID,
                messageID: messageID,
                senderID: userID,
                userID: userID,
                reaction: reaction,
                timestamp: timestamp
            });
        }
    } else if (procName === "updateOrInsertReactionV2") {
        // args[0]=ThreadKey, args[1]=MessageID, args[2]=ReactionFBID, args[3]=ReactionLiteral, args[4]=Count, args[8]=LastUpdatedTimestampMS
        // This is a thread metadata counter update from Meta, not an individual user reaction event.
        // We do not emit a blank event here to avoid wiping out the actor reaction from upsertReaction.
    } else if (procName === "updateTypingIndicator") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const from = String(utils.unwrapLsVal(args[1]) || "");
        const isTyping = Boolean(utils.unwrapLsVal(args[2]));
        if (threadID && from) {
            globalCallback(null, {
                type: "typ",
                isTyping: isTyping,
                from: from,
                threadID: threadID
            });
        }
    } else if (procName === "setPinnedMessage" || procName === "setOrUnsetPinnedMessage") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(utils.unwrapLsVal(args[1]) || "");
        if (threadID && messageID) {
            globalCallback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:pinned-message",
                logMessageData: { messageID: messageID, isPinned: true }
            });
        }
    } else if (procName === "deleteMessage" || procName === "cleanUpOnRecall" || procName === "handleRepliesOnUnsend") {
        // args[0]=MessageId, args[1]=ThreadKey (for cleanUpOnRecall/deleteMessage)
        const messageID = String(utils.unwrapLsVal(args[0]) || "");
        const rawThreadID = utils.unwrapLsVal(args[1]) || utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        if (messageID && messageID.startsWith("mid.")) {
            globalCallback(null, {
                type: "message_unsend",
                threadID: threadID,
                messageID: messageID,
                deletionTimestamp: Date.now()
            });
        }
    } else if (procName === "deleteMessageRequest") {
        // deleteMessageRequest has only ThreadKey arg, no messageID - skip emitting unsend event
    } else if (procName === "syncUpdateThreadName") {
        const threadName = String(utils.unwrapLsVal(args[0]) || "");
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[1]) || ""));
        globalCallback(null, {
            type: "event",
            threadID: threadID,
            logMessageType: "log:thread-name",
            logMessageData: { name: threadName }
        });
    } else if (procName === "updateThreadCustomEmoji") {
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[0]) || ""));
        const emoji = String(utils.unwrapLsVal(args[1]) || "");
        globalCallback(null, {
            type: "event",
            threadID: threadID,
            logMessageType: "log:thread-icon",
            logMessageData: { thread_icon: emoji }
        });
    } else if (procName === "updateThreadTheme") {
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[0]) || ""));
        const themeID = String(utils.unwrapLsVal(args[1]) || "");
        globalCallback(null, {
            type: "event",
            threadID: threadID,
            logMessageType: "log:thread-color",
            logMessageData: { theme_id: themeID }
        });
    } else if (procName === "setThreadImageURL") {
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[0]) || ""));
        const imgUrl = String(utils.unwrapLsVal(args[1]) || "");
        globalCallback(null, {
            type: "event",
            threadID: threadID,
            logMessageType: "log:thread-image",
            logMessageData: { image: { url: imgUrl } }
        });
    } else if (procName === "addParticipantIdToGroupThread" || procName === "LSAddParticipantIdToGroupThread") {
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[0]) || ""));
        const contactID = utils.formatID(String(utils.unwrapLsVal(args[1]) || ""));
        const nickname = utils.unwrapLsVal(args[5]);
        const isAdmin = Boolean(
            args[13] === true || args[13] === 1 || String(args[13]) === "true" ||
            String(args[7] || "").toLowerCase().includes("creator") || String(args[7] || "").toLowerCase().includes("admin") ||
            utils.unwrapLsVal(args[6]) === true || utils.unwrapLsVal(args[6]) === 1 || utils.unwrapLsVal(args[6]) === "1"
        );
        if (threadID && contactID) {
            let isExisting = false;
            let wasAdmin = false;
            if (global.Fca && global.Fca.isThread) {
                const cached = global.Fca.isThread.get(threadID) || {};
                cached.participantIDs = Array.isArray(cached.participantIDs) ? cached.participantIDs : [];
                isExisting = cached.participantIDs.includes(contactID);
                cached.adminIDs = Array.isArray(cached.adminIDs) ? cached.adminIDs : [];
                wasAdmin = cached.adminIDs.some(function(a) { return (a.id || a) == contactID; });

                if (!isExisting) cached.participantIDs.push(contactID);
                if (isAdmin) {
                    if (!wasAdmin) cached.adminIDs.push({ id: contactID });
                } else {
                    cached.adminIDs = cached.adminIDs.filter(function(a) { return (a.id || a) != contactID; });
                }
                global.Fca.isThread.set(threadID, cached);
            }

            try {
                var extraMod = require('../shiina/Extra/Shiina-GetThread');
                if (extraMod.hasData(threadID)) {
                    var exData = extraMod.getData(threadID);
                    if (exData) {
                        exData.adminIDs = Array.isArray(exData.adminIDs) ? exData.adminIDs : [];
                        if (isAdmin) {
                            if (!exData.adminIDs.some(function(a) { return (a.id || a) == contactID; })) {
                                exData.adminIDs.push({ id: contactID });
                            }
                        } else {
                            exData.adminIDs = exData.adminIDs.filter(function(a) { return (a.id || a) != contactID; });
                        }
                        extraMod.updateData(threadID, exData);
                    }
                }
            } catch (_) {}

            if (isExisting && wasAdmin !== isAdmin) {
                // Người dùng đã ở trong nhóm và quyền QTV vừa thay đổi
                globalCallback(null, {
                    type: "event",
                    threadID: threadID,
                    logMessageType: "log:thread-admins",
                    logMessageData: {
                        TARGET_ID: contactID,
                        ADMIN_EVENT: isAdmin ? "add_admin" : "remove_admin"
                    }
                });
            } else if (!isExisting) {
                // Thành viên mới vào nhóm
                globalCallback(null, {
                    type: "event",
                    threadID: threadID,
                    logMessageType: "log:subscribe",
                    logMessageData: {
                        addedParticipants: [{
                            userFbId: contactID,
                            fullName: nickname ? String(nickname) : "",
                            isAdmin: isAdmin
                        }]
                    }
                });
            }
        }
    } else if (procName === "updateReadReceipt" || procName === "markThreadReadV2") {
        const time = Number(utils.unwrapLsVal(args[0]) || Date.now());
        // args[0]=ReadWatermarkTimestampMs, args[1]=ThreadKey, args[2]=ContactId
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[1]) || ""));
        const reader = utils.formatID(String(utils.unwrapLsVal(args[2]) || ""));
        if (threadID) {
            globalCallback(null, {
                type: "read_receipt",
                threadID: threadID,
                reader: reader,
                time: time
            });
        }
    } else if (procName === "updateDeliveryReceipt") {
        const time = Number(utils.unwrapLsVal(args[0]) || Date.now());
        const threadID = utils.formatID(String(utils.unwrapLsVal(args[1]) || ""));
        const recipient = utils.formatID(String(utils.unwrapLsVal(args[2]) || ""));
        if (threadID) {
            globalCallback(null, {
                type: "delivery_receipt",
                threadID: threadID,
                recipient: recipient,
                time: time
            });
        }
    } else if (procName === "removeParticipantFromThread" || procName === "LSRemoveParticipantFromThread") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const rawContactID = utils.unwrapLsVal(args[1]);
        const contactID = utils.formatID(String(rawContactID != null ? rawContactID : ""));
        if (threadID && contactID) {
            globalCallback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:unsubscribe",
                logMessageData: { leftParticipantFbId: contactID },
                author: contactID
            });
        }
    } else if (
        procName === "updateThreadParticipantAdminStatus" ||
        procName === "LSUpdateThreadParticipantAdminStatus" ||
        String(procName || "").toLowerCase().includes("participantadminstatus")
    ) {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const rawContactID = utils.unwrapLsVal(args[1]);
        const contactID = utils.formatID(String(rawContactID != null ? rawContactID : ""));
        const rawAdmin = utils.unwrapLsVal(args[2]);
        const isAdmin = Boolean(rawAdmin === 1 || rawAdmin === true || rawAdmin === "1");
        if (threadID && contactID) {
            if (global.Fca && global.Fca.isThread) {
                const cached = global.Fca.isThread.get(threadID) || {};
                cached.adminIDs = Array.isArray(cached.adminIDs) ? cached.adminIDs : [];
                if (isAdmin) {
                    if (!cached.adminIDs.some(function(a) { return (a.id || a) == contactID; })) {
                        cached.adminIDs.push({ id: contactID });
                    }
                } else {
                    cached.adminIDs = cached.adminIDs.filter(function(a) { return (a.id || a) != contactID; });
                }
                global.Fca.isThread.set(threadID, cached);
            }

            try {
                var extraMod2 = require('../shiina/Extra/Shiina-GetThread');
                if (extraMod2.hasData(threadID)) {
                    var exData2 = extraMod2.getData(threadID);
                    if (exData2) {
                        exData2.adminIDs = Array.isArray(exData2.adminIDs) ? exData2.adminIDs : [];
                        if (isAdmin) {
                            if (!exData2.adminIDs.some(function(a) { return (a.id || a) == contactID; })) {
                                exData2.adminIDs.push({ id: contactID });
                            }
                        } else {
                            exData2.adminIDs = exData2.adminIDs.filter(function(a) { return (a.id || a) != contactID; });
                        }
                        extraMod2.updateData(threadID, exData2);
                    }
                }
            } catch (_) {}

            globalCallback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:thread-admins",
                logMessageData: {
                    TARGET_ID: contactID,
                    ADMIN_EVENT: isAdmin ? "add_admin" : "remove_admin"
                }
            });
        }
    } else if (procName === "updateOrInsertEditMessageHistory") {
        // args[0]=OriginalMessageID, args[1]=ThreadKey, args[2]=ServerAdjustedEditTimestampMS, args[3]=MessageContent
        const messageID = String(utils.unwrapLsVal(args[0]) || "");
        const rawThreadID = utils.unwrapLsVal(args[1]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const editTimestamp = Number(utils.unwrapLsVal(args[2]) || Date.now());
        const newBody = String(utils.unwrapLsVal(args[3]) || "");
        if (messageID) {
            globalCallback(null, {
                type: "message_edit",
                messageID: messageID,
                threadID: threadID || null,
                body: newBody,
                timestamp: editTimestamp
            });
        }
    } else if (procName === "editMessage" || procName === "handleRepliesOnMessageEdit") {
        const messageID = String(utils.unwrapLsVal(args[0]) || "");
        const newBody = String(utils.unwrapLsVal(args[2]) || "");
        if (messageID) {
            globalCallback(null, {
                type: "message_edit",
                messageID: messageID,
                body: newBody,
                timestamp: Date.now()
            });
        }
    } else if (procName === "deleteReaction") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const messageID = String(utils.unwrapLsVal(args[1]) || "");
        const rawUserID = utils.unwrapLsVal(args[2]);
        const userID = utils.formatID(String(rawUserID != null ? rawUserID : ""));
        if (threadID && messageID) {
            globalCallback(null, {
                type: "message_reaction",
                threadID: threadID,
                messageID: messageID,
                userID: userID,
                reaction: "",
                timestamp: Date.now()
            });
        }
    } else if (procName === "clearPinnedMessages") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        if (threadID) {
            globalCallback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:unpinned-message",
                logMessageData: { isPinned: false }
            });
        }
    } else if (procName === "shimCopyAllParticipantNicknamesForThread") {
        const rawThreadID = utils.unwrapLsVal(args[0]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        if (threadID) {
            globalCallback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:user-nickname",
                logMessageData: { participant_id: "", nickname: "" }
            });
        }
    } else if (procName === "addPollForThread" || procName === "addPollOption") {
        const pollID = String(utils.unwrapLsVal(args[0]) || "");
        const rawThreadID = utils.unwrapLsVal(args[1]);
        const threadID = utils.formatID(String(rawThreadID != null ? rawThreadID : ""));
        const title = procName === "addPollOption" ? String(utils.unwrapLsVal(args[2]) || "") : "";
        if (threadID) {
            globalCallback(null, {
                type: "event",
                threadID: threadID,
                logMessageType: "log:poll",
                logMessageData: {
                    poll_id: pollID,
                    title: title
                }
            });
        }
    } else if (procName === "addPollVote") {
        const optionID = String(utils.unwrapLsVal(args[0]) || "");
        const pollID = String(utils.unwrapLsVal(args[1]) || "");
        const contactID = utils.formatID(String(utils.unwrapLsVal(args[2]) || ""));
        globalCallback(null, {
            type: "event",
            logMessageType: "log:poll-vote",
            logMessageData: {
                poll_id: pollID,
                option_id: optionID,
                user_id: contactID
            }
        });
    } else if (pName === "replaceoptimsiticmessage" || pName === "replaceoptimisticmessage") {
        const rawOtid = String(utils.unwrapLsVal(args[0]) || "");
        const rawMid = String(utils.unwrapLsVal(args[1]) || "");
        if (rawOtid && rawMid) {
            if (!ctx.otidToMid) ctx.otidToMid = new Map();
            if (!ctx.midToOtid) ctx.midToOtid = new Map();
            if (ctx.otidToMid.size > 5000) {
                const firstOtid = ctx.otidToMid.keys().next().value;
                ctx.otidToMid.delete(firstOtid);
            }
            if (ctx.midToOtid.size > 5000) {
                const firstMid = ctx.midToOtid.keys().next().value;
                ctx.midToOtid.delete(firstMid);
            }
            ctx.otidToMid.set(rawOtid, rawMid);
            ctx.midToOtid.set(rawMid, rawOtid);

            if (ctx._pendingOtidResolvers && ctx._pendingOtidResolvers.has(rawOtid)) {
                const resolver = ctx._pendingOtidResolvers.get(rawOtid);
                ctx._pendingOtidResolvers.delete(rawOtid);
                try { resolver(rawMid); } catch (_) {}
            }

            if (ctx.messageToThread) {
                const threadID = ctx.messageToThread.get(rawOtid);
                if (threadID) ctx.messageToThread.set(rawMid, threadID);
            }

            if (global.client && Array.isArray(global.client.handleReply)) {
                for (const item of global.client.handleReply) {
                    if (item && String(item.messageID) === rawOtid) {
                        item.messageID = rawMid;
                        item.otid = rawOtid;
                    }
                }
            }

            if (global.client && Array.isArray(global.client.handleReaction)) {
                for (const item of global.client.handleReaction) {
                    if (item && String(item.messageID) === rawOtid) {
                        item.messageID = rawMid;
                        item.otid = rawOtid;
                    }
                }
            }
        }
    } else if (pName === "executefirstblockforsynctransactionv4" || pName === "executefirstblockforsynctransaction") {
        try {
            const db = utils.unwrapLsVal(args[0]);
            const epochId = utils.unwrapLsVal(args[1]);
            const cursor = utils.unwrapLsVal(args[3]) || utils.unwrapLsVal(args[2]);
            if (db != null && cursor && cursor !== "dummy_cursor" && cursor !== "-1") {
                if (typeof ctx._sendMqttSyncAck === "function") {
                    ctx._sendMqttSyncAck(db, epochId, cursor);
                }
            }
        } catch (err) {
            log.warn("LightspeedSync", "Lỗi ack sync cursor: " + (err.message || err));
        }
    } else if (pName === "upsertinboxthreadsrange" || pName === "deletetheninsertthread" || pName === "updateorinsertthread") {
        // Đồng bộ luồng tin nhắn/hộp thư từ Meta
    } else if (pName === "executefinallyblockforsynctransaction") {
        // Hoàn tất transaction sync
    }
}

function cacheMessageThread(ctx, messageID, threadID) {
    if (!messageID || !threadID || !ctx) return;
    if (!ctx.messageToThread) ctx.messageToThread = new Map();
    if (ctx.messageToThread.size > 5000) {
        var firstKey = ctx.messageToThread.keys().next().value;
        ctx.messageToThread.delete(firstKey);
    }
    ctx.messageToThread.set(String(messageID), String(threadID));
}

function parseDelta(defaultFuncs, api, ctx, globalCallback, { delta }) {
    if (delta.class === 'NewMessage') {
        if (ctx.globalOptions.pageID && ctx.globalOptions.pageID !== delta.queue) return;

        const resolveAttachmentUrl = (i) => {
            if (!delta.attachments || i === delta.attachments.length || utils.getType(delta.attachments) !== 'Array') {
                let fmtMsg;
                try {
                    fmtMsg = utils.formatDeltaMessage(delta);
                } catch (err) {
                    return log.error('Format Msg Error', err);
                }
                if (fmtMsg) {
                    try {
                        const md = delta.messageMetadata;
                        const mdata = delta.data?.prng ? JSON.parse(delta.data.prng) : [];
                        const body = fmtMsg.body || delta.body || "";
                        const mentions = {};
                        if (Array.isArray(mdata) && mdata.length > 0) {
                            for (const u of mdata) {
                                mentions[u.i] = body.substring(u.o, u.o + u.l);
                            }
                        } else {
                            const g = md?.data?.data?.Gb?.asMap?.data || md?.data?.Gb?.asMap?.data;
                            if (g) {
                                for (const key in g) {
                                    const m = g[key]?.asMap?.data || g[key];
                                    if (m?.id?.asLong && m?.offset?.asLong != null && m?.length?.asLong != null) {
                                        const id = m.id.asLong;
                                        const offset = parseInt(m.offset.asLong);
                                        const length = parseInt(m.length.asLong);
                                        mentions[id] = body.substring(offset, offset + length);
                                    }
                                }
                            }
                        }
                        fmtMsg.mentions = mentions;
                    } catch (e) {
                        log.error("Mention Parse Error", e);
                    }

                    const isGroup = fmtMsg.isGroup;
                    const threadID = fmtMsg.threadID;
                    const messageID = fmtMsg.messageID;
                    cacheMessageThread(ctx, messageID, threadID);
                    global.Fca.Data.event.set("Data", { isGroup, threadID, messageID });

                    if (global.Fca.Require.FastConfig.AntiGetInfo?.AntiGetThreadInfo) {
                        const currentCount = global.Fca.Data.MsgCount.get(fmtMsg.threadID) || 0;
                        global.Fca.Data.MsgCount.set(fmtMsg.threadID, currentCount + 1);
                    }

                    if (ctx.globalOptions.autoMarkDelivery) {
                        markDelivery(ctx, api, fmtMsg.threadID, fmtMsg.messageID);
                    }

                    if (!ctx.globalOptions.selfListen && fmtMsg.senderID === ctx.userID) {
                        return;
                    }
                    globalCallback(null, fmtMsg);
                }
            } else {
                const attachment = delta.attachments[i];
                if (attachment.mercury && attachment.mercury.attach_type === 'photo') {
                    api.resolvePhotoUrl(attachment.fbid, (err, url) => {
                        if (!err) attachment.mercury.metadata.url = url;
                        resolveAttachmentUrl(i + 1);
                    });
                } else {
                    resolveAttachmentUrl(i + 1);
                }
            }
        };

        resolveAttachmentUrl(0);
    } else if (delta.class === 'ClientPayload') {
        const clientPayload = utils.decodeClientPayload(delta.payload);
        if (clientPayload && clientPayload.deltas) {
            for (const cDelta of clientPayload.deltas) {
                if (cDelta.deltaMessageReaction && !!ctx.globalOptions.listenEvents) {
                    const messageReaction = {
                        type: 'message_reaction',
                        threadID: (cDelta.deltaMessageReaction.threadKey.threadFbId ? cDelta.deltaMessageReaction.threadKey.threadFbId : cDelta.deltaMessageReaction.threadKey.otherUserFbId).toString(),
                        messageID: cDelta.deltaMessageReaction.messageId,
                        reaction: cDelta.deltaMessageReaction.reaction,
                        senderID: cDelta.deltaMessageReaction.senderId.toString(),
                        userID: cDelta.deltaMessageReaction.userId.toString(),
                    };
                    globalCallback(null, messageReaction);
                } else if (cDelta.deltaRecallMessageData && !!ctx.globalOptions.listenEvents) {
                    const messageUnsend = {
                        type: 'message_unsend',
                        threadID: (cDelta.deltaRecallMessageData.threadKey.threadFbId ? cDelta.deltaRecallMessageData.threadKey.threadFbId : cDelta.deltaRecallMessageData.threadKey.otherUserFbId).toString(),
                        messageID: cDelta.deltaRecallMessageData.messageID,
                        senderID: cDelta.deltaRecallMessageData.senderID.toString(),
                        deletionTimestamp: cDelta.deltaRecallMessageData.deletionTimestamp,
                        timestamp: cDelta.deltaRecallMessageData.timestamp,
                    };
                    globalCallback(null, messageUnsend);
                } else if (cDelta.deltaMessageReply) {
                    const messageReplyData = cDelta.deltaMessageReply;
                    const mdata =
                        messageReplyData.message === undefined ? [] :
                        messageReplyData.message.data === undefined ? [] :
                        messageReplyData.message.data.prng === undefined ? [] :
                        JSON.parse(messageReplyData.message.data.prng);

                    const m_id = mdata.map((u) => u.i);
                    const m_offset = mdata.map((u) => u.o);
                    const m_length = mdata.map((u) => u.l);

                    const mentions = {};
                    for (let i = 0; i < m_id.length; i++) {
                        mentions[m_id[i]] = (messageReplyData.message.body || '').substring(m_offset[i], m_offset[i] + m_length[i]);
                    }

                    const callbackToReturn = {
                        type: 'message_reply',
                        threadID: (messageReplyData.message.messageMetadata.threadKey.threadFbId ? messageReplyData.message.messageMetadata.threadKey.threadFbId : messageReplyData.message.messageMetadata.threadKey.otherUserFbId).toString(),
                        messageID: messageReplyData.message.messageMetadata.messageId,
                        senderID: messageReplyData.message.messageMetadata.actorFbId.toString(),
                        attachments: (messageReplyData.message.attachments || [])
                            .map((att) => {
                                try {
                                    const mercury = JSON.parse(att.mercuryJSON);
                                    return Object.assign(att, mercury);
                                } catch(e) { return att; }
                            })
                            .map((att) => {
                                let x;
                                try {
                                    x = utils._formatAttachment(att);
                                } catch (ex) {
                                    x = att;
                                    x.error = ex;
                                    x.type = 'unknown';
                                }
                                return x;
                            }),
                        args: (messageReplyData.message.body || '').trim().split(/\s+/),
                        body: messageReplyData.message.body || '',
                        isGroup: !!messageReplyData.message.messageMetadata.threadKey.threadFbId,
                        mentions,
                        timestamp: parseInt(messageReplyData.message.messageMetadata.timestamp),
                        participantIDs: (messageReplyData.message.participants || []).map((e) => e.toString()),
                    };

                    if (messageReplyData.repliedToMessage) {
                        const r_mdata =
                            messageReplyData.repliedToMessage === undefined ? [] :
                            messageReplyData.repliedToMessage.data === undefined ? [] :
                            messageReplyData.repliedToMessage.data.prng === undefined ? [] :
                            JSON.parse(messageReplyData.repliedToMessage.data.prng);

                        const rm_id = r_mdata.map((u) => u.i);
                        const rm_offset = r_mdata.map((u) => u.o);
                        const rm_length = r_mdata.map((u) => u.l);

                        const rmentions = {};
                        for (let i = 0; i < rm_id.length; i++) {
                            rmentions[rm_id[i]] = (messageReplyData.repliedToMessage.body || '').substring(rm_offset[i], rm_offset[i] + rm_length[i]);
                        }

                        callbackToReturn.messageReply = {
                            threadID: (messageReplyData.repliedToMessage.messageMetadata.threadKey.threadFbId ? messageReplyData.repliedToMessage.messageMetadata.threadKey.threadFbId : messageReplyData.repliedToMessage.messageMetadata.threadKey.otherUserFbId).toString(),
                            messageID: messageReplyData.repliedToMessage.messageMetadata.messageId,
                            senderID: messageReplyData.repliedToMessage.messageMetadata.actorFbId.toString(),
                            attachments: (messageReplyData.repliedToMessage.attachments || [])
                                .map((att) => {
                                    try {
                                        const mercury = JSON.parse(att.mercuryJSON);
                                        return Object.assign(att, mercury);
                                    } catch(e) { return att; }
                                })
                                .map((att) => {
                                    let x;
                                    try {
                                        x = utils._formatAttachment(att);
                                    } catch (ex) {
                                        x = att;
                                        x.error = ex;
                                        x.type = 'unknown';
                                    }
                                    return x;
                                }),
                            args: (messageReplyData.repliedToMessage.body || '').trim().split(/\s+/),
                            body: messageReplyData.repliedToMessage.body || '',
                            isGroup: !!messageReplyData.repliedToMessage.messageMetadata.threadKey.threadFbId,
                            mentions: rmentions,
                            timestamp: parseInt(messageReplyData.repliedToMessage.messageMetadata.timestamp),
                            participantIDs: (messageReplyData.repliedToMessage.participants || []).map((e) => e.toString()),
                        };
                    } else if (messageReplyData.replyToMessageId) {
                        callbackToReturn.messageReply = {
                            type: 'Message',
                            threadID: callbackToReturn.threadID,
                            messageID: messageReplyData.replyToMessageId.id,
                            senderID: "",
                            attachments: [],
                            args: [],
                            body: '',
                            isGroup: callbackToReturn.isGroup,
                            mentions: {},
                            timestamp: Date.now()
                        };
                    } else {
                        callbackToReturn.delta = cDelta;
                    }

                    if (ctx.globalOptions.autoMarkDelivery) {
                        markDelivery(ctx, api, callbackToReturn.threadID, callbackToReturn.messageID);
                    }

                    if (!ctx.globalOptions.selfListen && callbackToReturn.senderID === ctx.userID) return;
                    globalCallback(null, callbackToReturn);
                }
            }
            return;
        }
    }

    switch (delta.class) {
        case 'ReadReceipt': {
            try {
                const fmtMsg = utils.formatDeltaReadReceipt(delta);
                globalCallback(null, fmtMsg);
            } catch (err) {
                log.error('Format Error', err);
            }
            break;
        }
        case 'AdminTextMessage': {
            switch (delta.type) {
                case 'change_thread_quick_reaction': {
                    try {
                        let threadID = delta.messageMetadata?.threadKey?.threadFbId || delta.messageMetadata?.threadKey?.otherUserFbId;
                        let userID = delta.messageMetadata?.actorFbId;
                        let emoji = delta.untypedData?.thread_quick_reaction_emoji || delta.untypedData?.thread_icon;
                        if (threadID && userID && emoji) {
                            globalCallback(null, {
                                type: "event",
                                threadID: threadID.toString(),
                                author: userID.toString(),
                                logMessageType: "log:thread-icon",
                                logMessageData: { thread_icon: emoji }
                            });
                        }
                    } catch (err) {
                        log.error('[EMOJI-TRAP]', err);
                    }
                    break;
                }
                case 'joinable_group_link_mode_change':
                case 'magic_words':
                case 'pin_messages_v2':
                case 'change_thread_theme':
                case 'change_thread_icon':
                case 'change_thread_nickname':
                case 'change_thread_admins':
                case 'change_thread_approval_mode':
                case 'group_poll':
                case 'messenger_call_log':
                case 'participant_joined_group_call': {
                    try {
                        const fmtMsg = utils.formatDeltaEvent(delta);
                        globalCallback(null, fmtMsg);
                    } catch (err) {
                        log.error('Admin Event Format Error', err);
                    }
                    break;
                }
                default: {
                    try {
                        if (delta.adminText && (
                            delta.adminText.toLowerCase().includes('emoji') ||
                            delta.adminText.toLowerCase().includes('biểu tượng cảm xúc') ||
                            delta.adminText.toLowerCase().includes('đã thay đổi biểu tượng')
                        )) {
                            let threadID = delta.messageMetadata?.threadKey?.threadFbId || delta.messageMetadata?.threadKey?.otherUserFbId;
                            let userID = delta.messageMetadata?.actorFbId || delta.actorFbId;
                            let icon = "👍";
                            const matchEmoji = delta.adminText.match(/đã thay đổi biểu tượng cảm xúc nhóm thành (.+?)\./) ||
                                            delta.adminText.match(/changed the group emoji to (.+?)\./) ||
                                            delta.adminText.match(/đã thay đổi biểu tượng thành (.+?)\./);
                            if (matchEmoji?.[1]) icon = matchEmoji[1].trim();
                            if (threadID && userID) {
                                globalCallback(null, {
                                    type: "event",
                                    threadID: threadID.toString(),
                                    author: userID.toString(),
                                    logMessageType: "log:thread-icon",
                                    logMessageData: { thread_icon: icon }
                                });
                            }
                        }
                    } catch (err) {
                        log.error('[EMOJI-TRAP]', err);
                    }
                    break;
                }
            }
            break;
        }
        case 'ForcedFetch': {
            break;
        }
        case 'ThreadName':
        case 'ParticipantsAddedToGroupThread':
        case 'ParticipantLeftGroupThread': {
            try {
                const formattedEvent = utils.formatDeltaEvent(delta);
                if (!ctx.globalOptions.selfListen && formattedEvent.author.toString() === ctx.userID) return;
                if (!ctx.loggedIn) return;
                globalCallback(null, formattedEvent);
            } catch (err) {
                log.error('Format Event Error', err);
            }
            break;
        }
        case 'NewMessage': {
            const hasLiveLocation = (d) => {
                const attachment = d.attachments?.[0]?.mercury?.extensible_attachment;
                const storyAttachment = attachment?.story_attachment;
                return storyAttachment?.style_list?.includes('message_live_location');
            };
            if (delta.attachments?.length === 1 && hasLiveLocation(delta)) {
                delta.class = 'UserLocation';
                try {
                    const fmtMsg = utils.formatDeltaEvent(delta);
                    globalCallback(null, fmtMsg);
                } catch (err) {
                    log.error('Location Parse Error', err);
                }
            }
            break;
        }
    }
}

function markDelivery(ctx, api, threadID, messageID) {
    if (threadID && messageID) {
        api.markAsDelivered(threadID, messageID, (err) => {
            if (err) {
                log.error('markAsDelivered', err);
            } else if (ctx.globalOptions.autoMarkRead && typeof api.markAsRead === 'function') {
                api.markAsRead(threadID, (errRead) => {
                    if (errRead) log.error('markAsRead', errRead);
                });
            }
        });
    }
}

function getRespData(Type, payload) {
    try {
        switch (Type) {
            case "sendMqttMessage": {
                return {
                    type: Type,
                    threadID: payload.step[1][2][2][1][2],
                    messageID: payload.step[1][2][2][1][3],
                    payload: payload.step[1][2]
                };
            }
            default: {
                return {
                    Data: payload.step[1][2][2][1],
                    type: Type,
                    payload: payload.step[1][2]
                };
            }
        }
    } catch (e) {
        return null;
    }
}

if (global.Fca.Require.FastConfig.AntiGetInfo?.AntiGetThreadInfo) {
    setInterval(() => {
        try {
            const { updateMessageCount, getData, hasData } = require('../shiina/Extra/Shiina-GetThread');
            const Data = global.Fca.Data.MsgCount;
            const Arr = Array.from(Data.keys());
            for (let i of Arr) {
                const Count = parseInt(Data.get(i));
                if (hasData(i)) {
                    let x = getData(i);
                    x.messageCount += Count;
                    updateMessageCount(i, x);
                    Data.delete(i);
                }
            }
        } catch (e) {
            log.error('AntiGetThreadInfo Sync', e.message);
        }
    }, 30 * 1000);
}

module.exports = function(defaultFuncs, api, ctx) {
    var globalCallback = identity;

    getSeqID = function(forceRefresh = false) {
        ctx.t_mqttCalled = false;
        ctx.lastSeqId = "0";
        return listenMqtt(defaultFuncs, api, ctx, globalCallback);
    };

    return function(callback) {
        class MessageEmitter extends EventEmitter {
            stopListening(cb) {
                cb = cb || (() => {});
                globalCallback = identity;
                if (ctx.gatewayClient) {
                    try {
                        ctx.gatewayClient.close();
                    } catch (_) {}
                    ctx.gatewayClient = null;
                }
                if (ctx.mqttClient) {
                    ctx.mqttClient.unsubscribe("/webrtc");
                    ctx.mqttClient.unsubscribe("/rtc_multi");
                    ctx.mqttClient.unsubscribe("/onevc");
                    ctx.mqttClient.publish("/browser_close", "{}");
                    ctx.mqttClient.end(false, function(...data) {
                        ctx.mqttClient = undefined;
                        cb(data);
                    });
                }
                global.Fca.Data.StopListening = true;
                global.Fca.Data.Setup = false;
                global.Fca.Data.AutoRefreshTimerInstalled = false;
            }
        }

        var msgEmitter = new MessageEmitter();
        globalCallback = (callback || function(error, message) {
            if (error) return msgEmitter.emit("error", error);
            msgEmitter.emit("message", message);
        });

        if (!ctx.firstListen) ctx.lastSeqId = null;
        ctx.syncToken = undefined;
        ctx.t_mqttCalled = false;

        if (!ctx.firstListen || !ctx.lastSeqId) getSeqID(true);
        else listenMqtt(defaultFuncs, api, ctx, globalCallback);
        ctx.firstListen = false;

        return msgEmitter;
    };
};

const safeExitHandler = () => {
    log.info('System', 'Đang tiến hành lưu Uptime và ngắt kết nối an toàn...');
    if (global.mqttClient) {
        global.mqttClient.end();
    }
    LogUptime();
    process.exit();
};

if (!process.listenerCount('SIGINT')) {
    process.on('SIGINT', safeExitHandler);
}

if (!process.listenerCount('exit')) {
    process.on('exit', () => {
        LogUptime();
    });
}
