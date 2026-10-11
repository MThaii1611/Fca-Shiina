"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function setTitle(newTitle, threadID, callback) {
    if (
      !callback &&
      (utils.getType(threadID) === "Function" ||
        utils.getType(threadID) === "AsyncFunction")
    ) {
      throw { error: "please pass a threadID as a second argument." };
    }

    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, friendList) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(friendList);
      };
    }

    var otid = utils.generateOfflineThreadingID ? utils.generateOfflineThreadingID() : (BigInt(Date.now()) << 22n).toString();
    var cleanTitle = String(newTitle != null ? newTitle : "");

    // 1. Lightspeed MQTT Task 32
    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    var task = {
      label: utils.LIGHTSPEED_LABELS?.SET_THREAD_NAME || "32",
      payload: {
        thread_key: Number(threadID) || String(threadID),
        thread_id: String(threadID),
        thread_name: cleanTitle,
        sync_group: 1,
        offline_threading_id: otid
      },
      queue_name: "thread_name",
      task_id: 1,
      failure_count: null
    };

    var form = {
      thread_name: cleanTitle,
      thread_id: String(threadID)
    };

    if (isConnected) {
      utils.sendLsTask(ctx, task, { noWaitAck: true }).catch(function() {});
      callback(null, { success: true });
      resolveFunc({ success: true });
    } else {
      var errNotConn = { error: "Not connected to MQTT/Gateway" };
      callback(errNotConn);
      rejectFunc(errNotConn);
    }

    return returnPromise;
  };
};
