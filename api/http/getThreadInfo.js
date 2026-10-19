api: "api.getThreadInfo";

/**
 * api/http/getThreadInfo.js
 * Lấy thông tin nhóm/thread chuẩn FCA:
 * Luôn trả về đầy đủ các trường thiết yếu:
 * threadID, threadName, participantIDs, userInfo (mảng object chứa {id, name,...}), adminIDs, isGroup...
 */

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
    var messageThread = data?.message_thread;
    if (!messageThread) return null;

    var threadID = messageThread.thread_key?.thread_fbid || messageThread.thread_key?.other_user_id;

    var lastM = messageThread.last_message;
    var snippetID =
        lastM &&
        lastM.nodes &&
        lastM.nodes[0] &&
        lastM.nodes[0].message_sender &&
        lastM.nodes[0].message_sender.messaging_actor
            ? lastM.nodes[0].message_sender.messaging_actor.id
            : null;
    var snippetText = lastM && lastM.nodes && lastM.nodes[0] ? lastM.nodes[0].snippet : null;
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

module.exports = function(ctx, http, api) {
    const { getThread, saveThread } = require("../../shiina/database");

    function getFallbackObj(tId) {
        const cached = getThread(tId) || {};
        const pIDs = Array.isArray(cached.participantIDs) && cached.participantIDs.length > 0
            ? cached.participantIDs
            : [tId, String(ctx.userID || "")].filter(Boolean);

        const uInfo = Array.isArray(cached.userInfo) && cached.userInfo.length > 0
            ? cached.userInfo
            : pIDs.map(id => ({
                id: String(id),
                name: (cached.nicknames && cached.nicknames[id]) || "Facebook User"
            }));

        const admins = Array.isArray(cached.adminIDs) && cached.adminIDs.length > 0
            ? cached.adminIDs
            : [{ id: String(ctx.userID || "") }];

        return {
            threadID: String(tId),
            threadName: cached.name || cached.threadName || "Nhóm Messenger",
            name: cached.name || cached.threadName || "Nhóm Messenger",
            participantIDs: pIDs,
            userInfo: uInfo,
            adminIDs: admins,
            unreadCount: 0,
            messageCount: cached.messageCount || 0,
            timestamp: Date.now(),
            isGroup: String(tId).length >= 15,
            isSubscribed: true,
            folder: "INBOX",
            nicknames: cached.nicknames || {}
        };
    }

    return async function getThreadInfo(threadID, callback) {
        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof callback !== "function") {
            callback = (err, data) => (err ? rejectFunc(err) : resolveFunc(data));
        }

        const tId = Array.isArray(threadID) ? String(threadID[0]) : String(threadID);

        // 1. Kiểm tra cache bộ nhớ (chỉ trả cache nếu đã có dữ liệu thật từ GraphQL)
        const cached = getThread(tId);
        if (cached && Array.isArray(cached.userInfo) && cached.userInfo.length > 0 && cached.threadName && cached.threadName !== "Nhóm Messenger" && cached.userInfo[0]?.name !== "Facebook User") {
            callback(null, cached);
            resolveFunc(cached);
            return returnPromise;
        }

        // 2. Query GraphQL chuẩn Meta
        try {
            const form = {
                av: ctx.globalOptions?.pageID || ctx.userID || "",
                fb_api_caller_class: "RelayModern",
                fb_api_req_friendly_name: "MwInboxThreadQuery",
                fb_dtsg: ctx.fb_dtsg,
                doc_id: "3449967031715030",
                variables: JSON.stringify({
                    id: String(tId),
                    message_limit: 0,
                    load_messages: false,
                    load_read_receipts: false,
                    before: null,
                    image_size: 720
                }),
                server_timestamps: true
            };

            const res = await http.post("https://www.facebook.com/api/graphql/", form);
            const resData = typeof res.data === "object" ? res.data : JSON.parse(String(res.data || "").replace(/^[^{[]*/, ""));

            if (resData?.data?.message_thread) {
                const formatted = formatThreadGraphQLResponse(resData.data);
                if (formatted) {
                    saveThread(tId, formatted.threadName, formatted.isGroup, formatted);
                    callback(null, formatted);
                    resolveFunc(formatted);
                    return returnPromise;
                }
            }
        } catch (_) {}

        // 3. Fallback đảm bảo userInfo là mảng iterable
        const fallback = getFallbackObj(tId);
        callback(null, fallback);
        resolveFunc(fallback);
        return returnPromise;
    };
};
