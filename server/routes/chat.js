const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { requireUser } = require("../middleware/auth");
const { broadcastToConversation, broadcastToUser } = require("../chat-ws");
const {
  createUserKey,
  getUserKey,
  replaceUserKey,
  updateKeyBackup,
  searchUsersWithKeys,
  createConversation,
  getConversationById,
  findDirectConversation,
  getUserConversations,
  getConversationMembers,
  getConversationMember,
  addConversationMember,
  removeConversationMember,
  updateLastReadAt,
  deleteConversation,
  leaveConversation,
  createKeyEpoch,
  getKeyEpochsForUser,
  rekeyConversation,
  createMessage,
  getMessages,
  getMessagesBefore,
  countUnreadMessages,
  getUsernamesMap,
} = require("../database");

const router = Router();

// --- Rate limits ---

const conversationCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many conversations created. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const messageCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many messages sent. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const userSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many search requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Validation helpers ---

const ID_REGEX = /^[A-Za-z0-9_-]{22}$/;

function isValidId(id) {
  return typeof id === "string" && ID_REGEX.test(id);
}

// --- Logging ---

function logAction(action, req, extra = {}) {
  const ip = req.ip || req.connection?.remoteAddress;
  console.log(JSON.stringify({ ts: new Date().toISOString(), action, ip, ...extra }));
}

// ============================================================
// User Keys
// ============================================================

// POST /api/chat/keys — Upload RSA public key + encrypted private key backup
router.post("/keys", requireUser, (req, res) => {
  const { publicKey, encryptedPrivateKey, privateKeyIv, privateKeySalt } = req.body || {};

  if (!publicKey || typeof publicKey !== "string") {
    return res.status(400).json({ error: "publicKey is required and must be a string" });
  }

  const existing = getUserKey(req.user.id);
  if (existing) {
    return res.status(409).json({ error: "Key already exists. Use replace endpoint." });
  }

  try {
    createUserKey({
      userId: req.user.id,
      publicKey,
      encryptedPrivateKey: encryptedPrivateKey || null,
      privateKeyIv: privateKeyIv || null,
      privateKeySalt: privateKeySalt || null,
    });

    logAction("chat:key_create", req, { userId: req.user.id });
    res.status(201).json({ success: true });
  } catch (err) {
    logAction("chat:key_create_error", req, { userId: req.user.id, error: err.message });
    res.status(500).json({ error: "Failed to create key" });
  }
});

// GET /api/chat/keys/backup — Get encrypted private key backup
// IMPORTANT: This route MUST be defined BEFORE /api/chat/keys/:userId
router.get("/keys/backup", requireUser, (req, res) => {
  const row = getUserKey(req.user.id);
  if (!row) {
    return res.status(404).json({ error: "Key not found" });
  }

  logAction("chat:key_backup_read", req, { userId: req.user.id });
  res.json({
    encryptedPrivateKey: row.encrypted_private_key,
    privateKeyIv: row.private_key_iv,
    privateKeySalt: row.private_key_salt,
  });
});

// PUT /api/chat/keys/backup — Update encrypted backup (on password change)
router.put("/keys/backup", requireUser, (req, res) => {
  const { encryptedPrivateKey, privateKeyIv, privateKeySalt } = req.body || {};

  if (!encryptedPrivateKey || !privateKeyIv || !privateKeySalt) {
    return res.status(400).json({ error: "Missing required fields: encryptedPrivateKey, privateKeyIv, privateKeySalt" });
  }

  try {
    updateKeyBackup({
      userId: req.user.id,
      encryptedPrivateKey,
      privateKeyIv,
      privateKeySalt,
    });

    logAction("chat:key_backup_update", req, { userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    logAction("chat:key_backup_update_error", req, { userId: req.user.id, error: err.message });
    res.status(500).json({ error: "Failed to update key backup" });
  }
});

// POST /api/chat/keys/replace — Replace RSA key pair
router.post("/keys/replace", requireUser, (req, res) => {
  const { publicKey, encryptedPrivateKey, privateKeyIv, privateKeySalt } = req.body || {};

  if (!publicKey || typeof publicKey !== "string") {
    return res.status(400).json({ error: "publicKey is required and must be a string" });
  }

  try {
    replaceUserKey({
      userId: req.user.id,
      publicKey,
      encryptedPrivateKey: encryptedPrivateKey || null,
      privateKeyIv: privateKeyIv || null,
      privateKeySalt: privateKeySalt || null,
    });

    logAction("chat:key_replace", req, { userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    logAction("chat:key_replace_error", req, { userId: req.user.id, error: err.message });
    res.status(500).json({ error: "Failed to replace key" });
  }
});

// GET /api/chat/keys/:userId — Get user's public key
router.get("/keys/:userId", requireUser, (req, res) => {
  const { userId } = req.params;

  if (!isValidId(userId)) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  const row = getUserKey(userId);
  if (!row) {
    return res.status(404).json({ error: "Key not found" });
  }

  logAction("chat:key_read", req, { targetUserId: userId });
  res.json({ publicKey: row.public_key, userId: row.user_id });
});

// ============================================================
// Conversations
// ============================================================

// POST /api/chat/conversations — Create direct or group conversation
router.post("/conversations", conversationCreateLimiter, requireUser, (req, res) => {
  const { type, name, memberIds, keyEpochs } = req.body || {};

  // Validate type
  if (!type || (type !== "direct" && type !== "group")) {
    return res.status(400).json({ error: "type must be 'direct' or 'group'" });
  }

  // Validate name for group conversations
  if (type === "group" && name !== undefined) {
    if (typeof name !== "string" || name.length > 100) {
      return res.status(400).json({ error: "name must be a string up to 100 characters" });
    }
  }

  // Validate memberIds
  if (!Array.isArray(memberIds)) {
    return res.status(400).json({ error: "memberIds must be an array" });
  }

  if (type === "direct") {
    if (memberIds.length !== 1) {
      return res.status(400).json({ error: "Direct conversations must have exactly 1 other member" });
    }
  } else {
    if (memberIds.length < 1) {
      return res.status(400).json({ error: "Group conversations must have at least 1 member" });
    }
    if (memberIds.length > 100) {
      return res.status(400).json({ error: "Group conversations cannot exceed 100 members" });
    }
  }

  for (const mid of memberIds) {
    if (!isValidId(mid)) {
      return res.status(400).json({ error: `Invalid member ID: ${mid}` });
    }
  }

  // Validate keyEpochs
  if (!Array.isArray(keyEpochs) || keyEpochs.length === 0) {
    return res.status(400).json({ error: "keyEpochs array is required" });
  }

  // All participants = creator + memberIds
  const allParticipantIds = [req.user.id, ...memberIds];
  const epochUserIds = new Set(keyEpochs.map((ke) => ke.userId));

  for (const pid of allParticipantIds) {
    if (!epochUserIds.has(pid)) {
      return res.status(400).json({ error: `Missing key epoch for user ${pid}` });
    }
  }

  // Validate each key epoch entry
  for (const ke of keyEpochs) {
    if (!isValidId(ke.userId)) {
      return res.status(400).json({ error: `Invalid userId in keyEpochs: ${ke.userId}` });
    }
    if (typeof ke.keyVersion !== "number" || ke.keyVersion < 1 || !Number.isInteger(ke.keyVersion)) {
      return res.status(400).json({ error: "keyVersion must be an integer >= 1" });
    }
    if (!ke.encryptedKey || typeof ke.encryptedKey !== "string") {
      return res.status(400).json({ error: "encryptedKey is required and must be a string" });
    }
  }

  // For direct conversations, check if one already exists
  if (type === "direct") {
    const existing = findDirectConversation(req.user.id, memberIds[0]);
    if (existing) {
      logAction("chat:conversation_exists", req, { conversationId: existing.id, type: "direct" });

      // Return existing conversation data with members and key epochs
      const members = getConversationMembers(existing.id);
      const epochs = getKeyEpochsForUser(existing.id, req.user.id);

      return res.json({
        id: existing.id,
        type: existing.type,
        name: existing.name,
        createdAt: existing.created_at,
        members: members.map((m) => ({
          id: m.id,
          userId: m.user_id,
          username: m.username,
          avatarUpdatedAt: m.avatar_updated_at || null,
          role: m.role,
          joinedAt: m.joined_at,
          lastReadAt: m.last_read_at,
        })),
        keyEpochs: epochs.map((e) => ({
          id: e.id,
          keyVersion: e.key_version,
          encryptedKey: e.encrypted_key,
          createdAt: e.created_at,
        })),
      });
    }
  }

  // Generate IDs
  const conversationId = crypto.randomBytes(16).toString("base64url");

  const members = [];
  // Creator
  members.push({
    id: crypto.randomBytes(16).toString("base64url"),
    userId: req.user.id,
    role: type === "group" ? "admin" : "member",
  });

  // Other members
  for (const mid of memberIds) {
    members.push({
      id: crypto.randomBytes(16).toString("base64url"),
      userId: mid,
      role: "member",
    });
  }

  // Build key epochs with generated IDs
  const epochRecords = keyEpochs.map((ke) => ({
    id: crypto.randomBytes(16).toString("base64url"),
    userId: ke.userId,
    keyVersion: ke.keyVersion,
    encryptedKey: ke.encryptedKey,
  }));

  try {
    createConversation({
      id: conversationId,
      name: name || null,
      type,
      createdBy: req.user.id,
      members,
      keyEpochs: epochRecords,
    });

    logAction("chat:conversation_create", req, {
      conversationId,
      type,
      memberCount: members.length,
    });

    res.status(201).json({
      id: conversationId,
      type,
      name: name || null,
      createdAt: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    logAction("chat:conversation_create_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// GET /api/chat/conversations — List user's conversations
router.get("/conversations", requireUser, (req, res) => {
  try {
    const conversations = getUserConversations(req.user.id);

    const result = conversations.map((conv) => {
      const members = getConversationMembers(conv.id);
      const keyEpochs = getKeyEpochsForUser(conv.id, req.user.id);
      const lastReadAt = conv.last_read_at || 0;
      const unreadCount = countUnreadMessages(conv.id, lastReadAt);

      return {
        id: conv.id,
        name: conv.name,
        type: conv.type,
        keyVersion: conv.key_version,
        createdBy: conv.created_by,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
        role: conv.role,
        lastReadAt: conv.last_read_at,
        joinedAt: conv.joined_at,
        members: members.map((m) => ({
          id: m.id,
          userId: m.user_id,
          username: m.username,
          avatarUpdatedAt: m.avatar_updated_at || null,
          role: m.role,
          joinedAt: m.joined_at,
          lastReadAt: m.last_read_at,
        })),
        keyEpochs: keyEpochs.map((e) => ({
          id: e.id,
          keyVersion: e.key_version,
          encryptedKey: e.encrypted_key,
          createdAt: e.created_at,
        })),
        unreadCount,
      };
    });

    logAction("chat:conversation_list", req, { count: result.length });
    res.json({ conversations: result });
  } catch (err) {
    logAction("chat:conversation_list_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

// GET /api/chat/conversations/:id — Get conversation details + members + key epochs
router.get("/conversations/:id", requireUser, (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }

  const membership = getConversationMember(id, req.user.id);
  if (!membership) {
    return res.status(403).json({ error: "Not a member of this conversation" });
  }

  const conversation = getConversationById(id);
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const members = getConversationMembers(id);
  const keyEpochs = getKeyEpochsForUser(id, req.user.id);

  logAction("chat:conversation_read", req, { conversationId: id });

  res.json({
    id: conversation.id,
    name: conversation.name,
    type: conversation.type,
    keyVersion: conversation.key_version,
    createdBy: conversation.created_by,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    members: members.map((m) => ({
      id: m.id,
      userId: m.user_id,
      username: m.username,
      role: m.role,
      joinedAt: m.joined_at,
      lastReadAt: m.last_read_at,
    })),
    keyEpochs: keyEpochs.map((e) => ({
      id: e.id,
      keyVersion: e.key_version,
      encryptedKey: e.encrypted_key,
      createdAt: e.created_at,
    })),
  });
});

// POST /api/chat/conversations/:id/members — Add member
router.post("/conversations/:id/members", requireUser, (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }

  // Verify requesting user is admin
  const requesterMembership = getConversationMember(id, req.user.id);
  if (!requesterMembership) {
    return res.status(403).json({ error: "Not a member of this conversation" });
  }
  if (requesterMembership.role !== "admin") {
    return res.status(403).json({ error: "Only admins can add members" });
  }

  const conversation = getConversationById(id);
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  if (conversation.type !== "group") {
    return res.status(400).json({ error: "Cannot add members to direct conversations" });
  }

  const { userId, encryptedKey, keyVersion, role } = req.body || {};

  if (!userId || !isValidId(userId)) {
    return res.status(400).json({ error: "Valid userId is required" });
  }
  if (!encryptedKey || typeof encryptedKey !== "string") {
    return res.status(400).json({ error: "encryptedKey is required and must be a string" });
  }
  if (typeof keyVersion !== "number" || keyVersion < 1 || !Number.isInteger(keyVersion)) {
    return res.status(400).json({ error: "keyVersion must be an integer >= 1" });
  }

  // Check user is not already a member
  const existingMember = getConversationMember(id, userId);
  if (existingMember) {
    return res.status(409).json({ error: "User is already a member of this conversation" });
  }

  try {
    const memberId = crypto.randomBytes(16).toString("base64url");
    const epochId = crypto.randomBytes(16).toString("base64url");

    addConversationMember({
      id: memberId,
      conversationId: id,
      userId,
      role: role || "member",
    });

    createKeyEpoch({
      id: epochId,
      conversationId: id,
      userId,
      keyVersion,
      encryptedKey,
    });

    logAction("chat:member_add", req, { conversationId: id, newMemberId: userId });

    // Notify conversation members via WebSocket
    broadcastToConversation(id, {
      type: "member_added",
      conversationId: id,
      member: { userId, role: role || "member" },
    });

    res.json({ success: true });
  } catch (err) {
    logAction("chat:member_add_error", req, { conversationId: id, error: err.message });
    res.status(500).json({ error: "Failed to add member" });
  }
});

// DELETE /api/chat/conversations/:id/members/:userId — Remove member
router.delete("/conversations/:id/members/:userId", requireUser, (req, res) => {
  const { id, userId } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }
  if (!isValidId(userId)) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  // Verify requesting user is admin
  const requesterMembership = getConversationMember(id, req.user.id);
  if (!requesterMembership) {
    return res.status(403).json({ error: "Not a member of this conversation" });
  }
  if (requesterMembership.role !== "admin") {
    return res.status(403).json({ error: "Only admins can remove members" });
  }

  // Cannot remove self via this endpoint (use leave instead)
  if (userId === req.user.id) {
    return res.status(400).json({ error: "Use the leave endpoint to remove yourself" });
  }

  // Verify target is a member
  const targetMembership = getConversationMember(id, userId);
  if (!targetMembership) {
    return res.status(404).json({ error: "User is not a member of this conversation" });
  }

  try {
    removeConversationMember(id, userId);

    logAction("chat:member_remove", req, { conversationId: id, removedUserId: userId });

    // Notify conversation members + removed user via WebSocket
    broadcastToConversation(id, {
      type: "member_removed",
      conversationId: id,
      userId,
    });
    broadcastToUser(userId, {
      type: "member_removed",
      conversationId: id,
      userId,
    });

    res.json({ success: true });
  } catch (err) {
    logAction("chat:member_remove_error", req, { conversationId: id, error: err.message });
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// DELETE /api/chat/conversations/:id — Leave/delete conversation
router.delete("/conversations/:id", requireUser, (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }

  const membership = getConversationMember(id, req.user.id);
  if (!membership) {
    return res.status(403).json({ error: "Not a member of this conversation" });
  }

  try {
    leaveConversation(id, req.user.id);

    logAction("chat:conversation_leave", req, { conversationId: id });
    res.json({ success: true });
  } catch (err) {
    logAction("chat:conversation_leave_error", req, { conversationId: id, error: err.message });
    res.status(500).json({ error: "Failed to leave conversation" });
  }
});

// ============================================================
// Messages
// ============================================================

// POST /api/chat/conversations/:id/messages — Send encrypted message
router.post("/conversations/:id/messages", messageCreateLimiter, requireUser, (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }

  // Verify membership
  const membership = getConversationMember(id, req.user.id);
  if (!membership) {
    return res.status(403).json({ error: "Not a member of this conversation" });
  }

  const { ciphertext, iv, keyVersion } = req.body || {};

  // Validate ciphertext
  if (!ciphertext || typeof ciphertext !== "string") {
    return res.status(400).json({ error: "ciphertext is required and must be a string" });
  }
  if (ciphertext.length > 50 * 1024) {
    return res.status(413).json({ error: "ciphertext too large (max 50KB)" });
  }

  // Validate iv
  if (!iv || typeof iv !== "string") {
    return res.status(400).json({ error: "iv is required and must be a string" });
  }

  // Validate keyVersion
  if (typeof keyVersion !== "number" || keyVersion < 1 || !Number.isInteger(keyVersion)) {
    return res.status(400).json({ error: "keyVersion must be an integer >= 1" });
  }

  try {
    const messageId = crypto.randomBytes(16).toString("base64url");
    const result = createMessage({
      id: messageId,
      conversationId: id,
      senderId: req.user.id,
      ciphertext,
      iv,
      keyVersion,
    });

    logAction("chat:message_send", req, { conversationId: id, messageId });

    // Broadcast to other conversation members via WebSocket
    broadcastToConversation(id, {
      type: "message",
      id: messageId,
      conversationId: id,
      senderId: req.user.id,
      ciphertext,
      iv,
      keyVersion,
      createdAt: Math.floor(Date.now() / 1000),
    }, req.user.id);

    res.status(201).json({
      id: messageId,
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    logAction("chat:message_send_error", req, { conversationId: id, error: err.message });
    res.status(500).json({ error: "Failed to send message" });
  }
});

// GET /api/chat/conversations/:id/messages — Message history
router.get("/conversations/:id/messages", requireUser, (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }

  // Verify membership
  const membership = getConversationMember(id, req.user.id);
  if (!membership) {
    return res.status(403).json({ error: "Not a member of this conversation" });
  }

  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  let limit = parseInt(req.query.limit, 10) || 50;
  if (limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  let messages;
  if (before && !isNaN(before)) {
    messages = getMessagesBefore(id, before, limit);
  } else {
    messages = getMessages(id, limit, 0);
  }

  // Update last read timestamp
  updateLastReadAt(id, req.user.id, Math.floor(Date.now() / 1000));

  logAction("chat:message_list", req, { conversationId: id, count: messages.length, before: before || null });

  // Resolve sender usernames
  const senderIds = [...new Set(messages.map((m) => m.sender_id))];
  const usernames = getUsernamesMap(senderIds);

  res.json({
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      senderUsername: usernames.get(m.sender_id) || null,
      ciphertext: m.ciphertext,
      iv: m.iv,
      keyVersion: m.key_version,
      createdAt: m.created_at,
      expiresAt: m.expires_at,
    })),
  });
});

// ============================================================
// Key Epochs
// ============================================================

// GET /api/chat/conversations/:id/key-epochs — Get key epochs for current user
router.get("/conversations/:id/key-epochs", requireUser, (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }

  const membership = getConversationMember(id, req.user.id);
  if (!membership) {
    return res.status(403).json({ error: "Not a member of this conversation" });
  }

  const keyEpochs = getKeyEpochsForUser(id, req.user.id);

  logAction("chat:key_epochs_read", req, { conversationId: id, count: keyEpochs.length });

  res.json({
    keyEpochs: keyEpochs.map((e) => ({
      id: e.id,
      keyVersion: e.key_version,
      encryptedKey: e.encrypted_key,
      createdAt: e.created_at,
    })),
  });
});

// POST /api/chat/conversations/:id/rekey — Submit new key epoch
router.post("/conversations/:id/rekey", requireUser, (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }

  const membership = getConversationMember(id, req.user.id);
  if (!membership) {
    return res.status(403).json({ error: "Not a member of this conversation" });
  }

  const conversation = getConversationById(id);
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  // For group conversations, only admins can rekey
  if (conversation.type === "group" && membership.role !== "admin") {
    return res.status(403).json({ error: "Only admins can rekey group conversations" });
  }

  const { newKeyVersion, encryptedKeys } = req.body || {};

  // Validate newKeyVersion
  if (typeof newKeyVersion !== "number" || newKeyVersion <= conversation.key_version || !Number.isInteger(newKeyVersion)) {
    return res.status(400).json({ error: "newKeyVersion must be an integer greater than the current key_version" });
  }

  // Validate encryptedKeys
  if (!Array.isArray(encryptedKeys) || encryptedKeys.length === 0) {
    return res.status(400).json({ error: "encryptedKeys array is required" });
  }

  for (const ek of encryptedKeys) {
    if (!isValidId(ek.userId)) {
      return res.status(400).json({ error: `Invalid userId in encryptedKeys: ${ek.userId}` });
    }
    if (!ek.encryptedKey || typeof ek.encryptedKey !== "string") {
      return res.status(400).json({ error: "encryptedKey is required and must be a string for each entry" });
    }
  }

  try {
    rekeyConversation(id, newKeyVersion, encryptedKeys);

    logAction("chat:rekey", req, { conversationId: id, newKeyVersion, recipientCount: encryptedKeys.length });

    // Notify conversation members about rekey
    broadcastToConversation(id, {
      type: "rekey",
      conversationId: id,
      newKeyVersion,
    });

    res.json({ success: true, keyVersion: newKeyVersion });
  } catch (err) {
    logAction("chat:rekey_error", req, { conversationId: id, error: err.message });
    res.status(500).json({ error: "Failed to rekey conversation" });
  }
});

// ============================================================
// User Search
// ============================================================

// GET /api/chat/users/search?q=query — Search/list users by username
router.get("/users/search", userSearchLimiter, requireUser, (req, res) => {
  const q = req.query.q;

  try {
    // Empty query returns all users (for listing), non-empty filters
    const users = q && typeof q === "string" && q.length >= 1
      ? searchUsersWithKeys(q, req.user.id)
      : searchUsersWithKeys("", req.user.id);

    logAction("chat:user_search", req, { query: q || "(all)", resultCount: users.length });

    res.json({
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        hasPublicKey: !!u.has_public_key,
        avatarUpdatedAt: u.avatar_updated_at || null,
      })),
    });
  } catch (err) {
    logAction("chat:user_search_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to search users" });
  }
});

module.exports = router;
