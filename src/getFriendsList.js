"use strict";

//var cheerio = require("cheerio");
var utils = require("../utils");
var log = require("npmlog");

// [almost] copy pasted from one of FB's minified file (GenderConst)
var GENDERS = {
  0: "unknown",
  1: "female_singular",
  2: "male_singular",
  3: "female_singular_guess",
  4: "male_singular_guess",
  5: "mixed",
  6: "neuter_singular",
  7: "unknown_singular",
  8: "female_plural",
  9: "male_plural",
  10: "neuter_plural",
  11: "unknown_plural"
};

function formatData(obj) {
  return Object.keys(obj).map(function(key) {
    var user = obj[key];
    return {
      alternateName: user.alternateName,
      firstName: user.firstName,
      gender: GENDERS[user.gender],
      userID: utils.formatID(user.id.toString()),
      isFriend: user.is_friend != null && user.is_friend ? true : false,
      fullName: user.name,
      profilePicture: user.thumbSrc,
      type: user.type,
      profileUrl: user.uri,
      vanity: user.vanity,
      isBirthday: !!user.is_birthday
    };
  });
}

module.exports = function(defaultFuncs, api, ctx) {
  return function getFriendsList(callback) {
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

    if (typeof api.friendList === "function") {
      api.friendList(function(err, res) {
        if (!err && res && Array.isArray(res.friends) && res.friends.length > 0) {
          var mapped = res.friends.map(function(f) {
            return {
              alternateName: "",
              firstName: f.shortName || f.name,
              gender: f.gender || "unknown",
              userID: utils.formatID(String(f.userID)),
              isFriend: true,
              fullName: f.name,
              profilePicture: f.profilePicture,
              type: "User",
              profileUrl: f.profileUrl,
              vanity: null,
              isBirthday: false
            };
          });
          callback(null, mapped);
          return resolveFunc(mapped);
        }
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
