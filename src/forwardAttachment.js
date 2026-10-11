"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function forwardAttachment(attachmentID, userOrUsers, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function(err, data) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(data);
      };
    }

    if (utils.getType(userOrUsers) !== "Array") {
      userOrUsers = [userOrUsers];
    }

    if ((!ctx.mqttClient || !ctx.mqttClient.connected) && (!ctx.gatewayClient || !ctx.gatewayClient.connected)) {
      var notConnectedErr = new Error("forwardAttachment: MQTT client is not connected. Lightspeed required.");
      log.error("forwardAttachment", notConnectedErr.message);
      callback(notConnectedErr);
      return returnPromise;
    }

    var tasks = userOrUsers.map(function(threadID) {
      return {
        label: (utils.LIGHTSPEED_LABELS && utils.LIGHTSPEED_LABELS.SEND_MESSAGE) || "46",
        payload: {
          thread_id: String(threadID),
          otid: utils.generateOfflineThreadingID(),
          source: 2097153,
          send_type: 3,
          sync_group: 1,
          mark_thread_read: 1,
          attachment_fbids: [attachmentID]
        },
        queue_name: String(threadID),
        failure_count: null
      };
    });

    utils.sendLsTasks(ctx, tasks)
      .then(function() {
        callback(null, { success: true, method: "mqtt" });
        resolveFunc({ success: true, method: "mqtt" });
      })
      .catch(function(err) {
        log.error("forwardAttachment", "Lightspeed forward failed:", err);
        callback(err);
        rejectFunc(err);
      });

    return returnPromise;
  };
};