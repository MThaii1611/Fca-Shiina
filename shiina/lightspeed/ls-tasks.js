"use strict";
/**
 * shiina/lightspeed/ls-tasks.js
 * Build và gửi Lightspeed tasks qua DGW gateway hoặc MQTT
 * Constants, helpers
 */

const LS_VERSION_ID = "28890729100558484";
const LS_APP_ID = "2220391788200892";

// Labels Lightspeed chuẩn
const LS_LABELS = {
    SEND_MESSAGE:        "46",
    MARK_READ:           "21",
    SET_THREAD_NAME:     "32",
    SET_NICKNAME:        "44",
    SET_EMOJI:           "39",
    ADD_MEMBER:          "475",
    REMOVE_MEMBER:       "476",
    CREATE_GROUP:        "130",
    UNSEND_MESSAGE:      "33",
    SET_REACTION:        "40",
    DELETE_THREAD:       "146",
    MUTE_THREAD:         "192",
    PIN_MESSAGE:         "605",
    SET_THREAD_COLOR:    "38",
    MARK_DELIVERED:      "26",
    SEND_TYPING:         "87"
};

/**
 * Tạo epoch_id chuẩn Meta: (unixMs << 22) | (counter << 12) | 42
 */
let _lastMs = -1;
let _counter = 0;
function createEpochId() {
    const ms = Date.now();
    if (ms === _lastMs) _counter = (_counter + 1) & 0x3ff;
    else { _lastMs = ms; _counter = 0; }
    return ((BigInt(ms) << 22n) | (BigInt(_counter) << 12n) | 42n).toString();
}

/**
 * Build LS task object chuẩn
 * @param {string|number} label - LS_LABELS hoặc số string
 * @param {object} payload
 * @param {string} queueName
 * @param {number} taskId
 */
function buildTask(label, payload, queueName, taskId = 1) {
    return {
        label: String(label),
        payload: typeof payload === "string" ? payload : JSON.stringify(payload),
        queue_name: queueName,
        task_id: taskId,
        failure_count: null
    };
}

/**
 * Build envelope /ls_req để publish qua MQTT
 * @param {Array} tasks
 * @param {number} requestId
 * @param {string} epochId
 */
function buildMqttEnvelope(tasks, requestId, epochId) {
    const tasksArr = tasks.map((t) => ({
        label:         String(t.label),
        payload:       typeof t.payload === "string" ? t.payload : JSON.stringify(t.payload),
        queue_name:    t.queue_name || t.queueName,
        task_id:       t.task_id || t.taskId || 1,
        failure_count: null
    }));
    return {
        app_id: LS_APP_ID,
        payload: JSON.stringify({
            tasks: tasksArr,
            epoch_id: epochId || createEpochId(),
            version_id: LS_VERSION_ID
        }),
        request_id: requestId,
        type: 3
    };
}

/**
 * Gửi task qua gateway (DGW) hoặc MQTT tuỳ ctx
 * @param {object} ctx
 * @param {object} task - task object từ buildTask()
 * @param {object} options
 * @returns {Promise}
 */
function sendTask(ctx, task, options = {}) {
    // 1. Ưu tiên MQTT /ls_req siêu nhẹ, phản hồi tức thì và không ngốn CPU
    if (ctx.mqttClient && ctx.mqttClient.connected) {
        return sendTaskViaMqtt(ctx, [task]);
    }

    // 2. Fallback DGW nếu MQTT mất kết nối
    if (ctx.gatewayClient && ctx.gatewayClient.connected && typeof ctx.gatewayClient.publishTasks === "function") {
        return ctx.gatewayClient.publishTasks([task], options);
    }

    return Promise.reject(new Error("Không có kết nối DGW/MQTT"));
}

function sendTaskViaMqtt(ctx, tasks) {
    return new Promise((resolve, reject) => {
        if (!ctx.wsReqNumber && !ctx.req_ID) ctx.wsReqNumber = 100;
        ctx.wsReqNumber = (ctx.wsReqNumber || ctx.req_ID || 100) + 1;
        const reqID = ctx.wsReqNumber;
        const envelope = buildMqttEnvelope(tasks, reqID, createEpochId());
        ctx.mqttClient.publish("/ls_req", JSON.stringify(envelope), { qos: 1, retain: false }, (err) => {
            if (err) return reject(err);
            resolve({ request_id: reqID, sent: true });
        });
    });
}

/**
 * Gửi nhiều tasks cùng lúc
 */
function sendTasks(ctx, tasks, options = {}) {
    if (ctx.mqttClient && ctx.mqttClient.connected) {
        return sendTaskViaMqtt(ctx, tasks);
    }
    if (ctx.gatewayClient && ctx.gatewayClient.connected && typeof ctx.gatewayClient.publishTasks === "function") {
        return ctx.gatewayClient.publishTasks(tasks, options);
    }
    return Promise.reject(new Error("Không có kết nối DGW/MQTT"));
}

/**
 * Kiểm tra xem ctx có kết nối LS không
 */
function isConnected(ctx) {
    return (
        (ctx.gatewayClient && ctx.gatewayClient.connected) ||
        (ctx.mqttClient && ctx.mqttClient.connected)
    );
}

module.exports = {
    LS_VERSION_ID,
    LS_APP_ID,
    LS_LABELS,
    createEpochId,
    buildTask,
    buildMqttEnvelope,
    sendTask,
    sendTasks,
    isConnected
};
