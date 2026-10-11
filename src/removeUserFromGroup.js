"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function removeUserFromGroup(userID, threadID, callback) {
    if (
      !callback &&
      (utils.getType(threadID) === "Function" ||
        utils.getType(threadID) === "AsyncFunction")
    ) {
      throw { error: "please pass a threadID as a second argument." };
    }
    if (
      utils.getType(threadID) !== "Number" &&
      utils.getType(threadID) !== "String"
    ) {
      throw {
        error:
          "threadID should be of type Number or String and not " +
          utils.getType(threadID) +
          "."
      };
    }
    if (
      utils.getType(userID) !== "Number" &&
      utils.getType(userID) !== "String"
    ) {
      throw {
        error:
          "userID should be of type Number or String and not " +
          utils.getType(userID) +
          "."
      };
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

    var cleanThreadID = String(threadID).trim();
    var cleanUserID = String(userID).trim();
    var numThreadID = Number(cleanThreadID);
    var numUserID = Number(cleanUserID);

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (isConnected) {
      var primaryTask = {
        label: utils.LIGHTSPEED_LABELS?.REMOVE_PARTICIPANT || "140",
        payload: {
          thread_id: Number.isSafeInteger(numThreadID) ? numThreadID : cleanThreadID,
          contact_id: Number.isSafeInteger(numUserID) ? numUserID : cleanUserID
        },
        queue_name: "remove_participant_v2",
        task_id: 1,
        failure_count: null
      };

      utils.sendLsTask(ctx, primaryTask, { noWaitAck: true }).catch(function() {});
      var resSuccess = { success: true, method: "lightspeed" };
      callback(null, resSuccess);
      resolveFunc(resSuccess);
      return returnPromise;
    }

    var errNotConn = { error: "removeUserFromGroup: MQTT/Gateway is not connected" };
    callback(errNotConn);
    rejectFunc(errNotConn);
    return returnPromise;
  };
};
