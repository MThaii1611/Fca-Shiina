"use strict";

const EventEmitter = require("events");
const WebSocket = require("ws");
const { walkLsStep, unwrapLsVal } = require("../lightspeed/ls-walker");
const logger = require("../logger");

// DGW Constants
const APP_ID = "2220391788200892";
const GATEWAY_HOST = "gateway.facebook.com";
const DGW_VERSION = "5";
const DGW_TIER = "prod";
const DEFAULT_REGION = "EAG";
const DEFAULT_KEEPALIVE_MS = 20000;
const LIGHTSPEED_VERSION = 28890729100558484;

// DGW Opcodes
const OP_ACK = 0x0c;
const OP_DATA = 0x0d;
const OP_HEARTBEAT = 0x0e;
const OP_META = 0x0f;
const APP_PING = 0x09;
const APP_PONG = 0x0a;

function getGUID() {
    let sectionLength = Date.now();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        let r = Math.floor((sectionLength + Math.random() * 16) % 16);
        sectionLength = Math.floor(sectionLength / 16);
        return (c === "x" ? r : (r & 7) | 8).toString(16);
    });
}

/**
 * Builds a binary DGW packet
 */
function buildPacket(opcode, streamID, payloadBuffer) {
    const payloadLen = payloadBuffer ? payloadBuffer.length : 0;
    const buf = Buffer.alloc(6 + payloadLen);
    buf.writeUInt8(opcode, 0);
    buf.writeUInt16LE(streamID, 1);
    buf.writeUIntLE(payloadLen, 3, 3); // 24-bit unsigned LE
    if (payloadBuffer && payloadLen > 0) {
        payloadBuffer.copy(buf, 6);
    }
    return buf;
}

function buildHeartbeat(streamID = 0) {
    const buf = Buffer.alloc(3);
    buf.writeUInt8(OP_HEARTBEAT, 0);
    buf.writeUInt16LE(streamID, 1);
    return buf;
}

function buildAppPing() {
    return Buffer.from([APP_PING]);
}

function buildAppPong() {
    return Buffer.from([APP_PONG]);
}

function buildAck(streamID, seq) {
    return buildPacket(OP_ACK, streamID, Buffer.from([seq, 0x00]));
}

function buildMeta(streamID, headersObj) {
    const jsonStr = JSON.stringify(headersObj || {});
    return buildPacket(OP_META, streamID, Buffer.from(jsonStr, "utf8"));
}

function buildData(streamID, jsonPayload, seq = 0) {
    const payloadStr = typeof jsonPayload === "string" ? jsonPayload : JSON.stringify(jsonPayload);
    const strLen = Buffer.byteLength(payloadStr, "utf8");
    const body = Buffer.alloc(2 + strLen);
    body.writeUInt8(seq, 0);
    body.writeUInt8(0x80, 1);
    body.write(payloadStr, 2, "utf8");
    return buildPacket(OP_DATA, streamID, body);
}

/**
 * Parses binary buffer into DGW frames
 */
function parseFrames(input) {
    if (!Buffer.isBuffer(input)) {
        input = Buffer.from(input);
    }
    const frames = [];
    let i = 0;
    while (i < input.length) {
        const opcode = input[i];
        if (opcode === APP_PING || opcode === APP_PONG) {
            frames.push({
                kind: opcode === APP_PING ? "ping" : "pong",
                opcode,
                offset: i,
                size: 1
            });
            i += 1;
            continue;
        }
        if (opcode === OP_HEARTBEAT) {
            if (input.length - i < 3) break;
            const streamID = input.readUInt16LE(i + 1);
            frames.push({
                kind: "heartbeat",
                opcode,
                streamID,
                payload: Buffer.alloc(0),
                offset: i,
                size: 3
            });
            i += 3;
            continue;
        }
        if (input.length - i < 6) break;
        const streamID = input.readUInt16LE(i + 1);
        const length = input.readUIntLE(i + 3, 3);
        const payloadStart = i + 6;
        if (length > input.length - payloadStart) break;
        const payloadEnd = payloadStart + length;
        let payload = input.slice(payloadStart, payloadEnd);
        let seq = 0;
        if (opcode === OP_DATA && payload.length >= 2 && (payload[1] === 0x80 || payload[1] === 0x00)) {
            seq = payload[0];
            payload = payload.slice(2);
        }
        frames.push({
            kind: opcode === OP_DATA ? "data" : opcode === OP_META ? "meta" : opcode === OP_ACK ? "ack" : "unknown",
            opcode,
            streamID,
            seq,
            payload,
            offset: i,
            size: 6 + length
        });
        i = payloadEnd;
    }
    return frames;
}

/**
 * Builds the DGW WebSocket connection URL for Lightspeed
 */
function buildGatewayUrl(options = {}) {
    const uuid = options.uuid || getGUID();
    const loggingId = options.loggingId || getGUID();
    const deviceId = options.deviceId || getGUID();
    const regionHint = options.regionHint || DEFAULT_REGION;

    const params = new URLSearchParams({
        "x-dgw-appid": APP_ID,
        "x-dgw-appversion": "0",
        "x-dgw-authtype": "1:0",
        "x-dgw-version": DGW_VERSION,
        "x-dgw-uuid": uuid,
        "x-dgw-tier": DGW_TIER,
        "x-dgw-loggingid": loggingId,
        "x-dgw-regionhint": regionHint,
        "x-dgw-deviceid": deviceId
    });

    return `wss://${GATEWAY_HOST}/ws/lightspeed?${params.toString()}`;
}

/**
 * Lightspeed Gateway Client
 */
class DgwGatewayClient extends EventEmitter {
    constructor(ctx, options = {}) {
        super();
        this.ctx = ctx;
        this.options = options;
        this.ws = null;
        this.connected = false;
        this.closedManually = false;
        this.seq = 0;
        this.nextStreamID = 20;
        this.pingInterval = null;
        this.heartbeatInterval = null;
        this.pendingRequests = new Map();
        this.subscribedDatabases = new Map();
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return Promise.resolve();
        }

        this.closedManually = false;
        let cookieStr = "";
        try {
            if (this.ctx.jar?.getCookieStringSync) {
                cookieStr = this.ctx.jar.getCookieStringSync("https://www.facebook.com") || "";
            } else if (this.ctx.jar?.getCookieString) {
                cookieStr = this.ctx.jar.getCookieString("https://www.facebook.com") || "";
            } else if (this.ctx.jar?.getCookiesSync) {
                cookieStr = this.ctx.jar.getCookiesSync("https://www.facebook.com").map(c => `${c.key || c.name}=${c.value}`).join("; ");
            }
        } catch (_) {}

        const url = buildGatewayUrl({ ...this.options, uuid: this.ctx?.userID || this.options.uuid });

        const wsOptions = {
            headers: {
                "Cookie": cookieStr,
                "Origin": "https://www.facebook.com",
                "User-Agent": this.ctx.options?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": "https://www.facebook.com/",
                "Host": GATEWAY_HOST
            },
            perMessageDeflate: true
        };

        return new Promise((resolve, reject) => {
            let settled = false;

            try {
                this.ws = new WebSocket(url, wsOptions);
            } catch (err) {
                return reject(err);
            }

            this.ws.on("open", () => {
                this.connected = true;
                console.log("[DGW]", "Đã kết nối thành công tới gateway.facebook.com/ws/lightspeed");
                this.startKeepalive();
                this.bootstrap();
                if (!settled) {
                    settled = true;
                    resolve();
                }
                this.emit("open");
            });

            this.ws.on("message", (data) => {
                this.handleMessage(data);
            });

            this.ws.on("error", (err) => {
                console.error("[DGW]", "WebSocket Error: " + (err.message || err));
                this.emit("error", err);
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            });

            this.ws.on("close", (code, reason) => {
                this.connected = false;
                this.stopKeepalive();
                console.warn("[DGW]", `Kết nối Gateway đã đóng (${code}: ${reason || "none"})`);
                this.emit("close", { code, reason });

                for (const [id, req] of this.pendingRequests) {
                    req.reject(new Error("Gateway connection closed (" + code + ")"));
                }
                this.pendingRequests.clear();

                if (code >= 4000 && code < 4100) {
                    console.log("[DGW]", `DGW yêu cầu xác thực riêng (mã ${code}), tiếp tục nhận gói tin đồng bộ qua Edge MQTT.`);
                    return;
                }

                if (!this.closedManually && this.ctx.options?.autoReconnect !== false) {
                    setTimeout(() => {
                        if (!this.closedManually) {
                            this.connect().catch(() => {});
                        }
                    }, 10000);
                }
            });
        });
    }

    startKeepalive() {
        this.stopKeepalive();
        this.pingInterval = setInterval(() => {
            if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(buildAppPing());
            }
        }, DEFAULT_KEEPALIVE_MS);

        this.heartbeatInterval = setInterval(() => {
            if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(buildHeartbeat(0));
            }
        }, DEFAULT_KEEPALIVE_MS);
    }

    stopKeepalive() {
        if (this.pingInterval) clearInterval(this.pingInterval);
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.pingInterval = null;
        this.heartbeatInterval = null;
    }

    bootstrap() {
        // 1. Send Meta headers on Stream 0 (Falco session handshake)
        this.sendRaw(buildMeta(0, { "x-dgw-app-XRSS-method": "Falco" }));
    }

    subscribeDatabase(database, streamID) {
        if (!this.ctx.wsReqNumber) this.ctx.wsReqNumber = 100;
        const reqID = ++this.ctx.wsReqNumber;
        const epoch = (BigInt(Date.now()) << 22n).toString();

        const subscribePayload = {
            database: Number(database),
            epoch_id: epoch,
            failure_count: null,
            last_applied_cursor: null,
            sync_params: "{}",
            version: LIGHTSPEED_VERSION
        };

        const outer = {
            app_id: APP_ID,
            payload: JSON.stringify(subscribePayload),
            request_id: reqID,
            type: 1 // Subscribe
        };

        this.subscribedDatabases.set(Number(database), streamID);
        const dataPacket = buildData(streamID, outer, this.nextSeq());
        this.sendRaw(dataPacket);
    }

    nextSeq() {
        this.seq = (this.seq + 1) & 0xff;
        return this.seq;
    }

    sendRaw(buffer) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(buffer);
                return true;
            } catch (_) {
                return false;
            }
        }
        return false;
    }

    handleMessage(data) {
        const frames = parseFrames(data);
        for (const frame of frames) {
            if (frame.kind === "ping") {
                this.sendRaw(buildAppPong());
                continue;
            }
            if (frame.kind === "heartbeat") {
                this.sendRaw(buildHeartbeat(frame.streamID));
                continue;
            }
            if (frame.kind === "data") {
                // Send Ack
                this.sendRaw(buildAck(frame.streamID, frame.seq));

                try {
                    const text = frame.payload.toString("utf8");
                    const jsonMsg = JSON.parse(text);
                    this.processIncomingJson(jsonMsg, frame.streamID);
                } catch (e) {
                    // Ignore non-json
                }
            }
        }
    }

    processIncomingJson(jsonMsg, streamID) {
        if (jsonMsg.request_id && this.pendingRequests.has(jsonMsg.request_id)) {
            const { resolve } = this.pendingRequests.get(jsonMsg.request_id);
            this.pendingRequests.delete(jsonMsg.request_id);
            resolve(jsonMsg);
            return;
        }

        this.emit("data", { json: jsonMsg, streamID });

        const step = jsonMsg.payload?.step || jsonMsg.step;
        if (step) {
            walkLsStep(step, (procName, args) => {
                this.emit("stepProc", { procName, args, streamID, raw: jsonMsg });
            });
        }
    }

    sendSyncAck(database, epochId, cursor, streamID) {
        if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        let dbNum = Number(database);
        if (isNaN(dbNum) && Array.isArray(database)) dbNum = Number(database[database.length - 1]);
        if (isNaN(dbNum)) {
            const match = String(database).match(/\d+/);
            if (match) dbNum = Number(match[0]);
        }
        if (isNaN(dbNum)) return;

        if (!this.ctx.wsReqNumber) this.ctx.wsReqNumber = 100;
        const reqID = ++this.ctx.wsReqNumber;
        const targetStream = streamID || this.subscribedDatabases.get(dbNum) || 2;
        const ackPayload = {
            database: dbNum,
            epoch_id: epochId != null ? (typeof epochId === "string" || typeof epochId === "number" ? String(epochId) : (BigInt(Date.now()) << 22n).toString()) : (BigInt(Date.now()) << 22n).toString(),
            failure_count: 1,
            last_applied_cursor: String(cursor),
            sync_params: null,
            version: LIGHTSPEED_VERSION
        };
        const outer = {
            app_id: APP_ID,
            payload: JSON.stringify(ackPayload),
            request_id: reqID,
            type: 2
        };
        const packet = buildData(targetStream, outer, this.nextSeq());
        this.sendRaw(packet);
    }

    publishTasks(tasks, options = {}) {
        if (!this.connected || !this.ws || this.ws.readyState !== 1 /* WebSocket.OPEN */) {
            return Promise.reject(new Error("Gateway is not connected"));
        }

        const streamID = options.streamID || (this.nextStreamID++);
        if (this.nextStreamID > 65000) this.nextStreamID = 20;

        if (!this.ctx.wsReqNumber) this.ctx.wsReqNumber = 100;
        const reqID = options.request_id || (++this.ctx.wsReqNumber);
        const epoch = options.epoch_id || (BigInt(Date.now()) << 22n).toString();

        const tasksArr = (Array.isArray(tasks) ? tasks : [tasks]).map((t, idx) => ({
            label:         String(t.label || t.labelId || "46"),
            payload:       typeof t.payload === "string" ? t.payload : JSON.stringify(t.payload || {}),
            queue_name:    String(t.queue_name || t.queueName || ""),
            task_id:       Number(t.task_id != null ? t.task_id : (idx + 1)),
            failure_count: null
        }));

        const content = {
            app_id: APP_ID,
            payload: JSON.stringify({
                tasks: tasksArr,
                epoch_id: epoch,
                version_id: options.version_id || "27712806675058809"
            }),
            request_id: reqID,
            type: options.type || 3
        };

        const metaPacket = buildMeta(streamID, {});
        const dataPacket = buildData(streamID, content, 0);
        const packet = Buffer.concat([metaPacket, dataPacket]);

        if (options.noWaitAck) {
            this.sendRaw(packet);
            return Promise.resolve({ request_id: reqID, sent: true });
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(reqID);
                resolve({ request_id: reqID, timeout: true });
            }, options.timeout || 15000);

            this.pendingRequests.set(reqID, {
                resolve: (res) => {
                    clearTimeout(timeout);
                    resolve(res);
                },
                reject: (err) => {
                    clearTimeout(timeout);
                    reject(err);
                }
            });

            this.sendRaw(packet);
        });
    }

    sendTask(task, options = {}) {
        return this.publishTasks([task], options);
    }

    close() {
        this.closedManually = true;
        this.stopKeepalive();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }
}

module.exports = {
    APP_ID,
    GATEWAY_HOST,
    DGW_VERSION,
    DGW_TIER,
    DEFAULT_REGION,
    DEFAULT_KEEPALIVE_MS,
    OP_ACK,
    OP_DATA,
    OP_HEARTBEAT,
    OP_META,
    APP_PING,
    APP_PONG,
    buildPacket,
    buildHeartbeat,
    buildAppPing,
    buildAppPong,
    buildAck,
    buildMeta,
    buildData,
    parseFrames,
    buildGatewayUrl,
    DgwGatewayClient,
    createGatewayClient: function(ctx, options) {
        return new DgwGatewayClient(ctx, options);
    }
};
