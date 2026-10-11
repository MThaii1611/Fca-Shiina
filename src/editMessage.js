"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function editMessage(text, messageID, callback) {
    var resolveFunc = function() {};
    var rejectFunc = function() {};
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

    if (!text || !messageID) {
      var err = { error: "text and messageID are required" };
      callback(err);
      return returnPromise;
    }

    if ((!ctx.mqttClient || !ctx.mqttClient.connected) && (!ctx.gatewayClient || !ctx.gatewayClient.connected)) {
      var mqttErr = { error: "MQTT client not connected, không thể sửa tin nhắn lúc này." };
      callback(mqttErr);
      return returnPromise;
    }

    var form = {
      message_id: String(messageID),
      text: String(text),
    };

    ctx.wsTaskNumber = (ctx.wsTaskNumber || 0) + 1;
    ctx.wsReqNumber = (ctx.wsReqNumber || 0) + 1;

    var content = {
      app_id: utils.LIGHTSPEED_APP_ID || "2220391788200892",
      payload: JSON.stringify({
        data_trace_id: null,
        epoch_id: (BigInt(Date.now()) << 22n).toString(),
        tasks: [{
          failure_count: null,
          label: utils.LIGHTSPEED_LABELS?.EDIT_MESSAGE || "742",
          payload: JSON.stringify(form),
          queue_name: "edit_message",
          task_id: ctx.wsTaskNumber,
        }],
        version_id: utils.LIGHTSPEED_VERSION_ID || "28736260762644663",
      }),
      request_id: ctx.wsReqNumber,
      type: 3
    };

    utils.waitForLsResponse(ctx, content, {
      extract: function(jsonMsg) {
        var msgID = messageID;
        var msgReplace = text;

        utils.walkLsStep(jsonMsg.payload?.step, function(procName, args) {
          if (procName === "replaceOptimsiticMessage" || procName === "replaceOptimisticMessage") {
            if (args[1]) msgID = String(args[1]);
          }
        });

        return { msgID: msgID, msgReplace: msgReplace };
      }
    }).then(function(result) {
      return callback(undefined, { body: result.msgReplace, messageID: result.msgID });
    }).catch(function(err) {
      log.error("editMessage", err);
      callback(err);
      rejectFunc(err);
    });

    return returnPromise;
  };
};