"use strict";

var utils = require("../utils");
var log = require("npmlog");
var path = require("path");

var cachedColorMap = null;
function getColorMap(api, defaultFuncs, ctx) {
  if (cachedColorMap) return cachedColorMap;
  var map = {};

  try {
    var colorJson = require("./data/color.json");
    for (var k in colorJson) {
      if (Object.prototype.hasOwnProperty.call(colorJson, k)) {
        map[k.toLowerCase().trim()] = String(colorJson[k]);
      }
    }
  } catch (e) {}

  try {
    var threadColorsFunc = require("./threadColors");
    var tc = typeof threadColorsFunc === "function" ? threadColorsFunc(defaultFuncs, api, ctx) : threadColorsFunc;
    for (var tk in tc) {
      if (Object.prototype.hasOwnProperty.call(tc, tk)) {
        map[tk.toLowerCase().trim()] = String(tc[tk]);
      }
    }
  } catch (e) {}

  cachedColorMap = map;
  return map;
}

module.exports = function(defaultFuncs, api, ctx) {
  return function changeThreadColor(color, threadID, callback) {
    var resolveFunc = function() {};
    var rejectFunc = function() {};
    var returnPromise = new Promise(function(resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function(err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    if (!threadID) {
      var errNoThread = { error: "threadID is required" };
      callback(errNoThread);
      return rejectFunc(errNoThread);
    }

    var cleanThreadID = String(threadID).trim();
    var colorMap = getColorMap(api, defaultFuncs, ctx);

    // Resolve theme ID
    var cleanThemeID = null;
    if (color == null || color === "" || color === "default" || color === "0") {
      cleanThemeID = "3259963564026002"; // Standard Default Messenger Theme
    } else {
      var rawStr = String(color).trim();
      var rawLower = rawStr.toLowerCase();

      if (colorMap[rawLower]) {
        cleanThemeID = colorMap[rawLower];
      } else if (/^\d+$/.test(rawStr)) {
        cleanThemeID = rawStr;
      } else {
        // Check partial match in color map
        for (var name in colorMap) {
          if (name.includes(rawLower) || rawLower.includes(name)) {
            cleanThemeID = colorMap[name];
            break;
          }
        }
        if (!cleanThemeID) {
          cleanThemeID = rawStr;
        }
      }
    }

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    function genRandTag() {
      return String(BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000)));
    }

    // Format inner payloads with numeric IDs matching Facebook Web schema
    var payloadTheme = JSON.stringify({
      thread_key: cleanThreadID,
      theme_fbid: cleanThemeID,
      sync_group: 1
    }).replace(/"(thread_key|theme_fbid)":"(\d+)"/g, '"$1":$2');

    var payloadThreadTheme = JSON.stringify({
      thread_key: cleanThreadID,
      theme_fbid: cleanThemeID,
      source: null,
      sync_group: 1,
      payload: null,
      offline_threading_id: null
    }).replace(/"(thread_key|theme_fbid)":"(\d+)"/g, '"$1":$2');

    // 4 individual Lightspeed tasks from sniffed Facebook Web sequence
    var task1 = {
      label: utils.LIGHTSPEED_LABELS?.SET_AI_THEME || "1013",
      payload: payloadTheme,
      queue_name: JSON.stringify(["ai_generated_theme", genRandTag()]),
      task_id: Math.floor(Math.random() * 9000 + 1000),
      failure_count: null
    };

    var task2 = {
      label: utils.LIGHTSPEED_LABELS?.SET_CUSTOM_THEME || "1037",
      payload: payloadTheme,
      queue_name: JSON.stringify(["msgr_custom_thread_theme", genRandTag()]),
      task_id: Math.floor(Math.random() * 9000 + 1000),
      failure_count: null
    };

    var task3 = {
      label: utils.LIGHTSPEED_LABELS?.SET_THREAD_THEME_WRITER || "1028",
      payload: payloadTheme,
      queue_name: JSON.stringify(["thread_theme_writer", genRandTag()]),
      task_id: Math.floor(Math.random() * 9000 + 1000),
      failure_count: null
    };

    var task4 = {
      label: utils.LIGHTSPEED_LABELS?.SET_THREAD_THEME || "43",
      payload: payloadThreadTheme,
      queue_name: "thread_theme",
      task_id: Math.floor(Math.random() * 9000 + 1000),
      failure_count: null
    };

    function sendLightspeedTasks() {
      if (!isConnected) return Promise.resolve();

      return utils.sendLsTask(ctx, task1, { noWaitAck: true })
        .catch(function() {})
        .then(function() {
          return utils.sendLsTask(ctx, task2, { noWaitAck: true }).catch(function() {});
        })
        .then(function() {
          return utils.sendLsTask(ctx, task3, { noWaitAck: true }).catch(function() {});
        })
        .then(function() {
          return utils.sendLsTask(ctx, task4, { noWaitAck: true }).catch(function() {});
        });
    }

    var settled = false;
    function settleSuccess() {
      if (!settled) {
        settled = true;
        var resObj = { success: true, themeID: cleanThemeID };
        callback(null, resObj);
        resolveFunc(resObj);
      }
    }

    function settleError(err) {
      if (!settled) {
        settled = true;
        log.error("changeThreadColor", err);
        callback(err);
        rejectFunc(err);
      }
    }

    if (isConnected) {
      sendLightspeedTasks();
      settleSuccess();
    } else {
      settleError(new Error("Not connected to MQTT/Gateway"));
    }

    return returnPromise;
  };
};