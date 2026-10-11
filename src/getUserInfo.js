"use strict";

var utils = require("../utils");
var log = require("npmlog");

// Modern Comet GraphQL endpoint
var COMET_DOC_ID = "28575618488710252";
var COMET_FRIENDLY_NAME = "ProfileCometHeaderQuery";

function parseCometGraphQL(resText) {
  if (!resText) return null;
  if (typeof resText === "object") return resText;
  var clean = resText.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");
  var lines = clean.split(/\r?\n/).filter(Boolean);
  for (var i = 0; i < lines.length; i++) {
    try {
      var obj = JSON.parse(lines[i]);
      if (obj && obj.data && obj.data.user) {
        return obj;
      }
    } catch (_) {}
  }
  try {
    return JSON.parse(clean);
  } catch (_) {
    return null;
  }
}

function normalizeUser(userID, data) {
  var u = data && data.user && data.user.profile_header_renderer && data.user.profile_header_renderer.user;
  if (!u) {
    return {
      name: "Facebook User",
      firstName: "User",
      vanity: null,
      thumbSrc: null,
      profileUrl: "https://www.facebook.com/" + userID,
      gender: null,
      type: "User",
      isFriend: false,
      isBirthday: false
    };
  }

  var vanity = null;
  if (u.url) {
    try {
      var parsedUrl = new URL(u.url);
      vanity = parsedUrl.pathname.replace(/^\/|\/$/g, "");
    } catch (_) {
      vanity = u.url.replace(/https?:\/\/(www\.)?facebook\.com\//, "");
    }
  }

  var name = u.name || "Facebook User";
  var parts = name.split(" ");
  var firstName = u.short_name || (parts.length > 0 ? parts[parts.length - 1] : name);
  var thumbSrc = (u.profile_picture_for_sticky_bar && u.profile_picture_for_sticky_bar.uri) || null;

  return {
    name: name,
    firstName: firstName,
    vanity: vanity,
    thumbSrc: thumbSrc,
    profileUrl: u.url || ("https://www.facebook.com/" + userID),
    gender: u.gender || null,
    type: u.__isProfile || "User",
    isFriend: !!u.is_viewer_friend,
    isBirthday: false
  };
}

module.exports = function(defaultFuncs, api, ctx) {
  return function getUserInfo(id, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, result) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(result);
      };
    }

    var originalIsArray = utils.getType(id) === "Array";
    var ids = originalIsArray ? id : [id];

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (isConnected) {
      // Build tasks for Lightspeed contact resolution (Label 207 / 30)
      var tasks = ids.map(function(userId, idx) {
        return {
          label: utils.LIGHTSPEED_LABELS?.GET_CONTACTS_FULL || "207",
          payload: {
            contact_id: Number(userId) || String(userId),
            sync_group: 1
          },
          queue_name: JSON.stringify(["contact_info", String(userId)]),
          task_id: idx + 1,
          failure_count: null
        };
      });

      utils.waitForLsResponse(ctx, utils.buildLsPayload(tasks), {
        timeoutMs: 8000,
        extract: function(jsonMsg) {
          var contactMap = {};
          utils.walkLsStep(jsonMsg.payload?.step, function(procName, args) {
            var p = String(procName || "");
            if (p.includes("Contact") || p.includes("contact")) {
              var cId = String(utils.unwrapLsVal(args[0]) || "");
              if (!cId || cId === "0") return;

              var name = "";
              var thumb = "";
              var vanity = cId;

              if (p === "verifyContactRowExists" || p === "LSVerifyContactRowExists") {
                name = utils.unwrapLsVal(args[3]) || "";
                thumb = utils.unwrapLsVal(args[2]) || "";
              } else if (p === "deleteThenInsertContact" || p === "LSDeleteThenInsertContact") {
                name = utils.unwrapLsVal(args[9]) || utils.unwrapLsVal(args[10]) || utils.unwrapLsVal(args[18]) || "";
                thumb = utils.unwrapLsVal(args[5]) || utils.unwrapLsVal(args[2]) || "";
                vanity = utils.unwrapLsVal(args[43]) || cId;
              }

              // Quét tìm chuỗi họ tên nếu chỉ số chưa khớp
              if (!name) {
                for (var ai = 1; ai < args.length; ai++) {
                  var val = utils.unwrapLsVal(args[ai]);
                  if (typeof val === "string" && val.length >= 2 && !val.startsWith("http") && !val.startsWith("/") && !/^\d+$/.test(val)) {
                    name = val;
                    break;
                  }
                }
              }

              if (cId && name) {
                var userObj = {
                  id: cId,
                  name: String(name),
                  firstName: String(name.split(' ').pop() || "User"),
                  vanity: String(vanity || cId),
                  thumbSrc: String(thumb || ("https://graph.facebook.com/" + cId + "/picture?height=720&width=720&access_token=6628568379|c1e620fa708a1d5696fb991c1bde5662")),
                  profileUrl: "https://www.facebook.com/" + cId,
                  gender: "unknown",
                  type: "user",
                  isFriend: false,
                  isBirthday: false
                };
                contactMap[cId] = userObj;
                if (!global.Fca.Data.Userinfo) global.Fca.Data.Userinfo = new Map();
                global.Fca.Data.Userinfo.set(cId, userObj);
              }
            }
          });
          return Object.keys(contactMap).length > 0 ? contactMap : null;
        }
      })
      .then(async function(contactMap) {
        contactMap = contactMap || {};
        var missingIds = ids.filter(function(id) {
          return !contactMap[id] || !contactMap[id].name || contactMap[id].name === "Facebook User";
        });

        for (var mi = 0; mi < missingIds.length; mi++) {
          var mId = missingIds[mi];
          var fbUser = await fetchUserInfoFallback(mId, defaultFuncs, ctx);
          if (fbUser) {
            contactMap[mId] = fbUser;
            if (!global.Fca.Data.Userinfo) global.Fca.Data.Userinfo = new Map();
            global.Fca.Data.Userinfo.set(mId, fbUser);
          }
        }

        var res = getFinalResult(contactMap);
        callback(null, res);
        resolveFunc(res);
      })
      .catch(async function(err) {
        log.warn("getUserInfo", "Lightspeed contact query failed (" + (err.message || err) + "), using web fallback...");
        var contactMap = {};
        for (var mi = 0; mi < ids.length; mi++) {
          var mId = ids[mi];
          var fbUser = await fetchUserInfoFallback(mId, defaultFuncs, ctx);
          if (fbUser) {
            contactMap[mId] = fbUser;
            if (!global.Fca.Data.Userinfo) global.Fca.Data.Userinfo = new Map();
            global.Fca.Data.Userinfo.set(mId, fbUser);
          }
        }
        var res = getFinalResult(contactMap);
        callback(null, res);
        resolveFunc(res);
      });

      return returnPromise;
    }

    (async function() {
      var contactMap = {};
      for (var mi = 0; mi < ids.length; mi++) {
        var mId = ids[mi];
        var fbUser = await fetchUserInfoFallback(mId, defaultFuncs, ctx);
        if (fbUser) {
          contactMap[mId] = fbUser;
          if (!global.Fca.Data.Userinfo) global.Fca.Data.Userinfo = new Map();
          global.Fca.Data.Userinfo.set(mId, fbUser);
        }
      }
      var res = getFinalResult(contactMap);
      callback(null, res);
      resolveFunc(res);
    })();
    return returnPromise;

    function getFinalResult(contactMap) {
      contactMap = contactMap || {};
      var out = {};
      ids.forEach(function(uId) {
        var sId = String(uId);
        if (contactMap[sId] && contactMap[sId].name && contactMap[sId].name !== "Facebook User") {
          out[sId] = contactMap[sId];
          return;
        }

        var cached = (global.Fca?.Data?.Userinfo && global.Fca.Data.Userinfo.get(sId)) || null;
        var nameFromBot = (global.data && global.data.userName && global.data.userName.get(sId)) || null;
        var nameFromThreads = null;
        if (!nameFromBot && global.Fca && global.Fca.isThread) {
          for (var [, tData] of global.Fca.isThread) {
            if (tData && tData.nicknames && tData.nicknames[sId]) {
              nameFromThreads = tData.nicknames[sId];
              break;
            }
          }
        }
        var finalName = (cached && cached.name && cached.name !== "Facebook User" ? cached.name : null)
          || nameFromBot
          || nameFromThreads
          || "Facebook User";

        out[sId] = (cached && cached.name !== "Facebook User") ? cached : {
          id: sId,
          name: finalName,
          firstName: finalName ? finalName.split(' ').pop() : "User",
          vanity: sId,
          thumbSrc: "https://graph.facebook.com/" + sId + "/picture?height=720&width=720&access_token=6628568379|c1e620fa708a1d5696fb991c1bde5662",
          profileUrl: "https://www.facebook.com/" + sId,
          gender: "unknown",
          type: "User",
          isFriend: false,
          isBirthday: false
        };
      });
      return originalIsArray ? out : (out[ids[0]] || out);
    }
  };
};

async function fetchUserInfoFallback(userId, defaultFuncs, ctx) {
  var uId = String(userId);
  try {
    var form = {
      av: ctx.userID,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: COMET_FRIENDLY_NAME,
      variables: JSON.stringify({ id: uId, scale: 1 }),
      doc_id: COMET_DOC_ID
    };
    var res = await defaultFuncs.post("https://www.facebook.com/api/graphql/", ctx.jar, form);
    var parsed = parseCometGraphQL(res.body);
    if (parsed && parsed.data && parsed.data.user) {
      var norm = normalizeUser(uId, parsed.data);
      if (norm && norm.name && norm.name !== "Facebook User") {
        return norm;
      }
    }
  } catch (_) {}

  try {
    var pageRes = await defaultFuncs.get("https://m.facebook.com/" + uId, ctx.jar, null, ctx.globalOptions);
    if (pageRes && pageRes.body) {
      var titleMatch = pageRes.body.match(/<title>([^<]+)<\/title>/i);
      var ogTitleMatch = pageRes.body.match(/property="og:title"\s+content="([^"]+)"/i);
      var rawName = (ogTitleMatch && ogTitleMatch[1]) || (titleMatch && titleMatch[1]);
      if (rawName) {
        var cleanName = rawName.replace(/\s*\|\s*Facebook$/i, "").replace(/^\s*Facebook\s*-\s*/i, "").trim();
        if (cleanName && cleanName !== "Facebook" && cleanName !== "Log in" && cleanName !== "Đăng nhập") {
          return {
            id: uId,
            name: cleanName,
            firstName: cleanName.split(" ").pop() || cleanName,
            vanity: uId,
            thumbSrc: "https://graph.facebook.com/" + uId + "/picture?height=720&width=720&access_token=6628568379|c1e620fa708a1d5696fb991c1bde5662",
            profileUrl: "https://www.facebook.com/" + uId,
            gender: "unknown",
            type: "User",
            isFriend: false,
            isBirthday: false
          };
        }
      }
    }
  } catch (_) {}

  return null;
}
