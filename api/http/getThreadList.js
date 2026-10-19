"use strict";
api: "api.getThreadList";

const Database = require("../../shiina/database");

module.exports = function(ctx, http, api) {
    return function getThreadList(limit, timestamp, tags, callback) {
        if (!callback && (typeof tags === "function" || typeof tags === "object")) {
            if (typeof tags === "function") {
                callback = tags;
                tags = ["INBOX"];
            }
        }
        if (!callback && typeof timestamp === "function") {
            callback = timestamp;
            timestamp = null;
        }
        if (typeof limit === "function") {
            callback = limit;
            limit = 20;
        }

        let resolveFunc = () => {};
        let rejectFunc = () => {};
        const returnPromise = new Promise((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof callback !== "function") {
            callback = (err, data) => {
                if (err) return rejectFunc(err);
                resolveFunc(data);
            };
        }

        const threads = [];

        // 1. Lấy danh sách thread từ global.Fca.isThread hoặc database cache
        if (global.Fca && global.Fca.isThread) {
            for (const [tId, tData] of global.Fca.isThread) {
                threads.push({
                    threadID: String(tId),
                    name: (tData && tData.name) || (tData && tData.threadName) || "",
                    unreadCount: 0,
                    messageCount: (tData && tData.messageCount) || 0,
                    imageSrc: (tData && tData.imageSrc) || null,
                    emoji: (tData && tData.emoji) || null,
                    color: (tData && tData.color) || null,
                    nicknames: (tData && tData.nicknames) || {},
                    adminIDs: (tData && tData.adminIDs) || [],
                    isGroup: true,
                    participantIDs: (tData && tData.participantIDs) || []
                });
            }
        }

        if (threads.length > 0) {
            callback(null, threads);
            resolveFunc(threads);
            return returnPromise;
        }

        // 2. Thử truy vấn từ database local nếu có
        try {
            const rawThreads = Database.getAllThreads ? Database.getAllThreads() : [];
            if (Array.isArray(rawThreads) && rawThreads.length > 0) {
                for (const t of rawThreads) {
                    threads.push({
                        threadID: String(t.tid),
                        name: t.name || "",
                        unreadCount: 0,
                        messageCount: 0,
                        isGroup: !!t.isGroup,
                        participantIDs: []
                    });
                }
            }
        } catch (_) {}

        // Luôn resolve an toàn, không ném 401/Not logged in gây kích hoạt auto-relogin giả
        callback(null, threads);
        resolveFunc(threads);
        return returnPromise;
    };
};
