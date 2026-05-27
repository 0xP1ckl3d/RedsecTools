/**
 * ChatState — Central state manager for the chat feature.
 *
 * Manages conversation list, message cache, key cache, and the decrypt pipeline.
 * Depends on window.ChatCrypto (chat-crypto.js) and window.ChatWS (chat-ws-client.js).
 */
window.ChatState = (function () {
  // ── State ──────────────────────────────────────────────────────────────
  var conversations = new Map();  // conversationId -> conversation object
  var messages = new Map();       // conversationId -> array of messages
  var keyCache = new Map();       // "conversationId:keyVersion" -> CryptoKey
  var userPublicKeys = new Map(); // userId -> CryptoKey
  var unreadCounts = new Map();   // conversationId -> count
  var onlineUsers = new Set();    // set of userId strings

  var currentConversationId = null;
  var currentUserId = null;

  // ── State change notification ──────────────────────────────────────────
  var stateListeners = new Set();

  function onStateChange(callback) {
    stateListeners.add(callback);
    return function () {
      stateListeners.delete(callback);
    };
  }

  function notifyStateChange(type, data) {
    if (!data) data = {};
    for (var _i = 0, _arr = Array.from(stateListeners); _i < _arr.length; _i++) {
      try {
        _arr[_i](type, data);
      } catch (_err) {
        // swallow listener errors
      }
    }
  }

  // ── Initialization ─────────────────────────────────────────────────────

  function init(userId) {
    currentUserId = userId;

    return refreshConversations().then(function () {
      // Set up WebSocket event listeners
      ChatWS.on("message", handleMessage);
      ChatWS.on("message_edited", handleMessageEdited);
      ChatWS.on("message_deleted", handleMessageDeleted);
      ChatWS.on("typing", handleTyping);
      ChatWS.on("stop_typing", handleStopTyping);
      ChatWS.on("read", handleRead);
      ChatWS.on("rekey", handleRekey);
      ChatWS.on("member_added", handleMemberAdded);
      ChatWS.on("member_removed", handleMemberRemoved);
      ChatWS.on("presence", handlePresence);
      ChatWS.on("connected", function () {
        // Re-fetch conversations on reconnect to catch up
        refreshConversations();
      });
    });
  }

  // ── Conversation Management ────────────────────────────────────────────

  function refreshConversations() {
    return fetch("/api/chat/conversations")
      .then(function (res) {
        if (!res.ok) return;
        return res.json();
      })
      .then(function (data) {
        if (!data) return;

        conversations.clear();
        var keyPromises = [];

        for (var i = 0; i < data.conversations.length; i++) {
          var conv = data.conversations[i];
          conversations.set(conv.id, conv);
          unreadCounts.set(conv.id, conv.unreadCount || 0);

          // Decrypt and cache conversation keys
          if (conv.keyEpochs && conv.keyEpochs.length > 0) {
            keyPromises.push(cacheConversationKeys(conv.id, conv.keyEpochs));
          }
        }

        return Promise.all(keyPromises).then(function () {
          notifyStateChange("conversations");
        });
      });
  }

  function getConversations() {
    return Array.from(conversations.values())
      .sort(function (a, b) {
        return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
      });
  }

  function getCurrentConversation() {
    if (!currentConversationId) return null;
    return conversations.get(currentConversationId) || null;
  }

  function setCurrentConversation(id) {
    currentConversationId = id;
    if (id) {
      return loadMessages(id).then(function () {
        markAsRead(id);
        notifyStateChange("currentConversation");
      });
    }
    notifyStateChange("currentConversation");
    return Promise.resolve();
  }

  function getCurrentUserId() {
    return currentUserId;
  }

  // ── Messages ───────────────────────────────────────────────────────────

  function loadMessages(conversationId, before) {
    var url = "/api/chat/conversations/" + conversationId + "/messages?limit=50";
    if (before) url += "&before=" + before;

    return fetch(url)
      .then(function (res) {
        if (!res.ok) return [];
        return res.json();
      })
      .then(function (data) {
        var msgs = (data && data.messages) || [];

        // Store in cache (prepend if loading earlier messages)
        if (!messages.has(conversationId)) {
          messages.set(conversationId, []);
        }

        if (before) {
          messages.set(conversationId, msgs.concat(messages.get(conversationId)));
        } else {
          messages.set(conversationId, msgs);
        }

        // Decrypt messages
        return decryptMessages(conversationId, msgs).then(function (decrypted) {
          notifyStateChange("messages", { conversationId: conversationId });
          return decrypted;
        });
      });
  }

  function sendMessage(conversationId, plaintext) {
    var key = getLatestKey(conversationId);
    if (!key) return Promise.reject(new Error("No conversation key available"));

    var conv = conversations.get(conversationId);
    var keyVersion = conv ? conv.keyVersion : 1;

    return ChatCrypto.encryptMessage(plaintext, key, keyVersion)
      .then(function (encrypted) {
        return fetch("/api/chat/conversations/" + conversationId + "/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            keyVersion: keyVersion,
          }),
        })
          .then(function (res) {
            if (!res.ok) throw new Error("Failed to send message");
            return res.json();
          })
          .then(function (data) {
            // Add to local cache
            var msg = {
              id: data.id,
              conversationId: conversationId,
              senderId: currentUserId,
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              keyVersion: keyVersion,
              createdAt: Math.floor(Date.now() / 1000),
              decrypted: plaintext,
              isOwn: true,
            };

            if (!messages.has(conversationId)) {
              messages.set(conversationId, []);
            }
            messages.get(conversationId).push(msg);

            notifyStateChange("message", { conversationId: conversationId, message: msg });
            return msg;
          });
      });
  }

  function editMessage(conversationId, messageId, plaintext) {
    var key = getLatestKey(conversationId);
    if (!key) return Promise.reject(new Error("No conversation key available"));

    var conv = conversations.get(conversationId);
    var keyVersion = conv ? conv.keyVersion : 1;

    return ChatCrypto.encryptMessage(plaintext, key, keyVersion)
      .then(function (encrypted) {
        return fetch("/api/chat/conversations/" + conversationId + "/messages/" + messageId, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            keyVersion: keyVersion,
          }),
        })
          .then(function (res) {
            if (!res.ok) {
              return res.json().then(function (err) {
                throw new Error(err.error || "Failed to edit message");
              });
            }
            return res.json();
          })
          .then(function (data) {
            var updated = updateCachedMessage(conversationId, messageId, {
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              keyVersion: keyVersion,
              decrypted: plaintext,
              decryptFailed: false,
              editedAt: data.editedAt,
              deletedAt: null,
            });
            notifyStateChange("message_updated", { conversationId: conversationId, message: updated });
            return updated;
          });
      });
  }

  function deleteMessage(conversationId, messageId) {
    return fetch("/api/chat/conversations/" + conversationId + "/messages/" + messageId, {
      method: "DELETE",
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (err) {
            throw new Error(err.error || "Failed to delete message");
          });
        }
        return res.json();
      })
      .then(function (data) {
        var deletedAt = data.deletedAt || Math.floor(Date.now() / 1000);
        var updated = markCachedMessageDeleted(conversationId, messageId, deletedAt);
        notifyStateChange("message_deleted", { conversationId: conversationId, messageId: messageId, message: updated });
        return updated;
      });
  }

  // ── Conversation Creation ──────────────────────────────────────────────

  function createDirectConversation(userId) {
    // Get other user's public key
    return getOrFetchPublicKey(userId).then(function (pubKey) {
      if (!pubKey) throw new Error("User has no public key");

      // Generate conversation key
      return ChatCrypto.generateConversationKey().then(function (convKey) {
        // Encrypt for self and other user
        return Promise.all([
          getOrFetchPublicKey(currentUserId),
          Promise.resolve(pubKey),
        ]).then(function (keys) {
          return Promise.all([
            ChatCrypto.encryptConversationKeyForMember(convKey, keys[0]),
            ChatCrypto.encryptConversationKeyForMember(convKey, keys[1]),
          ]).then(function (encryptedKeys) {
            var keyVersion = 1;
            var keyEpochs = [
              { userId: currentUserId, keyVersion: keyVersion, encryptedKey: encryptedKeys[0] },
              { userId: userId, keyVersion: keyVersion, encryptedKey: encryptedKeys[1] },
            ];

            return fetch("/api/chat/conversations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "direct",
                memberIds: [userId],
                keyEpochs: keyEpochs,
              }),
            })
              .then(function (res) {
                if (!res.ok) {
                  return res.json().then(function (err) {
                    throw new Error(err.error || "Failed to create conversation");
                  });
                }
                return res.json();
              })
              .then(function (data) {
                return refreshConversations().then(function () {
                  return data;
                });
              });
          });
        });
      });
    });
  }

  function createGroupConversation(name, memberIds) {
    // Fetch public keys for all members
    var allMemberIds = [currentUserId].concat(memberIds);
    var pubKeyPromises = allMemberIds.map(function (uid) {
      return getOrFetchPublicKey(uid).then(function (key) {
        return { userId: uid, pubKey: key };
      });
    });

    return Promise.all(pubKeyPromises).then(function (members) {
      // Validate all keys present
      for (var i = 0; i < members.length; i++) {
        if (!members[i].pubKey) {
          throw new Error("User " + members[i].userId + " has no public key");
        }
      }

      // Generate conversation key
      return ChatCrypto.generateConversationKey().then(function (convKey) {
        // Encrypt key for each member
        var epochPromises = members.map(function (m) {
          return ChatCrypto.encryptConversationKeyForMember(convKey, m.pubKey)
            .then(function (encryptedKey) {
              return {
                userId: m.userId,
                keyVersion: 1,
                encryptedKey: encryptedKey,
              };
            });
        });

        return Promise.all(epochPromises).then(function (keyEpochs) {
          // memberIds sent to server excludes self
          return fetch("/api/chat/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "group",
              name: name,
              memberIds: memberIds,
              keyEpochs: keyEpochs,
            }),
          })
            .then(function (res) {
              if (!res.ok) {
                return res.json().then(function (err) {
                  throw new Error(err.error || "Failed to create group conversation");
                });
              }
              return res.json();
            })
            .then(function (data) {
              return refreshConversations().then(function () {
                return data;
              });
            });
        });
      });
    });
  }

  // ── Key Management ─────────────────────────────────────────────────────

  function cacheConversationKeys(conversationId, keyEpochs) {
    return ChatCrypto.getKeyFromIndexedDB(currentUserId)
      .then(function (privateKey) {
        if (!privateKey) return;

        var promises = [];
        for (var i = 0; i < keyEpochs.length; i++) {
          (function (epoch) {
            var cacheKey = conversationId + ":" + epoch.keyVersion;
            if (keyCache.has(cacheKey)) return;

            promises.push(
              ChatCrypto.decryptConversationKey(epoch.encryptedKey, privateKey)
                .then(function (convKey) {
                  keyCache.set(cacheKey, convKey);
                })
                .catch(function () {
                  // silently skip epochs we cannot decrypt
                })
            );
          })(keyEpochs[i]);
        }

        return Promise.all(promises);
      });
  }

  function getLatestKey(conversationId) {
    var conv = conversations.get(conversationId);
    if (!conv) return null;
    var version = conv.keyVersion || 1;
    return keyCache.get(conversationId + ":" + version) || null;
  }

  function getOrFetchPublicKey(userId) {
    if (userPublicKeys.has(userId)) {
      return Promise.resolve(userPublicKeys.get(userId));
    }

    return fetch("/api/chat/keys/" + userId)
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data) return null;
        return ChatCrypto.importPublicKey(data.publicKey).then(function (key) {
          userPublicKeys.set(userId, key);
          return key;
        });
      });
  }

  // ── Decrypt Pipeline ───────────────────────────────────────────────────

  function decryptMessages(conversationId, msgs) {
    var results = [];
    var promiseChain = Promise.resolve();

    for (var i = 0; i < msgs.length; i++) {
      (function (msg) {
        msg.conversationId = msg.conversationId || conversationId;
        msg.isOwn = msg.senderId === currentUserId;
        if (msg.deletedAt) {
          msg.decrypted = null;
          msg.decryptFailed = false;
          results.push(msg);
          return;
        }

        var cacheKey = conversationId + ":" + msg.keyVersion;
        var convKey = keyCache.get(cacheKey);

        if (convKey) {
          promiseChain = promiseChain.then(function () {
            return ChatCrypto.decryptMessage(msg.ciphertext, msg.iv, convKey)
              .then(function (plaintext) {
                msg.decrypted = plaintext;
              })
              .catch(function () {
                msg.decrypted = null;
                msg.decryptFailed = true;
              });
          });
        } else {
          msg.decrypted = null;
          msg.decryptFailed = true;
        }

        results.push(msg);
      })(msgs[i]);
    }

    return promiseChain.then(function () {
      return results;
    });
  }

  // ── WebSocket Event Handlers ───────────────────────────────────────────

  function handleMessage(data) {
    // data: { id, conversationId, senderId, ciphertext, iv, keyVersion, createdAt }
    var convId = data.conversationId;

    // If this conversation isn't in our local cache, refresh conversation list
    var convMissing = !conversations.has(convId);
    if (convMissing) {
      refreshConversations();
    }

    // Ensure we have the key
    var cacheKey = convId + ":" + data.keyVersion;
    var keyReady = keyCache.has(cacheKey)
      ? Promise.resolve()
      : fetch("/api/chat/conversations/" + convId + "/key-epochs")
          .then(function (res) {
            if (!res.ok) return;
            return res.json();
          })
          .then(function (epochsData) {
            if (epochsData) {
              return cacheConversationKeys(convId, epochsData.keyEpochs);
            }
          })
          .catch(function () {});

    return keyReady.then(function () {
      var convKey = keyCache.get(cacheKey);
      var decrypted = null;
      var decryptFailed = false;

      if (convKey) {
        return ChatCrypto.decryptMessage(data.ciphertext, data.iv, convKey)
          .then(function (text) {
            decrypted = text;
          })
          .catch(function () {
            decryptFailed = true;
          })
          .then(function () {
            finalizeIncomingMessage(data, convId, decrypted, decryptFailed);
          });
      } else {
        decryptFailed = true;
        finalizeIncomingMessage(data, convId, decrypted, decryptFailed);
        return;
      }
    });
  }

  function handleMessageEdited(data) {
    var convId = data.conversationId;
    var cacheKey = convId + ":" + data.keyVersion;
    var keyReady = keyCache.has(cacheKey)
      ? Promise.resolve()
      : fetch("/api/chat/conversations/" + convId + "/key-epochs")
          .then(function (res) {
            if (!res.ok) return;
            return res.json();
          })
          .then(function (epochsData) {
            if (epochsData) {
              return cacheConversationKeys(convId, epochsData.keyEpochs);
            }
          })
          .catch(function () {});

    return keyReady.then(function () {
      var convKey = keyCache.get(cacheKey);
      var decrypted = null;
      var decryptFailed = false;

      var finalize = function () {
        var updated = updateCachedMessage(convId, data.id, {
          senderId: data.senderId,
          ciphertext: data.ciphertext,
          iv: data.iv,
          keyVersion: data.keyVersion,
          createdAt: data.createdAt,
          editedAt: data.editedAt,
          deletedAt: null,
          decrypted: decrypted,
          decryptFailed: decryptFailed,
          isOwn: data.senderId === currentUserId,
        });
        notifyStateChange("message_updated", { conversationId: convId, message: updated });
      };

      if (convKey) {
        return ChatCrypto.decryptMessage(data.ciphertext, data.iv, convKey)
          .then(function (text) {
            decrypted = text;
          })
          .catch(function () {
            decryptFailed = true;
          })
          .then(finalize);
      }

      decryptFailed = true;
      finalize();
      return;
    });
  }

  function handleMessageDeleted(data) {
    var updated = markCachedMessageDeleted(data.conversationId, data.id, data.deletedAt);
    notifyStateChange("message_deleted", {
      conversationId: data.conversationId,
      messageId: data.id,
      message: updated,
    });
  }

  function finalizeIncomingMessage(data, convId, decrypted, decryptFailed) {
    // Resolve sender username from cached conversation members
    var senderUsername = null;
    var conv = conversations.get(convId);
    if (conv && conv.members) {
      for (var i = 0; i < conv.members.length; i++) {
        if (conv.members[i].userId === data.senderId) {
          senderUsername = conv.members[i].username;
          break;
        }
      }
    }

    var msg = {
      id: data.id,
      conversationId: data.conversationId,
      senderId: data.senderId,
      senderUsername: senderUsername,
      ciphertext: data.ciphertext,
      iv: data.iv,
      keyVersion: data.keyVersion,
      createdAt: data.createdAt,
      decrypted: decrypted,
      decryptFailed: decryptFailed,
      isOwn: data.senderId === currentUserId,
    };

    if (!messages.has(convId)) messages.set(convId, []);
    messages.get(convId).push(msg);

    // Update unread if not current conversation
    if (convId !== currentConversationId) {
      unreadCounts.set(convId, (unreadCounts.get(convId) || 0) + 1);
    }

    notifyStateChange("message", { conversationId: convId, message: msg });
  }

  function handleTyping(data) {
    notifyStateChange("typing", data);
  }

  function handleStopTyping(data) {
    notifyStateChange("stop_typing", data);
  }

  function handleRead(data) {
    notifyStateChange("read", data);
  }

  function handleRekey(data) {
    // Cache new keys
    var conv = conversations.get(data.conversationId);
    if (conv) {
      conv.keyVersion = data.newKeyVersion;
      // Process encrypted keys - they come as array of { userId, encryptedKey }
      // The client should fetch key epochs when needed
    }
    notifyStateChange("rekey", data);
  }

  function handleMemberAdded(data) {
    if (conversations.has(data.conversationId)) {
      refreshConversations();
    }
    notifyStateChange("member_added", data);
  }

  function handleMemberRemoved(data) {
    if (data.userId === currentUserId) {
      conversations.delete(data.conversationId);
      messages.delete(data.conversationId);
      unreadCounts.delete(data.conversationId);
      if (currentConversationId === data.conversationId) {
        currentConversationId = null;
      }
    } else {
      refreshConversations();
    }
    notifyStateChange("member_removed", data);
  }

  function handlePresence(data) {
    if (data.status === "online") {
      onlineUsers.add(data.userId);
    } else {
      onlineUsers.delete(data.userId);
    }
    notifyStateChange("presence", data);
  }

  function updateCachedMessage(conversationId, messageId, patch) {
    if (!messages.has(conversationId)) messages.set(conversationId, []);
    var list = messages.get(conversationId);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === messageId) {
        Object.assign(list[i], patch);
        return list[i];
      }
    }

    var created = Object.assign({
      id: messageId,
      conversationId: conversationId,
      isOwn: patch.senderId === currentUserId,
    }, patch);
    list.push(created);
    return created;
  }

  function markCachedMessageDeleted(conversationId, messageId, deletedAt) {
    return updateCachedMessage(conversationId, messageId, {
      ciphertext: "",
      iv: "",
      decrypted: null,
      decryptFailed: false,
      deletedAt: deletedAt || Math.floor(Date.now() / 1000),
      editedAt: null,
    });
  }

  // ── Member Management ──────────────────────────────────────────────────

  function addMemberToConversation(conversationId, userId) {
    return getOrFetchPublicKey(userId).then(function (pubKey) {
      if (!pubKey) throw new Error("User has no public key");

      var conv = conversations.get(conversationId);
      var keyVersion = conv ? conv.keyVersion : 1;
      var convKey = getLatestKey(conversationId);
      if (!convKey) throw new Error("No conversation key available");

      return ChatCrypto.encryptConversationKeyForMember(convKey, pubKey)
        .then(function (encryptedKey) {
          return fetch("/api/chat/conversations/" + conversationId + "/members", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: userId,
              encryptedKey: encryptedKey,
              keyVersion: keyVersion,
            }),
          })
            .then(function (res) {
              if (!res.ok) {
                return res.json().then(function (err) {
                  throw new Error(err.error || "Failed to add member");
                });
              }
            })
            .then(function () {
              return refreshConversations();
            });
        });
    });
  }

  function removeMemberFromConversation(conversationId, userId) {
    return fetch("/api/chat/conversations/" + conversationId + "/members/" + userId, {
      method: "DELETE",
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (err) {
            throw new Error(err.error || "Failed to remove member");
          });
        }
      })
      .then(function () {
        return refreshConversations();
      });
  }

  function leaveConversation(conversationId) {
    return fetch("/api/chat/conversations/" + conversationId, {
      method: "DELETE",
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (err) {
            throw new Error(err.error || "Failed to leave conversation");
          });
        }
      })
      .then(function () {
        conversations.delete(conversationId);
        messages.delete(conversationId);
        unreadCounts.delete(conversationId);
        if (currentConversationId === conversationId) {
          currentConversationId = null;
        }
        notifyStateChange("conversations");
      });
  }

  // ── Utility Functions ──────────────────────────────────────────────────

  function searchUsers(query) {
    return fetch("/api/chat/users/search?q=" + encodeURIComponent(query))
      .then(function (res) {
        if (!res.ok) return [];
        return res.json();
      })
      .then(function (data) {
        return (data && data.users) || [];
      });
  }

  function getUnreadCount(conversationId) {
    return unreadCounts.get(conversationId) || 0;
  }

  function getTotalUnread() {
    var total = 0;
    unreadCounts.forEach(function (count) {
      total += count;
    });
    return total;
  }

  function isUserOnline(userId) {
    return onlineUsers.has(userId);
  }

  function markAsRead(conversationId) {
    var timestamp = Math.floor(Date.now() / 1000);
    ChatWS.send({ type: "read", conversationId: conversationId, lastReadAt: timestamp });
    unreadCounts.set(conversationId, 0);
    fetch("/api/chat/conversations/" + conversationId + "/notifications/read", {
      method: "POST",
    }).catch(function () {});
    notifyStateChange("unread");
  }

  function getConversationMembers(conversationId) {
    var conv = conversations.get(conversationId);
    if (!conv) return [];
    return conv.members || [];
  }

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    init: init,
    getConversations: getConversations,
    getCurrentConversation: getCurrentConversation,
    setCurrentConversation: setCurrentConversation,
    loadMessages: loadMessages,
    sendMessage: sendMessage,
    editMessage: editMessage,
    deleteMessage: deleteMessage,
    createDirectConversation: createDirectConversation,
    createGroupConversation: createGroupConversation,
    addMemberToConversation: addMemberToConversation,
    removeMemberFromConversation: removeMemberFromConversation,
    leaveConversation: leaveConversation,
    searchUsers: searchUsers,
    getUnreadCount: getUnreadCount,
    getTotalUnread: getTotalUnread,
    isUserOnline: isUserOnline,
    refreshConversations: refreshConversations,
    getCurrentUserId: getCurrentUserId,
    getMessages: function (conversationId) {
      return messages.get(conversationId) || [];
    },
    markAsRead: markAsRead,
    getConversationMembers: getConversationMembers,
    onStateChange: onStateChange,
  };
})();
