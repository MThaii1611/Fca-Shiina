api: "api.stopListenMqtt";

module.exports = function(ctx, http, api) {
    return function stopListenMqtt(callback) {
        if (ctx.mqttClient) {
            try { ctx.mqttClient.end(true); } catch (_) {}
            ctx.mqttClient = null;
        }
        if (ctx.gatewayClient) {
            try { ctx.gatewayClient.close(); } catch (_) {}
            ctx.gatewayClient = null;
        }
        if (ctx._lsFgInterval) {
            clearInterval(ctx._lsFgInterval);
            ctx._lsFgInterval = null;
        }
        if (typeof callback === "function") callback(null, { stopped: true });
        return Promise.resolve({ stopped: true });
    };
};
