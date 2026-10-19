"use strict";
/**
 * login/token-extractor.js
 * Trích xuất fb_dtsg, jazoest, lsd, irisSeqID, userID, mqttEndpoint, DGW config từ HTML
 */

const { v4: uuidv4 } = require("uuid");

function extractFbDtsg(html) {
    if (typeof html !== "string") return null;
    const patterns = [
        /\["DTSGInitialData",\[\],{"token":"([^"]+)"}/, 
        /\["DTSGInitData",\[\],{"token":"([^"]+)"/,
        /{"token":"([^"]+)","async_get_token"/,
        /<input[^>]+name="fb_dtsg"[^>]+value="([^"]+)"/,
        /\["",\[\],{"token":"([^"]+:\d+:\d+)"}/,
        /"DTSGInitialData"[^>]*?"token":"([^"]+)"/,
        /"dtsg":\{"token":"([^"]+)"/,
        /DTSG[^"]*"token":"([^"]+)"/
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) return m[1].replace(/\\/g, "");
    }
    return null;
}

function extractJazoest(html) {
    if (typeof html !== "string") return null;
    const m = html.match(/name="jazoest"\s+value="([^"]+)"/) || html.match(/jazoest=([0-9]+)/);
    return m ? m[1] : null;
}

function extractLsd(html) {
    if (typeof html !== "string") return null;
    const m = html.match(/\["LSD",\[\],{"token":"([^"]+)"}/) || html.match(/name="lsd"\s+value="([^"]+)"/);
    return m ? m[1] : null;
}

function extractIrisSeqID(html) {
    if (typeof html !== "string") return null;
    const m = html.match(/irisSeqID":"([^"]+)"/);
    return m ? m[1] : null;
}

function extractUserIDFromHtml(html) {
    if (typeof html !== "string") return null;
    const patterns = [
        /\["CurrentUserInitialData",\[\],\{.*?"USER_ID":"(\d+)"/,
        /"USER_ID":"(\d+)"/,
        /"ACCOUNT_ID":"(\d+)"/,
        /c_user=(\d+)/,
        /"id":"(\d{10,})"/
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1] && m[1] !== "0") return m[1];
    }
    return null;
}

function extractMqttEndpoint(html) {
    if (typeof html !== "string") return null;
    let endpoint = (html.match(/"endpoint":"([^"]+)"/) || [])[1];
    if (endpoint) {
        endpoint = endpoint.replace(/\\\//g, "/");
        if (!endpoint.startsWith("wss://") && !endpoint.startsWith("ws://")) {
            endpoint = endpoint.replace(/^https?:\/\//i, "wss://");
            if (!endpoint.startsWith("wss://")) endpoint = "wss://" + endpoint;
        }
        return endpoint;
    }
    return null;
}

function extractName(html) {
    if (typeof html !== "string") return null;
    const patterns = [
        /"SHORT_NAME":"([^"]{2,50})"/,
        /"NAME":"([^"]{2,50})"/,
        /"user_name":"([^"]{2,50})"/
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1] && !["connection_quality", "Messenger", "Facebook"].includes(m[1])) {
            return m[1];
        }
    }
    return null;
}

function extractDgwConfig(html) {
    if (typeof html !== "string") return {};
    let dgwAppId = null;
    let deviceClientId = null;
    let lsVersionId = null;

    const dgwMatch = html.match(/\["DGWWebConfig",\[\],\{"appId":"([^"]+)"/i)
        || html.match(/"DGWWebConfig"[^}]*?"appId":"([^"]+)"/i);
    if (dgwMatch && dgwMatch[1]) dgwAppId = dgwMatch[1];

    const devMatch = html.match(/\["MqttWebDeviceID",\[\],\{"clientID":"([^"]+)"/i)
        || html.match(/"MqttWebDeviceID"[^}]*?"clientID":"([^"]+)"/i);
    if (devMatch && devMatch[1]) deviceClientId = devMatch[1];

    const lsMatch = html.match(/adp_LSPlatformGraphQLLightspeedRequest[^}]*?"version":\s*"?(\d+)"?/i)
        || html.match(/version_id":\s*"?(\d{10,})"?/i);
    if (lsMatch && lsMatch[1]) lsVersionId = lsMatch[1];

    return {
        dgwAppId: dgwAppId || "2220391788200892",
        deviceClientId: deviceClientId || uuidv4(),
        lsVersionId: lsVersionId || "28890729100558484"
    };
}

const CHECKPOINT_049 = "601051028565049";
const CHECKPOINT_282 = "1501092823525282";
const CHECKPOINT_956 = "828281030927956";

function detectCheckpoint(html) {
    if (typeof html !== "string") return null;
    if (html.includes(CHECKPOINT_049) || html.includes("XCheckpointFBScrapingWarningController")) return "049";
    if (html.includes(CHECKPOINT_282)) return "282";
    if (html.includes(CHECKPOINT_956)) return "956";
    if (html.includes("1357001")) return "login_blocked";
    if (html.includes("/checkpoint/block/?next") || html.includes("/checkpoint/828229238992394/")) return "049";
    return null;
}

function isSessionDead(html) {
    if (typeof html !== "string") return true;
    const userMatch = html.match(/\["CurrentUserInitialData",\[\],\{.*?"USER_ID":"(\d+)"/) ||
                      html.match(/"USER_ID":"(\d+)"/) ||
                      html.match(/"ACCOUNT_ID":"(\d+)"/);
    if (userMatch && userMatch[1] === "0") return true;

    const isLoginForm = (html.includes('id="login_form"') || html.includes('name="login_form"')) && !html.includes("DTSGInitialData");
    const isLoginRedirect = html.includes("/login/?next") || (html.includes("/login.php") && !html.includes("DTSGInitialData"));
    return isLoginForm || isLoginRedirect;
}

function extractAllTokens(html) {
    const dgw = extractDgwConfig(html);
    return {
        fb_dtsg:        extractFbDtsg(html),
        jazoest:        extractJazoest(html),
        lsd:            extractLsd(html),
        irisSeqID:      extractIrisSeqID(html),
        mqttEndpoint:   extractMqttEndpoint(html),
        name:           extractName(html),
        checkpoint:     detectCheckpoint(html),
        isDead:         isSessionDead(html),
        dgwAppId:       dgw.dgwAppId,
        deviceClientId: dgw.deviceClientId,
        lsVersionId:    dgw.lsVersionId
    };
}

module.exports = {
    extractFbDtsg,
    extractJazoest,
    extractLsd,
    extractIrisSeqID,
    extractUserIDFromHtml,
    extractMqttEndpoint,
    extractName,
    extractDgwConfig,
    detectCheckpoint,
    isSessionDead,
    extractAllTokens
};
