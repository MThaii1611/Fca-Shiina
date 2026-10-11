"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return function getThreadTheme(themeID, callback) {
    let resolveFunc, rejectFunc;
    const returnPromise = new Promise((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    if (!themeID) {
      var errEmpty = { error: "themeID is required" };
      callback(errEmpty);
      return rejectFunc(errEmpty);
    }

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (isConnected) {
      var task = {
        label: utils.LIGHTSPEED_LABELS?.SET_THREAD_THEME || "43",
        payload: {
          theme_fbid: String(themeID),
          sync_group: 1
        },
        queue_name: "thread_theme",
        task_id: 1,
        failure_count: null
      };

      utils.waitForLsResponse(ctx, utils.buildLsPayload([task]), {
        timeoutMs: 8000,
        extract: function (jsonMsg) {
          var found = null;
          utils.walkLsStep(jsonMsg.payload?.step, function (procName, args) {
            if (procName === "upsertTheme" || procName === "LSUpsertTheme") {
              found = {
                id: String(themeID),
                name: String(utils.unwrapLsVal(args[1]) || "Theme"),
                description: "",
                colors: [utils.unwrapLsVal(args[2]) || ""],
                backgroundImage: null
              };
            }
          });
          return found;
        }
      })
      .then(function (themeData) {
        if (themeData) {
          callback(null, themeData);
          resolveFunc(themeData);
        } else {
          var errNoData = new Error("No theme data returned from Lightspeed");
          callback(errNoData);
          rejectFunc(errNoData);
        }
      })
      .catch(function (err) {
        log.error("getThreadTheme", "Lightspeed theme query error: " + (err.message || err));
        callback(err);
        rejectFunc(err);
      });

      return returnPromise;
    }

    var errNotConn = new Error("Lightspeed is not connected. Legacy GraphQL disabled to prevent checkpoint.");
    callback(errNotConn);
    rejectFunc(errNotConn);
    return returnPromise;
  };
};
