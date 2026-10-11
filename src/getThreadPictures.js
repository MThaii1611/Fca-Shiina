"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function getThreadPictures(threadID, offset, limit, callback) {
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

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (isConnected) {
      var task = {
        label: utils.LIGHTSPEED_LABELS?.MESSAGE_RANGE_QUERY || "228",
        payload: {
          thread_key: Number(threadID) || String(threadID),
          direction: "before",
          reference_timestamp_ms: Date.now(),
          limit: limit || 50,
          sync_group: 1
        },
        queue_name: JSON.stringify(["thread_media", String(threadID)]),
        task_id: 1,
        failure_count: null
      };

      utils.waitForLsResponse(ctx, utils.buildLsPayload([task]), {
        timeoutMs: 8000,
        extract: function (jsonMsg) {
          var images = [];
          utils.walkLsStep(jsonMsg.payload?.step, function (procName, args) {
            if (procName === "insertBlobAttachment" || procName === "LSInsertBlobAttachment") {
              var previewUrl = utils.unwrapLsVal(args[3]) || utils.unwrapLsVal(args[8]);
              var blobId = utils.unwrapLsVal(args[0]);
              if (previewUrl) {
                images.push({
                  id: String(blobId || ""),
                  url: String(previewUrl),
                  previewUrl: String(previewUrl)
                });
              }
            }
          });
          return images;
        }
      })
      .then(function (images) {
        callback(null, images || []);
        resolveFunc(images || []);
      })
      .catch(function (err) {
        log.warn("getThreadPictures", "Lightspeed media query warning:", err.message || err);
        callback(null, []);
        resolveFunc([]);
      });

      return returnPromise;
    }

    callback(null, []);
    resolveFunc([]);
    return returnPromise;
  };
};
