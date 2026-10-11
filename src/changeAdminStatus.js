"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function changeAdminStatus(threadID, adminIDs, adminStatus, callback) {
    if (utils.getType(threadID) !== "String") {
      throw {error: "changeAdminStatus: threadID must be a string"};
    }

    if (utils.getType(adminIDs) === "String") {
      adminIDs = [adminIDs];
    }

    if (utils.getType(adminIDs) !== "Array") {
      throw {error: "changeAdminStatus: adminIDs must be an array or string"};
    }

    if (utils.getType(adminStatus) !== "Boolean") {
      throw {error: "changeAdminStatus: adminStatus must be a boolean"};
    }

    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, data) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(data);
      };
    }

    if ((!ctx.mqttClient || !ctx.mqttClient.connected) && (!ctx.gatewayClient || !ctx.gatewayClient.connected)) {
      var notConnectedErr = new Error("changeAdminStatus: MQTT client is not connected. Lightspeed required.");
      log.error("changeAdminStatus", notConnectedErr.message);
      callback(notConnectedErr);
      return returnPromise;
    }

    var tasks = adminIDs.map(function(id) {
      return {
        label: (utils.LIGHTSPEED_LABELS && utils.LIGHTSPEED_LABELS.SET_ADMIN_STATUS) || "25",
        payload: {
          thread_key: threadID,
          contact_id: id,
          is_admin: adminStatus ? 1 : 0
        },
        queue_name: "admin_status",
        failure_count: null
      };
    });

    utils.sendLsTasks(ctx, tasks)
      .then(function() {
        callback(null, { success: true, method: "mqtt" });
        resolveFunc({ success: true, method: "mqtt" });
      })
      .catch(function(err) {
        log.error("changeAdminStatus", "Lightspeed task failed:", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};