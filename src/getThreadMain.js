"use strict";

var utils = require("../utils");
var log = require("npmlog");

function formatEventReminders(reminder) {
  return {
    reminderID: reminder.id,
    eventCreatorID: reminder.lightweight_event_creator ? reminder.lightweight_event_creator.id : null,
    time: reminder.time,
    eventType: reminder.lightweight_event_type ? reminder.lightweight_event_type.toLowerCase() : null,
    locationName: reminder.location_name,
    locationCoordinates: reminder.location_coordinates,
    locationPage: reminder.location_page,
    eventStatus: reminder.lightweight_event_status ? reminder.lightweight_event_status.toLowerCase() : null,
    note: reminder.note,
    repeatMode: reminder.repeat_mode ? reminder.repeat_mode.toLowerCase() : null,
    eventTitle: reminder.event_title,
    triggerMessage: reminder.trigger_message,
    secondsToNotifyBefore: reminder.seconds_to_notify_before,
    allowsRsvp: reminder.allows_rsvp,
    relatedEvent: reminder.related_event,
    members: reminder.event_reminder_members && reminder.event_reminder_members.edges
      ? reminder.event_reminder_members.edges.map(function(member) {
          return {
            memberID: member.node ? member.node.id : null,
            state: member.guest_list_state ? member.guest_list_state.toLowerCase() : null
          };
        })
      : []
  };
}

function formatThreadGraphQLResponse(data) {
  try {
    var messageThread = data.message_thread;
  } catch (err) {
    console.error("GetThreadInfoGraphQL", "Can't get this thread info!");
    return { err: err };
  }
  if (!messageThread) return null;

  var threadID = messageThread.thread_key.thread_fbid
    ? messageThread.thread_key.thread_fbid
    : messageThread.thread_key.other_user_id;

  var lastM = messageThread.last_message;
  var snippetID =
    lastM &&
    lastM.nodes &&
    lastM.nodes[0] &&
    lastM.nodes[0].message_sender &&
    lastM.nodes[0].message_sender.messaging_actor
      ? lastM.nodes[0].message_sender.messaging_actor.id
      : null;
  var snippetText =
    lastM && lastM.nodes && lastM.nodes[0] ? lastM.nodes[0].snippet : null;
  var lastR = messageThread.last_read_receipt;
  var lastReadTimestamp =
    lastR && lastR.nodes && lastR.nodes[0] && lastR.nodes[0].timestamp_precise
      ? lastR.nodes[0].timestamp_precise
      : null;

  var rawAdmins = messageThread.thread_admins || [];
  var adminIDs = Array.isArray(rawAdmins)
    ? rawAdmins.map(function(a) {
        if (typeof a === "object" && a !== null && a.id) return { id: String(a.id) };
        return { id: String(a) };
      })
    : [];

  var participants = (messageThread.all_participants && messageThread.all_participants.edges) || [];
  var participantIDs = participants.map(function(d) {
    return d.node && d.node.messaging_actor ? String(d.node.messaging_actor.id) : null;
  }).filter(Boolean);

  var userInfo = participants.map(function(d) {
    var actor = d.node && d.node.messaging_actor;
    if (!actor) return null;
    return {
      id: String(actor.id),
      name: actor.name || "Facebook User",
      firstName: actor.short_name || actor.name || "",
      vanity: actor.username || "",
      thumbSrc: actor.big_image_src ? actor.big_image_src.uri : null,
      profileUrl: actor.big_image_src ? actor.big_image_src.uri : null,
      gender: actor.gender,
      type: actor.__typename,
      isFriend: Boolean(actor.is_viewer_friend),
      isBirthday: Boolean(actor.is_birthday)
    };
  }).filter(Boolean);

  return {
    threadID: String(threadID),
    threadName: messageThread.name || "",
    participantIDs: participantIDs,
    userInfo: userInfo,
    unreadCount: messageThread.unread_count || 0,
    messageCount: messageThread.messages_count || 0,
    timestamp: messageThread.updated_time_precise || Date.now(),
    muteUntil: messageThread.mute_until || null,
    isGroup: messageThread.thread_type === "GROUP",
    isSubscribed: Boolean(messageThread.is_viewer_subscribed),
    isArchived: Boolean(messageThread.has_viewer_archived),
    folder: messageThread.folder || "INBOX",
    cannotReplyReason: messageThread.cannot_reply_reason || null,
    eventReminders: messageThread.event_reminders && messageThread.event_reminders.nodes
      ? messageThread.event_reminders.nodes.map(formatEventReminders)
      : null,
    emoji: messageThread.customization_info ? messageThread.customization_info.emoji : null,
    color:
      messageThread.customization_info && messageThread.customization_info.outgoing_bubble_color
        ? String(messageThread.customization_info.outgoing_bubble_color).slice(2)
        : null,
    nicknames:
      messageThread.customization_info && messageThread.customization_info.participant_customizations
        ? messageThread.customization_info.participant_customizations.reduce(function(res, val) {
            if (val.nickname) res[val.participant_id] = val.nickname;
            return res;
          }, {})
        : {},
    adminIDs: adminIDs,
    approvalMode: Boolean(messageThread.approval_mode),
    approvalQueue: (messageThread.group_approval_queue && messageThread.group_approval_queue.nodes)
      ? messageThread.group_approval_queue.nodes.map(function(a) {
          return {
            inviterID: a.inviter ? a.inviter.id : null,
            requesterID: a.requester ? a.requester.id : null,
            timestamp: a.request_timestamp,
            request_source: a.request_source
          };
        })
      : [],
    reactionsMuteMode: messageThread.reactions_mute_mode ? messageThread.reactions_mute_mode.toLowerCase() : null,
    mentionsMuteMode: messageThread.mentions_mute_mode ? messageThread.mentions_mute_mode.toLowerCase() : null,
    isPinProtected: Boolean(messageThread.is_pin_protected),
    relatedPageThread: messageThread.related_page_thread || null,
    name: messageThread.name || "",
    snippet: snippetText || "",
    snippetSender: snippetID || null,
    snippetAttachments: [],
    serverTimestamp: messageThread.updated_time_precise || Date.now(),
    imageSrc: messageThread.image ? messageThread.image.uri : null,
    isCanonicalUser: Boolean(messageThread.is_canonical_neo_user),
    isCanonical: messageThread.thread_type !== "GROUP",
    recipientsLoadable: true,
    hasEmailParticipant: false,
    readOnly: false,
    canReply: messageThread.cannot_reply_reason == null,
    lastMessageTimestamp: lastM && lastM.timestamp_precise ? lastM.timestamp_precise : null,
    lastMessageType: "message",
    lastReadTimestamp: lastReadTimestamp,
    threadType: messageThread.thread_type === "GROUP" ? 2 : 1,
    TimeCreate: Date.now(),
    TimeUpdate: Date.now()
  };
}

module.exports = function(defaultFuncs, api, ctx) {
  return function getThreadInfoGraphQL(threadID, callback) {
    var resolveFunc = function(){};
    var rejectFunc = function(){};
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

    var tId = Array.isArray(threadID) ? String(threadID[0]) : String(threadID);

    function getMemoryFallback() {
      var cached = (global.Fca?.isThread && global.Fca.isThread.get(tId)) || {};
      return {
        threadID: tId,
        threadName: cached.name || cached.threadName || "Messenger Chat",
        name: cached.name || cached.threadName || "Messenger Chat",
        participantIDs: Array.isArray(cached.participantIDs) ? cached.participantIDs : [tId],
        userInfo: Array.isArray(cached.userInfo) ? cached.userInfo : [],
        adminIDs: Array.isArray(cached.adminIDs) ? cached.adminIDs : [],
        unreadCount: 0,
        messageCount: cached.messageCount || 0,
        timestamp: Date.now(),
        isGroup: tId.length >= 15,
        isSubscribed: true,
        folder: "INBOX",
        nicknames: cached.nicknames || {}
      };
    }

    function returnFallback(baseObj) {
      var fallback = baseObj || getMemoryFallback();
      if (global.Fca && global.Fca.isThread) {
        global.Fca.isThread.set(tId, fallback);
      }
      try {
        var { updateData, hasData } = require("../shiina/Extra/Shiina-GetThread");
        if (hasData(tId)) updateData(tId, fallback);
      } catch (_) {}
      callback(null, fallback);
      resolveFunc(fallback);
      return fallback;
    }

    var isConnected = !!(
      (ctx.mqttClient && ctx.mqttClient.connected) ||
      (ctx.gatewayClient && ctx.gatewayClient.connected)
    );

    if (isConnected) {
      var task = {
        label: "209",
        payload: {
          thread_fbid: Number(tId) || tId,
          force_upsert: 0,
          use_open_messenger_transport: 0,
          sync_group: 95,
          metadata_only: 0,
          preview_only: 0
        },
        queue_name: tId,
        task_id: 1,
        failure_count: null
      };

      utils.waitForLsResponse(ctx, utils.buildLsPayload([task]), {
        timeoutMs: 7000,
        extract: function(jsonMsg) {
          var cached = (global.Fca?.isThread && global.Fca.isThread.get(tId)) || {};
          var threadObj = {
            threadID: tId,
            threadName: cached.name || cached.threadName || "",
            name: cached.name || cached.threadName || "",
            snippet: cached.snippet || "",
            isGroup: tId.length >= 15,
            participantIDs: Array.isArray(cached.participantIDs) ? [...cached.participantIDs] : [],
            userInfo: Array.isArray(cached.userInfo) ? [...cached.userInfo] : [],
            adminIDs: Array.isArray(cached.adminIDs) ? [...cached.adminIDs] : [],
            unreadCount: 0,
            messageCount: cached.messageCount || 0,
            timestamp: Date.now(),
            isSubscribed: true,
            folder: "INBOX",
            nicknames: Object.assign({}, cached.nicknames || {})
          };

          var hasTargetThreadProc = false;

          utils.walkLsStep(jsonMsg.payload?.step, function(procName, args) {
            var pName = String(procName || "");

            // 1. Thread metadata
            var isThreadMetaProc = (
              pName === "updateOrInsertThread" ||
              pName === "deleteThenInsertThread" ||
              pName === "LSDeleteThenInsertThread" ||
              pName === "syncUpdateThreadName" ||
              pName.includes("Thread")
            );

            var matchesThisThread = args.some(function(a) {
              return String(utils.unwrapLsVal(a)) === tId;
            });

            if (isThreadMetaProc && matchesThisThread) {
              hasTargetThreadProc = true;
              var name = utils.unwrapLsVal(args[3]) || utils.unwrapLsVal(args[1]) || utils.unwrapLsVal(args[0]);
              var snippet = utils.unwrapLsVal(args[2]) || "";
              if (snippet) threadObj.snippet = String(snippet);

              if (!name || typeof name !== "string" || name.startsWith("http") || /^\d+$/.test(name) || ["INBOX", "PENDING", "OTHER"].includes(name)) {
                for (var ai = 0; ai < args.length; ai++) {
                  var av = utils.unwrapLsVal(args[ai]);
                  if (typeof av === "string" && av.length > 0 && !av.startsWith("http") && !av.startsWith("/") && !/^\d+$/.test(av) && !["INBOX", "PENDING", "OTHER", "ARCHIVED", "COMMUNITY"].includes(av)) {
                    name = av;
                    break;
                  }
                }
              }

              if (name && typeof name === "string") {
                threadObj.threadName = String(name);
                threadObj.name = String(name);
              }
            }

            if (pName === "syncUpdateThreadName") {
              var sName = utils.unwrapLsVal(args[0]);
              var sTid = utils.unwrapLsVal(args[1]);
              if (String(sTid) === tId && sName) {
                threadObj.threadName = String(sName);
                threadObj.name = String(sName);
              }
            }

            // 2. Participants and Admin status
            if (
              pName === "deleteThenInsertThreadParticipant" ||
              pName === "LSDeleteThenInsertThreadParticipant" ||
              pName === "addParticipantIdToGroupThread" ||
              pName === "LSAddParticipantIdToGroupThread" ||
              pName === "upsertThreadParticipant" ||
              pName === "updateThreadParticipantAdminStatus"
            ) {
              var rawTKey = utils.unwrapLsVal(args[0]);
              if (rawTKey && String(rawTKey) !== tId) return; // Chỉ lấy participant thuộc nhóm đang hỏi!

              var rawCId = utils.unwrapLsVal(args[1]);
              if (!rawCId) return;
              var cId = String(rawCId);

              if (!threadObj.participantIDs.includes(cId)) {
                threadObj.participantIDs.push(cId);
              }

              // Nickname / Role text
              var roleOrNick = utils.unwrapLsVal(args[7]) || utils.unwrapLsVal(args[5]);
              if (roleOrNick && !String(roleOrNick).startsWith("Added by") && !String(roleOrNick).includes("creator")) {
                threadObj.nicknames[cId] = String(roleOrNick);
              }

              // Nhận diện Quản Trị Viên (Admin / Creator):
              // args[6] trong addParticipantIdToGroupThread là boolean true nếu là admin/creator
              // args[13] là boolean true nếu là creator/super admin
              // args[7] là "Group creator" hoặc chứa "admin"
              // args[8] trong deleteThenInsertThreadParticipant là is_creator
              // args[2] trong updateThreadParticipantAdminStatus là is_admin
              var isArg13Admin = (args[13] === true || args[13] === 1 || args[13] === "1" || String(args[13]) === "true");
              var isRoleCreator = (String(args[7] || "").toLowerCase().includes("creator") || String(args[7] || "").toLowerCase().includes("admin"));
              var isAdminVal = utils.unwrapLsVal(args[6]);
              var isCreatorVal = utils.unwrapLsVal(args[8]);
              var isAdminStatusVal = utils.unwrapLsVal(args[2]);

              var isAdmin = Boolean(
                isArg13Admin ||
                isRoleCreator ||
                isAdminVal === 1 || isAdminVal === "1" || isAdminVal === true ||
                isCreatorVal === 1 || isCreatorVal === "1" || isCreatorVal === true ||
                (pName.includes("ParticipantAdminStatus") && (isAdminStatusVal === 1 || isAdminStatusVal === "1" || isAdminStatusVal === true))
              );

              var isNotAdmin = Boolean(
                pName.includes("ParticipantAdminStatus") &&
                (isAdminStatusVal === 0 || isAdminStatusVal === "0" || isAdminStatusVal === false)
              );

              if (isAdmin) {
                if (!threadObj.adminIDs.some(function(a) { return (a.id || a) == cId; })) {
                  threadObj.adminIDs.push({ id: cId });
                }
              } else if (isNotAdmin) {
                threadObj.adminIDs = threadObj.adminIDs.filter(function(a) { return (a.id || a) != cId; });
              }

              if (!threadObj.userInfo.some(function(u) { return u.id == cId; })) {
                var cachedU = global.Fca?.Data?.Userinfo?.get(cId);
                var realName = (threadObj.nicknames && threadObj.nicknames[cId])
                  || (cachedU && cachedU.name && cachedU.name !== "Facebook User" ? cachedU.name : null)
                  || "Facebook User";
                threadObj.userInfo.push({
                  id: cId,
                  name: realName
                });
              }
            }

            if (pName === "verifyContactRowExists" || pName === "LSVerifyContactRowExists") {
              var vcId = String(utils.unwrapLsVal(args[0]) || "");
              var vcName = utils.unwrapLsVal(args[3]);
              if (vcId && vcName && typeof vcName === "string" && !vcName.startsWith("http")) {
                var foundU = threadObj.userInfo.find(function(u) { return u.id == vcId; });
                if (foundU) {
                  foundU.name = vcName;
                } else {
                  threadObj.userInfo.push({ id: vcId, name: vcName });
                }
                if (!global.Fca.Data.Userinfo) global.Fca.Data.Userinfo = new Map();
                global.Fca.Data.Userinfo.set(vcId, { id: vcId, name: vcName });
              }
            }

            if (pName === "deleteThenInsertContact" || pName === "LSDeleteThenInsertContact") {
              var dcId = String(utils.unwrapLsVal(args[0]) || "");
              var dcName = utils.unwrapLsVal(args[9]) || utils.unwrapLsVal(args[10]) || utils.unwrapLsVal(args[18]);
              if (dcId && dcName && typeof dcName === "string" && !dcName.startsWith("http")) {
                var foundU2 = threadObj.userInfo.find(function(u) { return u.id == dcId; });
                if (foundU2) {
                  foundU2.name = dcName;
                } else {
                  threadObj.userInfo.push({ id: dcId, name: dcName });
                }
                if (!global.Fca.Data.Userinfo) global.Fca.Data.Userinfo = new Map();
                global.Fca.Data.Userinfo.set(dcId, { id: dcId, name: dcName });
              }
            }
          });

          if (hasTargetThreadProc || threadObj.participantIDs.length > 0) {
            if (!threadObj.threadName || threadObj.threadName.trim() === "") {
              var memberNames = threadObj.userInfo
                .map(function(u) { return u.name; })
                .filter(function(n) { return n && n !== "Facebook User"; });
              if (memberNames.length > 0) {
                var genName = memberNames.slice(0, 3).join(", ");
                threadObj.threadName = genName;
                threadObj.name = genName;
              } else {
                threadObj.threadName = "Nhóm Messenger";
                threadObj.name = "Nhóm Messenger";
              }
            }
            return threadObj;
          }
          return null;
        }
      })
      .then(function(info) {
        if (info) {
          if (global.Fca && global.Fca.isThread) {
            global.Fca.isThread.set(tId, info);
          }
          try {
            var { updateData, hasData } = require("../shiina/Extra/Shiina-GetThread");
            if (hasData(tId)) updateData(tId, info);
          } catch (_) {}

          callback(null, info);
          resolveFunc(info);
        } else {
          returnFallback();
        }
      })
      .catch(function(err) {
        log.warn("getThreadMain", "Lightspeed Task 209 warning: " + (err.message || err));
        returnFallback();
      });

      return returnPromise;
    }

    returnFallback();
    return returnPromise;
  };
};