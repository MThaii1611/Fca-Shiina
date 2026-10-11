"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function(defaultFuncs, api, ctx) {
  return function resolvePhotoUrl(photoID, callback) {
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

    // Modern direct Messenger media CDN URL (avoids deprecated /mercury/ endpoint that triggers checkpoint)
    var url = "https://lookaside.fbsbx.com/messenger_media/?attachment_id=" + photoID;
    callback(null, url);
    resolveFunc(url);
    return returnPromise;
  };
};
