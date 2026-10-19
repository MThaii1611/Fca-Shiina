"use strict";
/**
 * login/context-builder.js
 * Xây dựng ctx — đối tượng trạng thái session trung tâm của FCA
 * ctx được truyền xuyên suốt tất cả api, dgw, lightspeed
 */

const { v4: uuidv4 } = require("uuid");
const { DEFAULT_UA } = require("./http-client");

function buildContext({ userID, userName, tokens, jar, options, region }) {
    const mqttEndpoint = tokens.mqttEndpoint
        || `wss://edge-chat.facebook.com/chat?region=prn&sid=${userID}`;

    const detectedRegion = (() => {
        try { return new URL(mqttEndpoint).searchParams.get("region")?.toUpperCase() || "PRN"; }
        catch (_) { return region || "PRN"; }
    })();

    return {
        // Định danh
        userID,
        userName: userName || "Unknown",

        // Auth tokens
        fb_dtsg:  tokens.fb_dtsg  || null,
        jazoest:  tokens.jazoest  || null,
        lsd:      tokens.lsd      || null,
        irisSeqID: tokens.irisSeqID || null,

        // DGW & Lightspeed metadata
        dgwAppId: tokens.dgwAppId || "2220391788200892",
        deviceClientId: tokens.deviceClientId || uuidv4(),
        lsVersionId: tokens.lsVersionId || "28890729100558484",

        // Cookie jar
        jar,

        // MQTT / DGW
        mqttEndpoint,
        region: detectedRegion,
        mqttClient: null,
        gatewayClient: null,
        wsReqNumber: 100,

        // Session state
        loggedIn:    true,
        _dead:       false,
        _ending:     false,
        firstListen: true,
        lastPresence: Date.now(),

        // Client identifiers
        clientID: tokens.deviceClientId || uuidv4(),
        sessionID: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1,

        // Callback map cho lightspeed tasks
        callback_Task: {},
        req_ID: 0,

        // Sync cursors (db -> cursor)
        syncCursors: {},

        // Options
        options: {
            selfListen:        false,
            listenEvents:      true,
            updatePresence:    false,
            autoMarkDelivery:  false,
            autoMarkRead:      false,
            listenTyping:      false,
            autoReconnect:     true,
            emitReady:         false,
            enableDGW:         false, // Mặc định dùng Edge MQTT an toàn không bị 4003 Unauthorized
            userAgent:         DEFAULT_UA,
            ...options
        },

        debug: false
    };
}

module.exports = { buildContext };
