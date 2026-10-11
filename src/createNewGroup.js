"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function createNewGroup(participantIDs, groupTitle, callback) {
    if (utils.getType(groupTitle) == "Function") {
      callback = groupTitle;
      groupTitle = null;
    }

    if (utils.getType(participantIDs) !== "Array") {
      throw { error: "createNewGroup: participantIDs should be an array." };
    }

    if (participantIDs.length < 2) {
      throw { error: "createNewGroup: participantIDs should have at least 2 IDs." };
    }

    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, threadID) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(threadID);
      };
    }

    var clientThreadKey = Number(utils.generateOfflineThreadingID());
    var participants = participantIDs.map(Number);
    if (ctx.userID && !participants.includes(Number(ctx.userID))) {
      participants.push(Number(ctx.userID));
    }

    if ((!ctx.mqttClient || !ctx.mqttClient.connected) && (!ctx.gatewayClient || !ctx.gatewayClient.connected)) {
      var notConnectedErr = new Error("createNewGroup: MQTT client is not connected. Lightspeed required.");
      log.error("createNewGroup", notConnectedErr.message);
      callback(notConnectedErr);
      return returnPromise;
    }

    var tasks = [
      {
        label: utils.LIGHTSPEED_LABELS?.CREATE_GROUP || "153",
        payload: {
          participants: participants,
          client_thread_key: clientThreadKey,
          sync_group: 1
        },
        queue_name: String(clientThreadKey),
        task_id: 1,
        failure_count: null
      }
    ];

    if (groupTitle) {
      tasks.push({
        label: utils.LIGHTSPEED_LABELS?.SET_THREAD_NAME || "32",
        payload: {
          thread_key: clientThreadKey,
          thread_name: String(groupTitle),
          sync_group: 1,
          offline_threading_id: ""
        },
        queue_name: String(clientThreadKey),
        task_id: 2,
        failure_count: null
      });
    }

    utils.sendLsTasks(ctx, tasks)
      .then(function() {
        return callback(null, String(clientThreadKey));
      })
      .catch(function(err) {
        log.error("createNewGroup", "Lightspeed task failed:", err);
        return callback(err);
      });

    return returnPromise;
  };
};
