"use strict";
/**
 * shiina/Dgw/frames.js
 * Xây dựng và parse DGW binary frames
 * Protocol: wss://gateway.facebook.com/ws/lightspeed
 *
 * Cấu trúc packet:
 *   [opcode (1B)] [streamID (2B LE)] [payloadLen (3B LE)] [payload]
 */

// Opcodes
const OP = {
    ACK:       0x0c,
    DATA:      0x0d,
    HEARTBEAT: 0x0e,
    META:      0x0f,
    PING:      0x09,
    PONG:      0x0a
};

/**
 * Build generic DGW packet
 */
function buildPacket(opcode, streamID, payload) {
    const payloadBuf = payload ? Buffer.from(payload) : Buffer.alloc(0);
    const buf = Buffer.alloc(6 + payloadBuf.length);
    buf.writeUInt8(opcode, 0);
    buf.writeUInt16LE(streamID, 1);
    // 24-bit LE payload length at offset 3
    buf.writeUInt8(payloadBuf.length & 0xff, 3);
    buf.writeUInt8((payloadBuf.length >> 8) & 0xff, 4);
    buf.writeUInt8((payloadBuf.length >> 16) & 0xff, 5);
    if (payloadBuf.length > 0) payloadBuf.copy(buf, 6);
    return buf;
}

function buildHeartbeat(streamID = 0) {
    const buf = Buffer.alloc(3);
    buf.writeUInt8(OP.HEARTBEAT, 0);
    buf.writeUInt16LE(streamID, 1);
    return buf;
}

function buildPing() { return Buffer.from([OP.PING]); }
function buildPong() { return Buffer.from([OP.PONG]); }

function buildAck(streamID, seq) {
    return buildPacket(OP.ACK, streamID, Buffer.from([seq & 0xff, 0x00]));
}

function buildMeta(streamID, headersObj) {
    const json = JSON.stringify(headersObj || {});
    return buildPacket(OP.META, streamID, Buffer.from(json, "utf8"));
}

/**
 * Build DATA packet với JSON payload
 * @param {number} streamID
 * @param {object} jsonPayload - object sẽ được JSON.stringify
 * @param {number} seq - sequence byte
 */
function buildData(streamID, jsonPayload, seq = 0) {
    const jsonStr = typeof jsonPayload === "string" ? jsonPayload : JSON.stringify(jsonPayload);
    const jsonBuf = Buffer.from(jsonStr, "utf8");
    // DATA có thêm seq byte ở đầu payload
    const payload = Buffer.alloc(1 + jsonBuf.length);
    payload.writeUInt8(seq & 0xff, 0);
    jsonBuf.copy(payload, 1);
    return buildPacket(OP.DATA, streamID, payload);
}

/**
 * Parse binary DGW frames từ buffer
 * @param {Buffer} buffer
 * @returns {Array<{kind, opcode, streamID, seq, payload}>}
 */
function parseFrames(buffer) {
    const frames = [];
    let offset = 0;

    while (offset < buffer.length) {
        if (offset + 1 > buffer.length) break;
        const opcode = buffer.readUInt8(offset);

        // Single-byte opcodes
        if (opcode === OP.PING) {
            frames.push({ kind: "ping", opcode });
            offset += 1;
            continue;
        }
        if (opcode === OP.PONG) {
            frames.push({ kind: "pong", opcode });
            offset += 1;
            continue;
        }

        // HEARTBEAT: 3 bytes
        if (opcode === OP.HEARTBEAT) {
            if (offset + 3 > buffer.length) break;
            const streamID = buffer.readUInt16LE(offset + 1);
            frames.push({ kind: "heartbeat", opcode, streamID });
            offset += 3;
            continue;
        }

        // Standard 6-byte header packets
        if (offset + 6 > buffer.length) break;
        const streamID = buffer.readUInt16LE(offset + 1);
        const payloadLen = buffer.readUInt8(offset + 3)
                         | (buffer.readUInt8(offset + 4) << 8)
                         | (buffer.readUInt8(offset + 5) << 16);

        if (offset + 6 + payloadLen > buffer.length) break;
        const rawPayload = buffer.slice(offset + 6, offset + 6 + payloadLen);

        if (opcode === OP.ACK) {
            frames.push({ kind: "ack", opcode, streamID, payload: rawPayload });
        } else if (opcode === OP.META) {
            let headers = {};
            try { headers = JSON.parse(rawPayload.toString("utf8")); } catch (_) {}
            frames.push({ kind: "meta", opcode, streamID, headers });
        } else if (opcode === OP.DATA) {
            let seq = 0;
            let payload = rawPayload;
            if (payload.length >= 2 && (payload[1] === 0x80 || payload[1] === 0x00)) {
                seq = payload[0];
                payload = payload.slice(2);
            } else if (payload.length >= 1) {
                seq = payload[0];
                payload = payload.slice(1);
            }
            frames.push({ kind: "data", opcode, streamID, seq, payload });
        } else {
            frames.push({ kind: "unknown", opcode, streamID, payload: rawPayload });
        }

        offset += 6 + payloadLen;
    }

    return frames;
}

module.exports = { OP, buildPacket, buildHeartbeat, buildPing, buildPong, buildAck, buildMeta, buildData, parseFrames };
