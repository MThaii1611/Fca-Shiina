"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
    return function setActiveStatus(isActive, callback) {
        var resolveFunc = function () { };
        var rejectFunc = function () { };
        var returnPromise = new Promise(function (resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (!callback) {
            callback = function (err, data) {
                if (err) return rejectFunc(err);
                resolveFunc(data);
            };
        }

        if (typeof isActive !== "boolean") {
            var errType = { error: "isActive must be a boolean value" };
            callback(errType);
            rejectFunc(errType);
            return returnPromise;
        }

        var isConnected = !!(
            (ctx.mqttClient && ctx.mqttClient.connected) ||
            (ctx.gatewayClient && ctx.gatewayClient.connected)
        );

        if (!isConnected || !ctx.mqttClient || !ctx.mqttClient.connected) {
            var errNotConn = new Error("Lightspeed MQTT is not connected. Legacy GraphQL disabled to prevent checkpoint.");
            callback(errNotConn);
            rejectFunc(errNotConn);
            return returnPromise;
        }

        var fgPayload = JSON.stringify({ foreground: isActive });
        ctx.mqttClient.publish("/ls_foreground_state", fgPayload, { qos: 1, retain: false }, function(err) {
            if (err) {
                log.error("setActiveStatus", "Publish /ls_foreground_state failed: " + (err.message || err));
                callback(err);
                rejectFunc(err);
            } else {
                log.info("setActiveStatus", "Lightspeed foreground state -> " + isActive);
                var res = { success: true, activeStatus: isActive };
                callback(null, res);
                resolveFunc(res);
            }
        });

        return returnPromise;
    };
};
