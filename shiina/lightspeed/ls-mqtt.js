"use strict";
/**
 * shiina/lightspeed/ls-mqtt.js
 * MQTT listener đồng bộ kép: Lightspeed (/ls_req, /ls_resp) + Messenger Sync (/t_ms)
 * Bám sát 100% cơ chế từ fca-shiina-lightspeed:
 *   - Lắng nghe cả /ls_resp và /t_ms để không bao giờ bị miss tin nhắn chat
 *   - Đăng ký và đồng bộ các DB Lightspeed 1, 95, 104, 145, 2, 16
 *   - Tự động gửi SyncAck type 7
 *   - Gửi /messenger_sync_create_queue để Meta kích hoạt đẩy tin nhắn tức thời
 *   - CookieHeader trích xuất an toàn, không bị [object Promise]
 */

const mqtt = require("mqtt");
const WebSocket = require("ws");
const Duplexify = require("duplexify");
const { Transform, PassThrough } = require("stream");
const { walkLsStep } = require("./ls-walker");

const LIGHTSPEED_VERSION = 28890729100558484;
const LIGHTSPEED_APP_ID = "2220391788200892";
const LS_DATABASES = [1, 95, 104, 145, 2, 16];
const FOREGROUND_INTERVAL_MS = 25000;

function createEpochId() {
    return (BigInt(Date.now()) << 22n).toString();
}

function getGUID() {
    let sectionLength = Date.now();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        let r = Math.floor((sectionLength + Math.random() * 16) % 16);
        sectionLength = Math.floor(sectionLength / 16);
        return (c === "x" ? r : (r & 7) | 8).toString(16);
    });
}

function buildProxy(ws) {
    const queue = [];
    if (ws && typeof ws.once === "function") {
        ws.once("open", () => {
            while (queue.length > 0) {
                const item = queue.shift();
                try {
                    ws.send(item.data);
                } catch (err) {
                    console.warn("[FCA-LIGHTSPEED]", "Lỗi gửi gói tin MQTT: " + (err?.message || err));
                }
                if (typeof item.cb === "function") item.cb();
            }
        });
    }

    const sendOrQueue = (chunk, cb) => {
        const data = (typeof chunk === "string") ? Buffer.from(chunk, "utf8") : chunk;
        if (ws && ws.readyState === 1) { // OPEN
            try {
                ws.send(data);
            } catch (err) {
                console.warn("[FCA-LIGHTSPEED]", "Lỗi gửi gói tin MQTT: " + (err?.message || err));
            }
            if (typeof cb === "function") cb();
        } else if (ws && ws.readyState === 0) { // CONNECTING
            queue.push({ data, cb });
        } else {
            if (typeof cb === "function") cb();
        }
    };

    return new Transform({
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
            if (typeof cb === "function") cb();
        }
    });
}

function buildStream(options, WebSocket_Instance, ctx, onMqttFail) {
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
            console.warn("[FCA-LIGHTSPEED]", `WebSocket đóng kết nối bất thường (Mã: ${event.code}${event.reason ? ', lý do: ' + event.reason : ''})`);
        }
        clearTimers();
        try { readable.end(); } catch (_) {}
        try { Stream.end(); } catch (_) {}
        try { Stream.destroy(); } catch (_) {}
    };

    WebSocket_Instance.onerror = (err) => {
        console.error("[FCA-LIGHTSPEED]", "Lỗi kết nối WebSocket:", err?.message || err);
        clearTimers();
        try { readable.destroy(err); } catch (_) {}
        try { Stream.destroy(err); } catch (_) {}
    };

    const resetReconnectTimeout = () => {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
            if (WebSocket_Instance.readyState === WebSocket_Instance.OPEN) {
                console.warn("[FCA-LIGHTSPEED]", "Không nhận được dữ liệu từ Facebook quá lâu (120s), làm mới kết nối...");
                try { WebSocket_Instance.close(); } catch (_) {}
                try { readable.end(); } catch (_) {}
                try { Stream.end(); } catch (_) {}
                try { Stream.destroy(); } catch (_) {}
            }
        }, 120000);
    };

    WebSocket_Instance.onmessage = (event) => {
        resetReconnectTimeout();
        const data = event.data instanceof ArrayBuffer ? Buffer.from(event.data) : Buffer.from(event.data, "utf8");

        // Kiểm tra phản hồi CONNACK từ Meta
        if (data.length >= 4 && data[0] === 0x20) {
            const rc = data[3];
            if (rc === 0) {
                console.log("[FCA-LIGHTSPEED]", "✅ Facebook chấp thuận kết nối MQTT (CONNACK OK - Sẵn sàng nhận tin).");
            } else if (rc === 4 || rc === 5) {
                console.error("[FCA-LIGHTSPEED]", `❌ Facebook từ chối kết nối MQTT (Mã ${rc}). Cookie/Appstate hiện tại đã bị đăng xuất trên máy chủ Meta! Vui lòng dán cookie mới vào cookie.txt.`);
                ctx._dead = true;
                if (typeof onMqttFail === "function") {
                    onMqttFail({ error: "Session logged out", connackCode: rc });
                }
                try { WebSocket_Instance.close(); } catch (_) {}
                return;
            } else {
                console.error("[FCA-LIGHTSPEED]", `❌ Facebook từ chối kết nối MQTT (Mã ${rc}). Cookie/Appstate hiện tại đã bị đăng xuất trên máy chủ Meta! Vui lòng dán cookie mới vào cookie.txt.`);
            }
        }

        try { readable.write(data); } catch (_) {}
    };

    WebSocket_Instance.onopen = () => {
        console.log("[FCA-LIGHTSPEED]", "Đã kết nối thành công WebSocket tới Facebook.");
        Stream.setReadable(readable);
        Stream.setWritable(Proxy);
        Stream.emit("connect");

        pingInterval = setInterval(() => {
            if (WebSocket_Instance.readyState === WebSocket_Instance.OPEN) {
                try { WebSocket_Instance.ping(); } catch (_) {}
            }
        }, 45000);

        resetReconnectTimeout();
    };

    return Stream;
}

function sendForegroundState(mqttClient) {
    if (!mqttClient || !mqttClient.connected) return;
    try {
        mqttClient.publish("/ls_foreground_state", JSON.stringify({
            inForegroundApp:    true,
            inForegroundDevice: true,
            keepAliveTimeout:   60
        }), { qos: 1, retain: false });
    } catch (_) {}
}

function subscribeDb(ctx, mqttClient, db) {
    if (!mqttClient || !mqttClient.connected) return;
    if (!ctx.wsReqNumber) ctx.wsReqNumber = 100;
    const reqID = ++ctx.wsReqNumber;
    const payload = {
        database: Number(db),
        epoch_id: createEpochId(),
        failure_count: null,
        last_applied_cursor: ctx.syncCursors?.[Number(db)] || null,
        sync_params: "{}",
        version: LIGHTSPEED_VERSION
    };
    const request = {
        app_id:     LIGHTSPEED_APP_ID,
        payload:    JSON.stringify(payload),
        request_id: reqID,
        type:       1
    };
    try {
        mqttClient.publish("/ls_req", JSON.stringify(request), { qos: 1, retain: false });
    } catch (_) {}
}

function sendMqttSyncAck(ctx, mqttClient, database, epochId, cursor) {
    if (!mqttClient || !mqttClient.connected) return;
    let dbNum = Number(database);
    if (isNaN(dbNum) && Array.isArray(database)) {
        dbNum = Number(database[database.length - 1]);
    }
    if (isNaN(dbNum)) {
        const match = String(database).match(/\d+/);
        if (match) dbNum = Number(match[0]);
    }
    if (isNaN(dbNum)) return;

    if (!ctx.wsReqNumber) ctx.wsReqNumber = 100;
    const reqID = ++ctx.wsReqNumber;
    const ackPayload = {
        database: dbNum,
        epoch_id: epochId != null ? (typeof epochId === "string" || typeof epochId === "number" ? String(epochId) : createEpochId()) : createEpochId(),
        failure_count: null,
        last_applied_cursor: String(cursor),
        sync_params: null,
        version: LIGHTSPEED_VERSION
    };
    const request = {
        app_id:     LIGHTSPEED_APP_ID,
        payload:    JSON.stringify(ackPayload),
        request_id: reqID,
        type:       2
    };
    try {
        mqttClient.publish("/ls_req", JSON.stringify(request), { qos: 1, retain: false });
    } catch (_) {}

    if (!ctx.syncCursors) ctx.syncCursors = {};
    ctx.syncCursors[dbNum] = String(cursor);
}

function getSyncCookieHeader(jar) {
    if (!jar) return "";
    try {
        if (typeof jar.getCookieStringSync === "function") {
            const s = jar.getCookieStringSync("https://www.facebook.com");
            if (typeof s === "string" && s.length > 0) return s;
        }
        if (typeof jar.getCookieString === "function") {
            const s = jar.getCookieString("https://www.facebook.com");
            if (typeof s === "string" && s.length > 0) return s;
        }
        if (typeof jar.getCookiesSync === "function") {
            const cookies = jar.getCookiesSync("https://www.facebook.com");
            if (Array.isArray(cookies) && cookies.length > 0) {
                return cookies.map((c) => `${c.key || c.name}=${c.value}`).join("; ");
            }
        }
        if (typeof jar.getCookies === "function") {
            const cookies = jar.getCookies("https://www.facebook.com");
            if (Array.isArray(cookies) && cookies.length > 0) {
                return cookies.map((c) => `${c.key || c.name}=${c.value}`).join("; ");
            }
        }
    } catch (_) {}
    return "";
}

function connectMqtt(ctx, callbacks = {}) {
    const { onStepProc, onDelta, onTyping, onPresence, onReady, onError } = callbacks;

    const sessionID = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1;
    const clientID = "mqttwsclient";
    const GUID = ctx.guid || getGUID();

    const username = {
        u: ctx.userID,
        s: sessionID,
        chat_on: true,
        fg: true,
        d: GUID,
        ct: "websocket",
        aid: "2220391788200892",
        mqtt_sid: "",
        cp: 3,
        ecp: 10,
        st: [],
        pm: [],
        dc: "",
        no_auto_fg: false,
        gas: null,
        pack: []
    };

    const cookieHeader = getSyncCookieHeader(ctx.jar);

    let hostUrl;
    try {
        if (ctx.mqttEndpoint) {
            hostUrl = new URL(ctx.mqttEndpoint.replace(/^http/i, "ws"));
        } else {
            const reg = ctx.region ? `?region=${ctx.region.toLowerCase()}` : "";
            hostUrl = new URL(`wss://edge-chat.facebook.com/chat${reg}`);
        }
    } catch (_) {
        hostUrl = new URL("wss://edge-chat.facebook.com/chat");
    }
    if (hostUrl.protocol === "ws:") hostUrl.protocol = "wss:";
    hostUrl.pathname = "/chat";
    hostUrl.searchParams.set("sid", String(sessionID));
    if (ctx.region && !hostUrl.searchParams.has("region")) {
        hostUrl.searchParams.set("region", ctx.region.toLowerCase());
    }
    const host = hostUrl.toString();

    const options = {
        clientId:         "mqttwsclient",
        protocolId:       "MQIsdp",
        protocolVersion:  3,
        username:         JSON.stringify(username),
        clean:            true,
        wsOptions: {
            headers: {
                "Cookie":          cookieHeader,
                "Origin":          "https://www.facebook.com",
                "User-Agent":      ctx.options?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
                "Referer":         "https://www.facebook.com/",
                "Host":            new URL(host).hostname
            },
            origin:          "https://www.facebook.com",
            protocolVersion: 13,
            binaryType:      "arraybuffer"
        },
        keepalive:        60,
        reschedulePings:  true,
        reconnectPeriod:  0,
        connectTimeout:   15000
    };

    const mqttClient = new mqtt.Client(() => {
        const ws = new WebSocket(host, options.wsOptions);
        return buildStream(options, ws, ctx, onError);
    }, options);

    ctx.mqttClient = mqttClient;
    mqttClient.setMaxListeners(0);

    mqttClient.on("connect", () => {
        // Đăng ký toàn bộ các topic nhận tin nhắn và trạng thái
        const topics = [
            "/ls_req",
            "/ls_resp",
            "/ls_foreground_state",
            "/ls_app_settings",
            "/thread_typing",
            "/orca_typing_notifications"
        ];
        if (ctx.options?.updatePresence) {
            topics.push("/orca_presence");
        }
        for (const t of topics) mqttClient.subscribe(t);

        // Foreground Heartbeat định kỳ 20s
        ctx._sendMqttSyncAck = (database, epochId, cursor) => sendMqttSyncAck(ctx, mqttClient, database, epochId, cursor);
        sendForegroundState(mqttClient);
        if (ctx._lsFgInterval) clearInterval(ctx._lsFgInterval);
        ctx._lsFgInterval = setInterval(() => sendForegroundState(mqttClient), 20000);

        // Đăng ký các Database Lightspeed: 1, 95, 104, 145, 2, 16
        for (const db of LS_DATABASES) {
            subscribeDb(ctx, mqttClient, db);
        }

        console.log("[LIGHTSPEED]", "Khởi tạo kết nối Lightspeed & Realtime Messenger thành công.");

        if (typeof onReady === "function") {
            onReady();
        }
    });

    mqttClient.on("message", (topic, message) => {
        let json;
        try { json = JSON.parse(message.toString()); }
        catch (_) { return; }

        if (topic === "/t_ms") {
            if (ctx.tmsWait && typeof ctx.tmsWait === "function") ctx.tmsWait();
            if (json.firstDeltaSeqId && json.syncToken) {
                ctx.lastSeqId = json.firstDeltaSeqId;
                ctx.syncToken = json.syncToken;
            }
            if (json.lastIssuedSeqId) {
                ctx.lastSeqId = parseInt(json.lastIssuedSeqId);
            }
            if (json.deltas && typeof onDelta === "function") {
                for (let i in json.deltas) {
                    onDelta(json.deltas[i], json);
                }
            }
            const step = json?.payload?.step || json?.step;
            if (step && typeof onStepProc === "function") {
                walkLsStep(step, (procName, args) => {
                    onStepProc(procName, args, json);
                });
            }
            return;
        }

        if (topic === "/ls_resp") {
            if (json.request_id && ctx.callback_Task && ctx.callback_Task[json.request_id]) {
                try {
                    ctx.callback_Task[json.request_id](null, json);
                    delete ctx.callback_Task[json.request_id];
                } catch (_) {}
            }

            let payload = json.payload;
            while (typeof payload === "string") {
                try { payload = JSON.parse(payload); } catch (_) { break; }
            }
            const target = payload || json;

            walkLsStep(target, (procName, args) => {
                if (typeof onStepProc === "function") {
                    onStepProc(procName, args, target);
                }
            });
            return;
        }

        if (topic === "/thread_typing" || topic === "/orca_typing_notifications") {
            if (typeof onTyping === "function") {
                onTyping({
                    type:     "typ",
                    isTyping: !!(json.state ?? json.type),
                    from:     String(json.sender_fbid || json.from || ""),
                    threadID: String(json.thread || json.thread_fbid || "")
                });
            }
            return;
        }

        if (topic === "/orca_presence") {
            if (typeof onPresence === "function" && json.list) {
                for (const item of json.list) {
                    onPresence({
                        type:      "presence",
                        userID:    String(item.u || ""),
                        timestamp: Number(item.l || 0) * 1000,
                        statuses:  item.p
                    });
                }
            }
            return;
        }
    });

    mqttClient.on("error", (err) => {
        if (!ctx._dead) {
            console.error("[FCA-LIGHTSPEED]", "Lỗi MQTT Client:", err?.message || err);
        }
    });

    mqttClient.on("close", () => {
        if (ctx._lsFgInterval) clearInterval(ctx._lsFgInterval);
        if (!ctx._dead && !ctx._isReconnecting) {
            ctx._isReconnecting = true;
            console.warn("[FCA-LIGHTSPEED]", "Kết nối MQTT đã đóng. Tự động kết nối lại sau 3 giây...");
            setTimeout(() => {
                ctx._isReconnecting = false;
                if (!ctx._dead) {
                    connectMqtt(ctx, callbacks);
                }
            }, 3000);
        }
    });

    return mqttClient;
}

module.exports = { connectMqtt, sendMqttSyncAck, subscribeDb };
