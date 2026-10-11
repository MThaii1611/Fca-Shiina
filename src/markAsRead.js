"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return async function markAsRead(threadID, read, callback) {
    if (utils.getType(read) === 'Function' || utils.getType(read) === 'AsyncFunction') {
      callback = read;
      read = true;
    }
    if (read == undefined) {
      read = true;
    }

    if (!callback) {
      callback = () => { };
    }

    try {
      const isConnected = !!(
        (ctx.mqttClient && ctx.mqttClient.connected) ||
        (ctx.gatewayClient && ctx.gatewayClient.connected)
      );
      if (isConnected) {
          var task = {
            label: utils.LIGHTSPEED_LABELS?.MARK_READ || "21",
            payload: {
              thread_id: Number(threadID) || String(threadID),
              last_read_watermark_ts: Date.now(),
              sync_group: 95,
              offline_threading_id: null
            },
            queue_name: String(threadID),
            task_id: 1,
            failure_count: null
          };

          return utils.sendLsTask(ctx, task)
            .then(function() {
              callback();
            })
            .catch(async function(err) {
              // fallback to /mark_thread topic
              try {
                await new Promise(r => ctx.mqttClient.publish("/mark_thread", JSON.stringify({
                  threadID,
                  mark: "read",
                  state: read
                }), { qos: 1, retain: false }, r));
                callback();
              } catch (e) {
                callback(e);
              }
            });
        } else {
          throw {
            error: "You can only use this function after you start listening."
          };
        }
      } catch (e) {
        try {
          await callback(e);
        } catch (_) {}
        throw e;
      }
  };
};
