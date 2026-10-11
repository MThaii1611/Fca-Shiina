"use strict";

module.exports = function (_defaultFuncs, api, _ctx) {
  return function getUID(link, callback) {
    var resolveFunc = function () { };
    var rejectFunc = function () { };
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, uid) {
        if (err) return rejectFunc(err);
        resolveFunc(uid);
      };
    }

    try {
      var Link = String(link || "").trim();
      var FindUID = require('../shiina/Extra/Shiina-FindUid');

      FindUID(Link, api)
        .then(function (data) {
          var finalUid = (data && !isNaN(data)) ? String(data) : null;
          callback(null, finalUid);
          resolveFunc(finalUid);
        })
        .catch(function (err) {
          callback(err);
          rejectFunc(err);
        });
    } catch (e) {
      callback(e);
      rejectFunc(e);
    }

    return returnPromise;
  };
};