"use strict";

var utils = require("../utils");
var log = require("npmlog");
var axios = require("axios");

async function generateAIImage(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  return Buffer.from(res.data);
}

module.exports = function (defaultFuncs, api, ctx) {
  return function changeGroupImageAI(prompt, threadID, callback) {
    var resolveFunc = function () {};
    var rejectFunc = function () {};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, res) {
        if (err) return rejectFunc(err);
        resolveFunc(res);
      };
    }

    if (!threadID) {
      var errNoThread = { error: "threadID is required" };
      callback(errNoThread);
      return rejectFunc(errNoThread);
    }

    (async function () {
      try {
        log.info("changeGroupImageAI", `Generating AI group image for prompt: ${prompt}`);
        const imageBuffer = await generateAIImage(prompt || "beautiful anime scenery");

        var changeImgFunc = api.changeGroupImage || require("./changeGroupImage")(defaultFuncs, api, ctx);
        changeImgFunc(imageBuffer, threadID, function(err, res) {
          if (err) {
            callback(err);
            return rejectFunc(err);
          }
          callback(null, res);
          resolveFunc(res);
        });
      } catch (e) {
        log.error("changeGroupImageAI", e);
        callback(e);
        rejectFunc(e);
      }
    })();

    return returnPromise;
  };
};