/**
 * chat.js — Main chat page controller for RedSecChat.
 *
 * Handles all UI rendering, event wiring, and user interactions.
 * Depends on window.ChatState (chat-state.js), window.ChatWS (chat-ws-client.js),
 * and window.ChatCrypto (chat-crypto.js).
 *
 * This script is NOT a module — it is loaded via a regular script tag.
 * All functions are scoped inside an IIFE.
 */
(async function () {
  // ── DOM References ──────────────────────────────────────────────────────

  var elements = {
    convList: document.getElementById("conversation-list"),
    convSearch: document.getElementById("conversation-search"),
    newConvBtn: document.getElementById("new-conversation-btn"),
    chatEmpty: document.getElementById("chat-empty"),
    chatActive: document.getElementById("chat-active"),
    chatTitle: document.getElementById("chat-title"),
    chatSubtitle: document.getElementById("chat-subtitle"),
    messagesContainer: document.getElementById("messages-container"),
    messageInput: document.getElementById("message-input"),
    sendBtn: document.getElementById("send-btn"),
    typingIndicator: document.getElementById("typing-indicator"),
    typingUser: document.getElementById("typing-user"),
    // Modals
    newConvModal: document.getElementById("new-conv-modal"),
    directTab: document.getElementById("direct-tab"),
    groupTab: document.getElementById("group-tab"),
    groupNameSection: document.getElementById("group-name-section"),
    userSearchInput: document.getElementById("user-search-input"),
    userSearchResults: document.getElementById("user-search-results"),
    selectedUsers: document.getElementById("selected-users"),
    cancelConvBtn: document.getElementById("cancel-conv-btn"),
    createConvBtn: document.getElementById("create-conv-btn"),
    infoModal: document.getElementById("info-modal"),
    infoModalTitle: document.getElementById("info-modal-title"),
    infoMembers: document.getElementById("info-members"),
    infoAddMember: document.getElementById("info-add-member"),
    addMemberSearch: document.getElementById("add-member-search"),
    addMemberResults: document.getElementById("add-member-results"),
    leaveConvBtn: document.getElementById("leave-conv-btn"),
    closeInfoBtn: document.getElementById("close-info-btn"),
    chatInfoBtn: document.getElementById("chat-info-btn"),
    backBtn: document.getElementById("back-btn"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    // Embed modals
    embedPasteBtn: document.getElementById("embed-paste-btn"),
    embedShareBtn: document.getElementById("embed-share-btn"),
    pasteModal: document.getElementById("paste-modal"),
    embedPasteText: document.getElementById("embed-paste-text"),
    embedPasteSyntax: document.getElementById("embed-paste-syntax"),
    embedPasteExpiry: document.getElementById("embed-paste-expiry"),
    embedPastePassword: document.getElementById("embed-paste-password"),
    embedPasteBurn: document.getElementById("embed-paste-burn"),
    embedPasteError: document.getElementById("embed-paste-error"),
    cancelEmbedPaste: document.getElementById("cancel-embed-paste"),
    createEmbedPaste: document.getElementById("create-embed-paste"),
    shareModal: document.getElementById("share-modal"),
    embedShareFile: document.getElementById("embed-share-file"),
    embedShareExpiry: document.getElementById("embed-share-expiry"),
    embedSharePassword: document.getElementById("embed-share-password"),
    embedShareBurn: document.getElementById("embed-share-burn"),
    embedShareError: document.getElementById("embed-share-error"),
    cancelEmbedShare: document.getElementById("cancel-embed-share"),
    createEmbedShare: document.getElementById("create-embed-share"),
    // Emoji picker
    emojiBtn: document.getElementById("emoji-btn"),
    emojiPicker: document.getElementById("emoji-picker"),
    emojiGrid: document.getElementById("emoji-grid"),
    emojiCategories: document.getElementById("emoji-categories"),
    // Embed paste improvements
    embedPasteGutter: document.getElementById("embed-paste-gutter"),
    embedPasteCharCount: document.getElementById("embed-paste-char-count"),
    embedPasteTogglePw: document.getElementById("embed-paste-toggle-pw"),
    embedPastePreviewBtn: document.getElementById("embed-paste-preview-btn"),
    embedPastePreviewModal: document.getElementById("embed-paste-preview-modal"),
    embedPastePreviewContent: document.getElementById("embed-paste-preview-content"),
    embedPastePreviewGutter: document.getElementById("embed-paste-preview-gutter"),
    closeEmbedPastePreview: document.getElementById("close-embed-paste-preview"),
    // Embed share improvements
    embedShareTogglePw: document.getElementById("embed-share-toggle-pw"),
  };

  // ── State ───────────────────────────────────────────────────────────────

  var selectedUserIds = [];
  var newConvType = "direct"; // "direct" or "group"
  var typingTimeout = null;
  var userScrolledUp = false;

  // ── Emoji Data ────────────────────────────────────────────────────────────

  var emojiData = {
    Smileys: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","😐","😑","😶","😏","😒","🙄","😬","😮‍💨","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐"],
    Gestures: ["👍","👎","👊","✊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐","🖖","👋","🤏","💪","🦾","🖕"],
    Hearts: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","♥️","❤️‍🔥","❤️‍🩹","💟"],
    Animals: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦅","🦆","🦉","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🪲","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🐘","🦏","🐫"],
    Food: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🌶","🫑","🌽","🥕","🧄","🧅","🥔","🍠","🥐","🥖","🍞","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🫓","🥪","🥙","🧆","🌮","🌯","🫔","🥗","🫕","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯"],
    Objects: ["💻","⌨️","🖥","🖨","📱","☎️","📞","📟","📠","🔋","🔌","💡","🔦","🕯","📷","📸","📹","🎥","📽","🎬","📺","📻","📡","🔍","🔎","🔬","🔭","🧲","⚙️","🔧","🔨","⚒","🛠","⛏","🔩","🗜","💡","🔑","🗝","🚪","🪑","🛋","🛏","🧸","🖼","🪞","🪟","📦","📫","📝","🖊","🖋","✒️","📌","📎","✂️","📋","📁","📂","🗂","📆","📅","📇","📈","📉","📊","📋"],
    Symbols: ["✅","❌","⭕","❗","❓","‼️","⁉️","💯","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔺","🔻","💠","🔲","🔳","♻️","✝️","☪️","🕉","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","⛔","📛","🚫","❤️‍🔥","🎶","🎵","🎤","🎧","🎸","🎹","🎺","🥁","🔔","🔕","📣","📢","💬","💭","🗯"]
  };

  var currentEmojiCategory = "Smileys";

  // ── Helper Functions ────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatMessageText(text) {
    if (!text) return "";
    var escaped = escapeHtml(text);

    // Code blocks: ```...``` — must be before inline backticks
    escaped = escaped.replace(/```([\s\S]*?)```/g, function(match, code) {
      // Trim leading/trailing newline from code block content
      var trimmed = code.replace(/^\n/, "").replace(/\n$/, "");
      return '<div class="chat-code-block">' + trimmed + '</div>';
    });

    // Inline formatting (on escaped HTML — safe from injection)
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/__(.+?)__/g, "<em>$1</em>");
    escaped = escaped.replace(/~~(.+?)~~/g, "<u>$1</u>");
    escaped = escaped.replace(/`(.+?)`/g, '<code class="chat-inline-code">$1</code>');

    // Linkify URLs (after escaping, before list processing)
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>');

    // Lists — must be line-aware
    var lines = escaped.split("\n");
    var result = [];
    var inUl = false;
    var inOl = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var ulMatch = line.match(/^- (.*)/);
      var olMatch = line.match(/^\d+\. (.*)/);

      if (ulMatch) {
        if (inOl) { result.push("</ol>"); inOl = false; }
        if (!inUl) { result.push("<ul>"); inUl = true; }
        result.push("<li>" + ulMatch[1] + "</li>");
      } else if (olMatch) {
        if (inUl) { result.push("</ul>"); inUl = false; }
        if (!inOl) { result.push("<ol>"); inOl = true; }
        result.push("<li>" + olMatch[1] + "</li>");
      } else {
        if (inUl) { result.push("</ul>"); inUl = false; }
        if (inOl) { result.push("</ol>"); inOl = false; }
        result.push(line);
      }
    }
    if (inUl) result.push("</ul>");
    if (inOl) result.push("</ol>");

    return result.join("\n").replace(/\n/g, "<br>");
  }

  function formatTime(timestamp) {
    var date = new Date(timestamp * 1000);
    var now = new Date();
    var isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return (
      date.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }

  function getInitials(name) {
    return name ? name.charAt(0).toUpperCase() : "?";
  }

  function getGroupInitials(name) {
    if (!name) return "G";
    var words = name.split(" ");
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.charAt(0).toUpperCase();
  }

  function scrollToBottom() {
    if (!userScrolledUp && elements.messagesContainer) {
      elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }
  }

  function isScrolledToBottom() {
    if (!elements.messagesContainer) return true;
    var el = elements.messagesContainer;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  function getConversationName(conv) {
    if (conv.type === "group" && conv.name) return conv.name;
    if (conv.type === "direct" && conv.members) {
      var other = null;
      for (var i = 0; i < conv.members.length; i++) {
        if (conv.members[i].userId !== ChatState.getCurrentUserId()) {
          other = conv.members[i];
          break;
        }
      }
      if (other) return other.username;
    }
    return "Conversation";
  }

  function getConversationSubtitle(conv) {
    if (conv.type === "group") {
      var count = conv.memberCount || (conv.members ? conv.members.length : 0);
      return count + " member" + (count !== 1 ? "s" : "");
    }
    if (conv.type === "direct" && conv.members) {
      for (var i = 0; i < conv.members.length; i++) {
        if (conv.members[i].userId !== ChatState.getCurrentUserId()) {
          var online = ChatState.isUserOnline(conv.members[i].userId);
          return online ? "Online" : "Offline";
        }
      }
    }
    return "";
  }

  // ── Input Auto-Resize ──────────────────────────────────────────────────

  // ── Rich Text Editor Helpers ────────────────────────────────────────────

  function editorGetText() {
    var el = elements.messageInput;
    if (!el) return "";
    // Convert HTML to markdown-style text for storage/encryption
    return htmlToMarkdown(el.innerHTML);
  }

  function editorSetText(text) {
    var el = elements.messageInput;
    if (!el) return;
    el.innerHTML = "";
    autoGrowEditor();
    el.focus();
  }

  function autoGrowEditor() {
    // CSS handles auto-grow via min-height/max-height/overflow-y:auto
    // No JS needed — the contenteditable div grows until max-height then scrolls
  }

  function isCursorInList() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    var node = sel.anchorNode;
    while (node && node !== elements.messageInput) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        var tag = node.tagName.toLowerCase();
        if (tag === "li" || tag === "ul" || tag === "ol") return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  function editorIsEmpty() {
    var el = elements.messageInput;
    if (!el) return true;
    return el.textContent.trim() === "";
  }

  function htmlToMarkdown(html) {
    // Create a temporary element to walk the DOM tree
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    return nodeToMarkdown(tmp).trim();
  }

  function nodeToMarkdown(node) {
    var result = "";
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        result += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        var tag = child.tagName.toLowerCase();
        var inner = nodeToMarkdown(child);
        if (tag === "b" || tag === "strong") {
          result += "**" + inner + "**";
        } else if (tag === "i" || tag === "em") {
          result += "__" + inner + "__";
        } else if (tag === "u") {
          result += "~~" + inner + "~~";
        } else if (tag === "code") {
          result += "`" + inner + "`";
        } else if (tag === "ul") {
          var items = child.querySelectorAll(":scope > li");
          for (var j = 0; j < items.length; j++) {
            result += "\n- " + nodeToMarkdown(items[j]);
          }
          result += "\n";
        } else if (tag === "ol") {
          var items = child.querySelectorAll(":scope > li");
          for (var j = 0; j < items.length; j++) {
            result += "\n" + (j + 1) + ". " + nodeToMarkdown(items[j]);
          }
          result += "\n";
        } else if (tag === "li") {
          result += inner;
        } else if (tag === "br") {
          result += "\n";
        } else if (tag === "div") {
          result += nodeToMarkdown(child) + "\n";
        } else {
          result += inner;
        }
      }
    }
    return result;
  }

  function execFormat(command, value) {
    elements.messageInput.focus();
    document.execCommand(command, false, value || null);
  }

  function insertList(tag) {
    var el = elements.messageInput;
    if (!el) return;
    el.focus();
    // Use execCommand to insert list
    var command = tag === "ul" ? "insertUnorderedList" : "insertOrderedList";
    document.execCommand(command, false, null);
  }

  function insertInlineCode() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    var text = range.toString();
    if (!text) {
      // No selection, insert empty code element
      var code = document.createElement("code");
      code.className = "chat-inline-code";
      code.innerHTML = "&nbsp;";
      range.insertNode(code);
      // Select the nbsp so user can type over it
      var newRange = document.createRange();
      newRange.selectNodeContents(code);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      var code = document.createElement("code");
      code.className = "chat-inline-code";
      // Wrap selected text in code element
      range.surroundContents(code);
    }
    elements.messageInput.focus();
  }  // ── Emoji Picker ─────────────────────────────────────────────────────────

  function initEmojiPicker() {
    if (!elements.emojiCategories || !elements.emojiGrid) return;

    // Build category tabs
    var categories = Object.keys(emojiData);
    elements.emojiCategories.innerHTML = "";
    for (var i = 0; i < categories.length; i++) {
      (function (cat) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emoji-category-tab" + (cat === currentEmojiCategory ? " active" : "");
        btn.textContent = cat;
        btn.addEventListener("click", function () {
          currentEmojiCategory = cat;
          renderEmojiCategory(cat);
          // Update active tab
          var tabs = elements.emojiCategories.querySelectorAll(".emoji-category-tab");
          for (var j = 0; j < tabs.length; j++) {
            tabs[j].classList.toggle("active", tabs[j].textContent === cat);
          }
        });
        elements.emojiCategories.appendChild(btn);
      })(categories[i]);
    }

    renderEmojiCategory(currentEmojiCategory);
  }

  function renderEmojiCategory(category) {
    if (!elements.emojiGrid) return;
    var emojis = emojiData[category] || [];
    elements.emojiGrid.innerHTML = "";
    for (var i = 0; i < emojis.length; i++) {
      (function (emoji) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emoji-item";
        btn.textContent = emoji;
        btn.title = emoji;
        btn.addEventListener("click", function () {
          selectEmoji(emoji);
        });
        elements.emojiGrid.appendChild(btn);
      })(emojis[i]);
    }
  }

  function selectEmoji(emoji) {
    var input = elements.messageInput;
    if (!input) return;

    input.focus();
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      var range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(emoji));
      // Move cursor after the emoji
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // No selection, just append
      input.appendChild(document.createTextNode(emoji));
    }
  }

  function toggleEmojiPicker() {
    if (!elements.emojiPicker) return;
    var isHidden = elements.emojiPicker.classList.contains("hidden");
    if (isHidden) {
      elements.emojiPicker.classList.remove("hidden");
    } else {
      elements.emojiPicker.classList.add("hidden");
    }
  }

  function hideEmojiPicker() {
    if (elements.emojiPicker) {
      elements.emojiPicker.classList.add("hidden");
    }
  }

  // ── Render: Conversation List ───────────────────────────────────────────

  function renderConversationList(filter) {
    if (!elements.convList) return;

    var convs = ChatState.getConversations();
    var filtered = convs;

    if (filter) {
      filtered = [];
      for (var i = 0; i < convs.length; i++) {
        var name = getConversationName(convs[i]);
        if (name.toLowerCase().indexOf(filter.toLowerCase()) !== -1) {
          filtered.push(convs[i]);
        }
      }
    }

    elements.convList.innerHTML = "";

    if (filtered.length === 0) {
      elements.convList.innerHTML =
        '<div class="text-center text-muted text-sm p-4">No conversations</div>';
      return;
    }

    for (var j = 0; j < filtered.length; j++) {
      var el = createConversationElement(filtered[j]);
      elements.convList.appendChild(el);
    }
  }

  function createConversationElement(conv) {
    var currentConv = ChatState.getCurrentConversation();
    var isActive = currentConv && currentConv.id === conv.id;
    var unread = ChatState.getUnreadCount(conv.id);
    var name = getConversationName(conv);

    var div = document.createElement("div");
    div.className =
      "chat-conversation-item" +
      (isActive ? " active" : "") +
      " flex items-center gap-3 p-3 rounded cursor-pointer hover:bg-[var(--bg-elevated)]";
    div.dataset.convId = conv.id;

    // Avatar
    var avatar = document.createElement("div");
    avatar.className =
      "chat-avatar w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold relative";
    avatar.classList.add("chat-user-avatar");

    // For direct conversations, try to show user avatar image
    if (conv.type === "direct" && conv.members) {
      var otherMember = null;
      for (var mi = 0; mi < conv.members.length; mi++) {
        if (conv.members[mi].userId !== ChatState.getCurrentUserId()) {
          otherMember = conv.members[mi];
          break;
        }
      }
      if (otherMember && otherMember.avatarUpdatedAt) {
        var img = document.createElement("img");
        img.src = "/api/avatar/" + otherMember.userId + ".webp";
        img.className = "w-10 h-10 rounded-full object-cover";
        img.alt = name;
        img.onerror = function () {
          avatar.textContent = getInitials(name);
        };
        avatar.textContent = "";
        avatar.appendChild(img);
      } else {
        avatar.textContent = getInitials(name);
      }
    } else {
      avatar.textContent = conv.type === "group" ? getGroupInitials(name) : getInitials(name);
    }

    // Online indicator for direct conversations
    if (conv.type === "direct" && conv.members) {
      for (var oi = 0; oi < conv.members.length; oi++) {
        if (conv.members[oi].userId !== ChatState.getCurrentUserId()) {
          if (ChatState.isUserOnline(conv.members[oi].userId)) {
            var dot = document.createElement("span");
            dot.className = "online-dot";
            avatar.appendChild(dot);
          }
          break;
        }
      }
    }

    div.appendChild(avatar);

    // Name and last message preview
    var info = document.createElement("div");
    info.className = "flex-1 min-w-0";
    info.innerHTML =
      '<div class="font-bold truncate">' +
      escapeHtml(name) +
      "</div>" +
      '<div class="text-sm text-muted truncate">' +
      (conv.type === "group"
        ? (conv.memberCount || (conv.members ? conv.members.length : 0)) + " members"
        : "Direct message") +
      "</div>";
    div.appendChild(info);

    // Unread badge
    if (unread > 0) {
      var badge = document.createElement("span");
      badge.className =
        "chat-unread-badge bg-accent text-white text-xs rounded-full w-5 h-5 flex items-center justify-center";
      badge.textContent = unread > 9 ? "9+" : String(unread);
      div.appendChild(badge);
    }

    div.addEventListener("click", function () {
      openConversation(conv.id);
    });

    return div;
  }

  // ── Render: Messages ────────────────────────────────────────────────────

  function renderMessages(msgs) {
    if (!elements.messagesContainer) return;

    elements.messagesContainer.innerHTML = "";

    if (!msgs || msgs.length === 0) {
      elements.messagesContainer.innerHTML =
        '<div class="text-center text-muted text-sm p-8">No messages yet. Say hello!</div>';
      return;
    }

    for (var i = 0; i < msgs.length; i++) {
      var el = createMessageElement(msgs[i]);
      elements.messagesContainer.appendChild(el);
    }

    scrollToBottom();
  }

  function createMessageElement(msg) {
    // Check if message is an embed (paste or share link card)
    var embedData = null;
    if (msg.decrypted && msg.decrypted.charAt(0) === "{") {
      try {
        var parsed = JSON.parse(msg.decrypted);
        if (parsed.type === "paste" || parsed.type === "share") {
          embedData = parsed;
        }
      } catch (e) {
        // Not valid JSON — render as plain text
      }
    }

    var div = document.createElement("div");
    div.className = "chat-message-bubble " + (msg.isOwn ? "self" : "other");
    div.dataset.messageId = msg.id;

    var contentHtml;
    if (embedData) {
      contentHtml =
        '<a href="' + escapeHtml(embedData.url) + '" class="chat-embed-card block p-3 rounded border" target="_blank">' +
        '<div class="text-xs font-bold mb-1 text-accent">' + (embedData.type === "paste" ? "RedSecPaste" : "RedSecShare") + '</div>' +
        '<div class="text-sm truncate">' + escapeHtml(embedData.content) + '</div>' +
        '</a>';
    } else if (msg.decrypted) {
      contentHtml = formatMessageText(msg.decrypted);
    } else {
      contentHtml = '<span class="text-muted italic">Encrypted message</span>';
    }

    if (msg.isOwn) {
      div.innerHTML =
        '<div class="message-content own">' +
        '<div class="message-text">' + contentHtml + "</div>" +
        '<div class="message-time text-xs text-muted mt-1">' + formatTime(msg.createdAt) + "</div>" +
        "</div>";
    } else {
      var senderName = msg.senderUsername || "Unknown";
      div.innerHTML =
        '<div class="sender-name text-xs text-accent mb-1">' + escapeHtml(senderName) + "</div>" +
        '<div class="message-content other">' +
        '<div class="message-text">' + contentHtml + "</div>" +
        '<div class="message-time text-xs text-muted mt-1">' + formatTime(msg.createdAt) + "</div>" +
        "</div>";
    }

    return div;
  }

  function appendNewMessage(msg) {
    if (!elements.messagesContainer || !msg) return;

    // Only render if the message belongs to the currently open conversation
    var currentConv = ChatState.getCurrentConversation();
    if (!currentConv || msg.conversationId !== currentConv.id) return;

    // Remove "no messages" placeholder if present
    var placeholder = elements.messagesContainer.querySelector(
      ".text-center.text-muted"
    );
    if (placeholder) {
      placeholder.remove();
    }

    var el = createMessageElement(msg);
    elements.messagesContainer.appendChild(el);
    scrollToBottom();
  }

  // ── Render: Chat View Update ────────────────────────────────────────────

  function updateChatView() {
    var conv = ChatState.getCurrentConversation();
    if (conv) {
      if (elements.chatTitle) {
        elements.chatTitle.textContent = getConversationName(conv);
      }
      if (elements.chatSubtitle) {
        elements.chatSubtitle.textContent = getConversationSubtitle(conv);
      }
      if (elements.chatEmpty) elements.chatEmpty.classList.add("hidden");
      if (elements.chatActive) {
        elements.chatActive.classList.remove("hidden");
      }

      var msgs = ChatState.getMessages
        ? null
        : null; // Messages are retrieved from state via loadMessages
      // The current conversation's messages are already loaded by setCurrentConversation
      // We just need to re-render from the cache
      var allMsgs = [];
      // Access messages through ChatState API if available, otherwise re-fetch
      // Since messages are internal to ChatState, we re-load them
    } else {
      if (elements.chatEmpty) elements.chatEmpty.classList.remove("hidden");
      if (elements.chatActive) {
        elements.chatActive.classList.add("hidden");
      }
    }
  }

  // ── Open Conversation ───────────────────────────────────────────────────

  async function openConversation(convId) {
    try {
      await ChatState.setCurrentConversation(convId);

      var conv = ChatState.getCurrentConversation();
      if (!conv) return;

      if (elements.chatTitle) {
        elements.chatTitle.textContent = getConversationName(conv);
      }
      if (elements.chatSubtitle) {
        elements.chatSubtitle.textContent = getConversationSubtitle(conv);
      }
      if (elements.chatEmpty) elements.chatEmpty.classList.add("hidden");
      if (elements.chatActive) {
        elements.chatActive.classList.remove("hidden");
      }

      // Fetch messages for this conversation
      var msgs = await ChatState.loadMessages(convId);
      renderMessages(msgs);

      // On mobile, show chat area and hide sidebar
      if (window.innerWidth < 768) {
        var sidebar = document.getElementById("chat-sidebar");
        if (sidebar) sidebar.classList.add("hidden");
        if (elements.backBtn) elements.backBtn.classList.remove("hidden");
      }

      userScrolledUp = false;
      if (elements.messageInput) elements.messageInput.focus();
    } catch (err) {
      console.error("Failed to open conversation:", err);
    }
  }

  // ── Send Message ────────────────────────────────────────────────────────

  async function sendMessage() {
    if (!elements.messageInput) return;

    var text = editorGetText();
    var currentConv = ChatState.getCurrentConversation();
    if (!text || !currentConv) return;

    editorSetText("");
    if (elements.sendBtn) elements.sendBtn.disabled = true;

    // Stop any active typing indicator
    clearTimeout(typingTimeout);
    typingTimeout = null;
    ChatWS.send({
      type: "stop_typing",
      conversationId: currentConv.id,
    });

    try {
      await ChatState.sendMessage(currentConv.id, text);
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      if (elements.sendBtn) elements.sendBtn.disabled = false;
      if (elements.messageInput) elements.messageInput.focus();
    }
  }

  // ── Typing Indicator ────────────────────────────────────────────────────

  function handleTyping() {
    var conv = ChatState.getCurrentConversation();
    if (!conv) return;

    ChatWS.send({ type: "typing", conversationId: conv.id });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(function () {
      ChatWS.send({ type: "stop_typing", conversationId: conv.id });
      typingTimeout = null;
    }, 3000);
  }

  function showTypingIndicator(userId, conversationId) {
    var conv = ChatState.getCurrentConversation();
    if (!conv || conv.id !== conversationId) return;
    if (!elements.typingIndicator || !elements.typingUser) return;

    // Look up username from conversation members
    var username = "Someone";
    if (conv.members) {
      for (var i = 0; i < conv.members.length; i++) {
        if (conv.members[i].userId === userId) {
          username = conv.members[i].username;
          break;
        }
      }
    }

    elements.typingUser.textContent = username + " is typing...";
    elements.typingIndicator.classList.remove("hidden");

    // Auto-hide after 3 seconds if no further typing events
    clearTimeout(showTypingIndicator._hideTimeout);
    showTypingIndicator._hideTimeout = setTimeout(function () {
      hideTypingIndicator();
    }, 3000);
  }

  function hideTypingIndicator() {
    if (elements.typingIndicator) {
      elements.typingIndicator.classList.add("hidden");
    }
  }

  // ── New Conversation Modal ──────────────────────────────────────────────

  function showNewConvModal() {
    selectedUserIds = [];
    newConvType = "direct";

    if (elements.newConvModal) elements.newConvModal.classList.remove("hidden");
    if (elements.userSearchInput) elements.userSearchInput.value = "";
    if (elements.userSearchResults) elements.userSearchResults.innerHTML = '<div class="text-muted text-sm p-2">Loading users...</div>';
    if (elements.selectedUsers) elements.selectedUsers.innerHTML = "";
    if (elements.groupNameSection) elements.groupNameSection.classList.add("hidden");
    if (elements.createConvBtn) elements.createConvBtn.disabled = true;

    setActiveTab("direct");
    loadAllUsers();
  }

  function hideNewConvModal() {
    if (elements.newConvModal) elements.newConvModal.classList.add("hidden");
    selectedUserIds = [];
  }

  function setActiveTab(tab) {
    newConvType = tab;
    if (elements.directTab) {
      elements.directTab.classList.toggle("conv-tab-active", tab === "direct");
      elements.directTab.classList.toggle("conv-tab-inactive", tab !== "direct");
    }
    if (elements.groupTab) {
      elements.groupTab.classList.toggle("conv-tab-active", tab === "group");
      elements.groupTab.classList.toggle("conv-tab-inactive", tab !== "group");
    }

    if (elements.groupNameSection) {
      if (tab === "group") {
        elements.groupNameSection.classList.remove("hidden");
      } else {
        elements.groupNameSection.classList.add("hidden");
      }
    }

    // For direct messages, limit to 1 selected user
    if (tab === "direct" && selectedUserIds.length > 1) {
      selectedUserIds = [selectedUserIds[0]];
      renderSelectedUsers();
    }

    updateCreateBtnState();
  }

  function renderSelectedUsers() {
    if (!elements.selectedUsers) return;
    elements.selectedUsers.innerHTML = "";

    for (var i = 0; i < selectedUserIds.length; i++) {
      (function (userId, index) {
        var chip = document.createElement("span");
        chip.className =
          "inline-flex items-center gap-1 bg-[var(--bg-elevated)] text-sm px-2 py-1 rounded";

        var nameSpan = document.createElement("span");
        nameSpan.textContent = userId; // Will be replaced with username when available
        nameSpan.dataset.userId = userId;
        chip.appendChild(nameSpan);

        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "\u00d7";
        removeBtn.className = "ml-1 text-muted hover:text-[var(--accent)]";
        removeBtn.addEventListener("click", function () {
          selectedUserIds.splice(index, 1);
          renderSelectedUsers();
          updateCreateBtnState();
        });
        chip.appendChild(removeBtn);

        elements.selectedUsers.appendChild(chip);
      })(selectedUserIds[i], i);
    }
  }

  function updateCreateBtnState() {
    if (!elements.createConvBtn) return;

    var hasUsers = selectedUserIds.length > 0;
    if (newConvType === "direct") {
      elements.createConvBtn.disabled = selectedUserIds.length !== 1;
    } else {
      var groupNameInput = document.getElementById("group-name-input");
      var groupName = groupNameInput ? groupNameInput.value.trim() : "";
      elements.createConvBtn.disabled = !hasUsers || !groupName;
    }
  }

  var userSearchDebounce = null;
  var allUsersCache = [];

  async function loadAllUsers() {
    try {
      var users = await ChatState.searchUsers("");
      allUsersCache = users || [];
      renderUserSearchResults(allUsersCache);
    } catch (err) {
      console.error("Failed to load users:", err);
    }
  }

  async function searchUsers(query) {
    if (!query || query.length < 2) {
      renderUserSearchResults(allUsersCache);
      return;
    }

    var q = query.toLowerCase();
    var filtered = [];
    for (var i = 0; i < allUsersCache.length; i++) {
      if (allUsersCache[i].username.toLowerCase().indexOf(q) !== -1) {
        filtered.push(allUsersCache[i]);
      }
    }
    renderUserSearchResults(filtered);
  }

  function renderUserSearchResults(users) {
    if (!elements.userSearchResults) return;
    elements.userSearchResults.innerHTML = "";

    if (!users || users.length === 0) {
      elements.userSearchResults.innerHTML =
        '<div class="text-muted text-sm p-2">No users found</div>';
      return;
    }

    for (var i = 0; i < users.length; i++) {
      (function (user) {
        // Skip already selected users
        if (selectedUserIds.indexOf(user.id) !== -1) return;

        var item = document.createElement("div");
        item.className =
          "flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-[var(--bg-elevated)]";

        var avatar = document.createElement("div");
        avatar.className =
          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold relative";
        avatar.classList.add("chat-user-avatar");
        avatar.textContent = getInitials(user.username);

        // Online indicator
        var isOnline = ChatState.isUserOnline(user.id);
        if (isOnline) {
          var dot = document.createElement("span");
          dot.className = "online-dot";
          avatar.appendChild(dot);
        }

        var nameSpan = document.createElement("span");
        nameSpan.className = "text-sm flex-1";
        nameSpan.textContent = user.username;

        var statusSpan = document.createElement("span");
        statusSpan.className = "text-xs " + (isOnline ? "text-green-400" : "text-muted");
        statusSpan.textContent = isOnline ? "Online" : "Offline";

        item.appendChild(avatar);
        item.appendChild(nameSpan);
        item.appendChild(statusSpan);

        item.addEventListener("click", function () {
          selectUser(user);
        });

        elements.userSearchResults.appendChild(item);
      })(users[i]);
    }
  }

  function selectUser(user) {
    if (newConvType === "direct") {
      selectedUserIds = [user.id];
    } else {
      if (selectedUserIds.indexOf(user.id) === -1) {
        selectedUserIds.push(user.id);
      }
    }

    // Update chip names from search result usernames
    renderSelectedUsers();
    // Update the chip text to show the username instead of id
    if (elements.selectedUsers) {
      var chips = elements.selectedUsers.querySelectorAll("span[data-user-id]");
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].dataset.userId === user.id) {
          chips[i].textContent = user.username;
        }
      }
    }

    // Clear search
    if (elements.userSearchInput) elements.userSearchInput.value = "";
    if (elements.userSearchResults) elements.userSearchResults.innerHTML = "";
    updateCreateBtnState();
  }

  async function createConversation() {
    if (!elements.createConvBtn) return;
    elements.createConvBtn.disabled = true;

    try {
      if (newConvType === "direct") {
        if (selectedUserIds.length !== 1) return;
        var data = await ChatState.createDirectConversation(selectedUserIds[0]);
        if (data && data.id) {
          hideNewConvModal();
          await openConversation(data.id);
        }
      } else {
        var groupNameInput = document.getElementById("group-name-input");
        var groupName = groupNameInput ? groupNameInput.value.trim() : "";
        if (!groupName || selectedUserIds.length === 0) return;

        var groupData = await ChatState.createGroupConversation(
          groupName,
          selectedUserIds
        );
        if (groupData && groupData.id) {
          hideNewConvModal();
          await openConversation(groupData.id);
        }
      }
    } catch (err) {
      console.error("Failed to create conversation:", err);
    } finally {
      updateCreateBtnState();
    }
  }

  // ── Info Modal ──────────────────────────────────────────────────────────

  function showInfoModal() {
    var conv = ChatState.getCurrentConversation();
    if (!conv || !elements.infoModal) return;

    if (elements.infoModalTitle) {
      elements.infoModalTitle.textContent = getConversationName(conv);
    }

    renderInfoMembers(conv);

    // Show add member section only for groups
    if (elements.infoAddMember) {
      if (conv.type === "group") {
        elements.infoAddMember.classList.remove("hidden");
      } else {
        elements.infoAddMember.classList.add("hidden");
      }
    }

    elements.infoModal.classList.remove("hidden");
  }

  function hideInfoModal() {
    if (elements.infoModal) elements.infoModal.classList.add("hidden");
    if (elements.addMemberSearch) elements.addMemberSearch.value = "";
    if (elements.addMemberResults) elements.addMemberResults.innerHTML = "";
  }

  function renderInfoMembers(conv) {
    if (!elements.infoMembers) return;
    elements.infoMembers.innerHTML = "";

    var members = conv.members || [];
    for (var i = 0; i < members.length; i++) {
      (function (member) {
        var isOnline = ChatState.isUserOnline(member.userId);
        var isSelf = member.userId === ChatState.getCurrentUserId();

        var item = document.createElement("div");
        item.className =
          "flex items-center gap-3 p-2 rounded hover:bg-[var(--bg-elevated)]";

        var avatar = document.createElement("div");
        avatar.className =
          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold relative";
        avatar.classList.add("chat-user-avatar");
        avatar.textContent = getInitials(member.username);

        // Online indicator dot
        if (isOnline) {
          var dot = document.createElement("span");
          dot.className =
            "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-[var(--bg-primary)]";
          avatar.appendChild(dot);
        }

        var nameSpan = document.createElement("span");
        nameSpan.className = "flex-1 text-sm";
        nameSpan.textContent = member.username + (isSelf ? " (you)" : "");

        item.appendChild(avatar);
        item.appendChild(nameSpan);

        // For groups, show remove button (not for self — use Leave instead)
        if (conv.type === "group" && !isSelf) {
          var removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className =
            "text-xs text-muted hover:text-red-500 px-2 py-1";
          removeBtn.textContent = "Remove";
          removeBtn.addEventListener("click", function () {
            removeMemberFromConversation(conv.id, member.userId);
          });
          item.appendChild(removeBtn);
        }

        elements.infoMembers.appendChild(item);
      })(members[i]);
    }
  }

  async function removeMemberFromConversation(convId, userId) {
    try {
      await ChatState.removeMemberFromConversation(convId, userId);
      // Re-render members
      var conv = ChatState.getCurrentConversation();
      if (conv && conv.id === convId) {
        renderInfoMembers(conv);
      }
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  }

  var addMemberSearchDebounce = null;

  async function searchAddMember(query) {
    if (!query || query.length < 2) {
      if (elements.addMemberResults) elements.addMemberResults.innerHTML = "";
      return;
    }

    try {
      var users = await ChatState.searchUsers(query);
      renderAddMemberResults(users);
    } catch (err) {
      console.error("Add member search failed:", err);
    }
  }

  function renderAddMemberResults(users) {
    if (!elements.addMemberResults) return;
    elements.addMemberResults.innerHTML = "";

    var conv = ChatState.getCurrentConversation();
    if (!conv) return;

    var existingIds = [];
    if (conv.members) {
      for (var i = 0; i < conv.members.length; i++) {
        existingIds.push(conv.members[i].userId);
      }
    }

    var hasValidResults = false;

    if (!users || users.length === 0) {
      elements.addMemberResults.innerHTML =
        '<div class="text-muted text-sm p-2">No users found</div>';
      return;
    }

    for (var j = 0; j < users.length; j++) {
      (function (user) {
        // Skip existing members
        if (existingIds.indexOf(user.id) !== -1) return;

        hasValidResults = true;

        var item = document.createElement("div");
        item.className =
          "flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-[var(--bg-elevated)]";

        var avatar = document.createElement("div");
        avatar.className =
          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold";
        avatar.classList.add("chat-user-avatar");
        avatar.textContent = getInitials(user.username);

        var nameSpan = document.createElement("span");
        nameSpan.className = "text-sm flex-1";
        nameSpan.textContent = user.username;

        var addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className =
          "text-xs text-[var(--accent)] hover:underline px-2 py-1";
        addBtn.textContent = "Add";
        addBtn.addEventListener("click", function () {
          addMemberToCurrentConversation(user);
        });

        item.appendChild(avatar);
        item.appendChild(nameSpan);
        item.appendChild(addBtn);

        elements.addMemberResults.appendChild(item);
      })(users[j]);
    }

    if (!hasValidResults) {
      elements.addMemberResults.innerHTML =
        '<div class="text-muted text-sm p-2">All found users are already members</div>';
    }
  }

  async function addMemberToCurrentConversation(user) {
    var conv = ChatState.getCurrentConversation();
    if (!conv) return;

    try {
      await ChatState.addMemberToConversation(conv.id, user.id);
      if (elements.addMemberSearch) elements.addMemberSearch.value = "";
      if (elements.addMemberResults) elements.addMemberResults.innerHTML = "";

      // Refresh the member list in the modal
      var updatedConv = ChatState.getCurrentConversation();
      if (updatedConv) {
        renderInfoMembers(updatedConv);
      }
    } catch (err) {
      console.error("Failed to add member:", err);
    }
  }

  async function leaveCurrentConversation() {
    var conv = ChatState.getCurrentConversation();
    if (!conv) return;

    try {
      await ChatState.leaveConversation(conv.id);
      hideInfoModal();

      // Reset chat view
      if (elements.chatEmpty) elements.chatEmpty.classList.remove("hidden");
      if (elements.chatActive) {
        elements.chatActive.classList.add("hidden");
      }

      // On mobile, show sidebar again
      if (window.innerWidth < 768) {
        var sidebar = document.getElementById("chat-sidebar");
        if (sidebar) sidebar.classList.remove("hidden");
        if (elements.backBtn) elements.backBtn.classList.add("hidden");
      }
    } catch (err) {
      console.error("Failed to leave conversation:", err);
    }
  }

  // ── Key Setup Modal ─────────────────────────────────────────────────────

  function showKeySetupModal() {
    // Create modal overlay
    var overlay = document.createElement("div");
    overlay.id = "key-setup-overlay";
    overlay.className = "fixed inset-0 z-[9999] flex items-center justify-center chat-overlay-bg";

    var modal = document.createElement("div");
    modal.className = "bg-[var(--bg-primary)] rounded-lg p-6 max-w-md w-full mx-4 shadow-lg";

    modal.innerHTML =
      '<h2 class="text-xl font-bold mb-4">Set Up Encryption Keys</h2>' +
      '<p class="text-muted text-sm mb-4">' +
      "RedSecChat uses end-to-end encryption. You need to generate an encryption key pair " +
      "to send and receive encrypted messages. Your private key will be stored locally in " +
      "your browser and backed up to the server encrypted with your password." +
      "</p>" +
      '<div class="mb-4">' +
      '<label class="block text-sm font-bold mb-1" for="key-setup-password">Confirm your password</label>' +
      '<input type="password" id="key-setup-password" class="w-full p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)]" placeholder="Enter your password" autocomplete="current-password" />' +
      '<p id="key-setup-error" class="text-red-500 text-sm mt-1 hidden"></p>' +
      "</div>" +
      '<div class="flex gap-2 justify-end">' +
      '<button id="key-setup-cancel" type="button" class="px-4 py-2 rounded border border-[var(--border-color)] text-muted hover:text-[var(--text-primary)]">Cancel</button>' +
      '<button id="key-setup-submit" type="button" class="px-4 py-2 rounded bg-[var(--accent)] text-white hover:opacity-90">Generate Keys</button>' +
      "</div>";

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var passwordInput = document.getElementById("key-setup-password");
    var errorEl = document.getElementById("key-setup-error");
    var submitBtn = document.getElementById("key-setup-submit");
    var cancelBtn = document.getElementById("key-setup-cancel");

    passwordInput.focus();

    cancelBtn.addEventListener("click", function () {
      overlay.remove();
    });

    passwordInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitBtn.click();
      }
    });

    submitBtn.addEventListener("click", async function () {
      var password = passwordInput.value;
      if (!password) {
        errorEl.textContent = "Password is required";
        errorEl.classList.remove("hidden");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Verifying...";

      try {
        // Verify password against server before generating keys
        var verifyRes = await fetch("/api/auth/verify-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: password }),
        });

        if (!verifyRes.ok) {
          var verifyErr = await verifyRes.json();
          throw new Error(verifyErr.error || "Incorrect password");
        }

        submitBtn.textContent = "Generating...";

        var userId = ChatState.getCurrentUserId();

        // Generate RSA key pair
        var keyPair = await ChatCrypto.generateKeyPair();

        // Encrypt private key with password
        var encryptedBackup = await ChatCrypto.encryptPrivateKey(
          keyPair.privateKey,
          password
        );

        if (!encryptedBackup) {
          throw new Error("Failed to encrypt private key");
        }

        // Export public key for server
        var publicKeyBase64 = await ChatCrypto.exportPublicKey(keyPair.publicKey);

        // Upload public key + encrypted backup to server
        var uploadRes = await fetch("/api/chat/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey: publicKeyBase64,
            encryptedPrivateKey: encryptedBackup.encryptedPrivateKey,
            privateKeyIv: encryptedBackup.iv,
            privateKeySalt: encryptedBackup.salt,
          }),
        });

        if (!uploadRes.ok) {
          var errData = await uploadRes.json();
          throw new Error(errData.error || "Failed to upload keys");
        }

        // Store private key in IndexedDB
        await ChatCrypto.storeKeyInIndexedDB(userId, keyPair.privateKey);

        overlay.remove();
      } catch (err) {
        console.error("Key setup failed:", err);
        errorEl.textContent = err.message || "Key setup failed. Please try again.";
        errorEl.classList.remove("hidden");
        submitBtn.disabled = false;
        submitBtn.textContent = "Generate Keys";
      }
    });
  }

  // ── Embed: Paste Creation ───────────────────────────────────────────────

  var CryptoModules = null;

  async function loadCryptoModules() {
    if (CryptoModules) return CryptoModules;
    var cryptoMod = await import("/js/crypto.js");
    var fileCryptoMod = await import("/js/file-crypto.js");
    CryptoModules = {
      createEncryptedPaste: cryptoMod.createEncryptedPaste,
      createEncryptedShare: fileCryptoMod.createEncryptedShare,
    };
    return CryptoModules;
  }

  var HljsModules = null;

  async function loadHljsModules() {
    if (HljsModules) return HljsModules;
    var mod = await import("/js/hljs-loader.js");
    HljsModules = {
      ensureHljs: mod.ensureHljs,
      highlightCode: mod.highlightCode,
      updateGutter: mod.updateGutter,
    };
    return HljsModules;
  }

  function updateEmbedPasteGutter() {
    if (!elements.embedPasteGutter || !elements.embedPasteText) return;
    var lines = elements.embedPasteText.value.split("\n").length;
    var html = "";
    for (var i = 1; i <= lines; i++) {
      html += "<div>" + i + "</div>";
    }
    elements.embedPasteGutter.innerHTML = html;
  }

  async function previewEmbedPaste() {
    var text = elements.embedPasteText ? elements.embedPasteText.value : "";
    if (!text.trim()) return;

    var syntax = elements.embedPasteSyntax ? elements.embedPasteSyntax.value : "plaintext";

    try {
      var hljs = await loadHljsModules();
      var lines = text.split("\n").length;
      hljs.updateGutter(elements.embedPastePreviewGutter, lines);

      var loaded = await hljs.ensureHljs(syntax);
      var highlighted = loaded ? hljs.highlightCode(text, syntax) : null;

      if (highlighted) {
        elements.embedPastePreviewContent.innerHTML = highlighted;
      } else {
        elements.embedPastePreviewContent.textContent = text;
      }

      if (elements.embedPastePreviewModal) {
        elements.embedPastePreviewModal.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Preview failed:", err);
    }
  }

  function showPasteModal() {
    if (elements.pasteModal) elements.pasteModal.classList.remove("hidden");
    if (elements.embedPasteText) elements.embedPasteText.value = "";
    if (elements.embedPasteSyntax) elements.embedPasteSyntax.value = "plaintext";
    if (elements.embedPasteExpiry) elements.embedPasteExpiry.value = "86400";
    if (elements.embedPastePassword) {
      elements.embedPastePassword.value = "";
      elements.embedPastePassword.type = "password";
    }
    if (elements.embedPasteBurn) elements.embedPasteBurn.checked = false;
    if (elements.embedPasteError) elements.embedPasteError.classList.add("hidden");
    if (elements.embedPasteCharCount) elements.embedPasteCharCount.textContent = "0 characters";
    updateEmbedPasteGutter();
    if (elements.embedPasteText) elements.embedPasteText.focus();
  }

  function hidePasteModal() {
    if (elements.pasteModal) elements.pasteModal.classList.add("hidden");
  }

  async function createEmbedPaste() {
    var text = elements.embedPasteText ? elements.embedPasteText.value.trim() : "";
    if (!text) {
      if (elements.embedPasteError) {
        elements.embedPasteError.textContent = "Please enter some content.";
        elements.embedPasteError.classList.remove("hidden");
      }
      return;
    }

    var syntax = elements.embedPasteSyntax ? elements.embedPasteSyntax.value : "plaintext";
    var expiresIn = elements.embedPasteExpiry ? parseInt(elements.embedPasteExpiry.value, 10) : 86400;
    var password = elements.embedPastePassword ? elements.embedPastePassword.value : "";
    var burnAfterReading = elements.embedPasteBurn ? elements.embedPasteBurn.checked : false;
    var hasPassword = password.length > 0;

    var createBtn = elements.createEmbedPaste;
    if (createBtn) createBtn.disabled = true;

    try {
      var mods = await loadCryptoModules();
      var result = await mods.createEncryptedPaste(text, hasPassword ? password : null);

      var res = await fetch("/api/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ciphertext: result.ciphertext,
          iv: result.iv,
          ivPassword: result.ivPassword,
          salt: result.salt,
          hasPassword: hasPassword,
          burnAfterReading: burnAfterReading,
          expiresIn: expiresIn,
          syntax: syntax,
        }),
      });

      if (!res.ok) {
        var errData = await res.json();
        throw new Error(errData.error || "Failed to create paste");
      }

      var data = await res.json();
      var pasteUrl = window.location.origin + "/p/" + data.id + "#" + result.keyBase64;

      hidePasteModal();

      // Send embed message in chat
      var currentConv = ChatState.getCurrentConversation();
      if (currentConv) {
        // Only include preview content if no burn-after-reading and no password
        var previewText = (!burnAfterReading && !hasPassword) ? text.substring(0, 100) : "Protected paste (click to view)";
        var embedContent = previewText;
        if (hasPassword) embedContent += " (password protected)";
        var embedMsg = JSON.stringify({
          type: "paste",
          content: embedContent,
          url: pasteUrl,
        });
        await ChatState.sendMessage(currentConv.id, embedMsg);
      }
    } catch (err) {
      console.error("Embed paste creation failed:", err);
      if (elements.embedPasteError) {
        elements.embedPasteError.textContent = err.message || "Failed to create paste.";
        elements.embedPasteError.classList.remove("hidden");
      }
    } finally {
      if (createBtn) createBtn.disabled = false;
    }
  }

  // ── Embed: Share Creation ──────────────────────────────────────────────

  function showShareModal() {
    if (elements.shareModal) elements.shareModal.classList.remove("hidden");
    if (elements.embedShareFile) elements.embedShareFile.value = "";
    if (elements.embedShareExpiry) elements.embedShareExpiry.value = "86400";
    if (elements.embedSharePassword) elements.embedSharePassword.value = "";
    if (elements.embedShareBurn) elements.embedShareBurn.checked = false;
    if (elements.embedShareError) elements.embedShareError.classList.add("hidden");
  }

  function hideShareModal() {
    if (elements.shareModal) elements.shareModal.classList.add("hidden");
  }

  async function createEmbedShare() {
    var fileInput = elements.embedShareFile;
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      if (elements.embedShareError) {
        elements.embedShareError.textContent = "Please select a file.";
        elements.embedShareError.classList.remove("hidden");
      }
      return;
    }

    var file = fileInput.files[0];
    var MAX_SIZE = 250 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      if (elements.embedShareError) {
        elements.embedShareError.textContent = "File exceeds 250MB limit.";
        elements.embedShareError.classList.remove("hidden");
      }
      return;
    }

    var expiresIn = elements.embedShareExpiry ? parseInt(elements.embedShareExpiry.value, 10) : 86400;
    var password = elements.embedSharePassword ? elements.embedSharePassword.value : "";
    var burnAfterReading = elements.embedShareBurn ? elements.embedShareBurn.checked : false;
    var hasPassword = password.length > 0;

    var createBtn = elements.createEmbedShare;
    if (createBtn) createBtn.disabled = true;

    try {
      var mods = await loadCryptoModules();

      // Read file as ArrayBuffer
      var buffer = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error("Failed to read file")); };
        reader.readAsArrayBuffer(file);
      });

      var fileData = { buffer: buffer, name: file.name, type: file.type || "application/octet-stream", size: file.size };
      var encrypted = await mods.createEncryptedShare([fileData], hasPassword ? password : null);

      // Build FormData
      var formData = new FormData();
      for (var i = 0; i < encrypted.files.length; i++) {
        var ef = encrypted.files[i];
        formData.append("files", new Blob([ef.ciphertext]), "file_" + i);
      }

      var fileMeta = encrypted.files.map(function (ef) {
        return {
          iv: ef.iv,
          encryptedFilename: ef.encryptedFilename,
          filenameIv: ef.filenameIv,
          fileSize: ef.fileSize,
          mimeType: ef.mimeType,
          ivPassword: ef.ivPassword,
        };
      });

      var metadata = {
        expiresIn: expiresIn,
        hasPassword: encrypted.hasPassword,
        burnAfterReading: burnAfterReading,
        salt: encrypted.salt,
        files: fileMeta,
      };

      formData.append("metadata", JSON.stringify(metadata));

      var res = await fetch("/api/share", { method: "POST", body: formData });
      if (!res.ok) {
        var errData = await res.json();
        throw new Error(errData.error || "Upload failed");
      }

      var shareData = await res.json();
      var shareUrl = window.location.origin + "/s/" + shareData.id + "#" + encrypted.keyBase64;

      hideShareModal();

      // Send embed message in chat
      var currentConv = ChatState.getCurrentConversation();
      if (currentConv) {
        var previewName = (!burnAfterReading && !hasPassword) ? file.name : "Protected file (click to download)";
        var embedContent = previewName;
        if (hasPassword) embedContent += " (password protected)";
        var embedMsg = JSON.stringify({
          type: "share",
          content: embedContent,
          url: shareUrl,
        });
        await ChatState.sendMessage(currentConv.id, embedMsg);
      }
    } catch (err) {
      console.error("Embed share creation failed:", err);
      if (elements.embedShareError) {
        elements.embedShareError.textContent = err.message || "Failed to upload file.";
        elements.embedShareError.classList.remove("hidden");
      }
    } finally {
      if (createBtn) createBtn.disabled = false;
    }
  }

  // ── Event Listeners ─────────────────────────────────────────────────────

  function setupEventListeners() {
    // Conversation search filter
    if (elements.convSearch) {
      elements.convSearch.addEventListener("input", function () {
        renderConversationList(elements.convSearch.value);
      });
    }

    // New conversation button
    if (elements.newConvBtn) {
      elements.newConvBtn.addEventListener("click", function () {
        showNewConvModal();
      });
    }

    // Message input: send on Enter, typing indicator
    if (elements.messageInput) {
      elements.messageInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          // Allow Enter inside list items to create new list items
          if (isCursorInList()) return;
          e.preventDefault();
          sendMessage();
        }
      });

      elements.messageInput.addEventListener("input", function () {
        handleTyping();
        autoGrowEditor();
      });
    }

    // Send button
    if (elements.sendBtn) {
      elements.sendBtn.addEventListener("click", function () {
        sendMessage();
      });
    }

    // Formatting toolbar buttons (use execCommand on contenteditable)
    var fmtActions = {
      "fmt-bold": function () { execFormat("bold"); },
      "fmt-italic": function () { execFormat("italic"); },
      "fmt-underline": function () { execFormat("underline"); },
      "fmt-code": function () { insertInlineCode(); },
      "fmt-ul": function () { insertList("ul"); },
      "fmt-ol": function () { insertList("ol"); },
    };
    Object.keys(fmtActions).forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener("mousedown", function (e) {
          e.preventDefault(); // Prevent stealing focus from contenteditable
        });
        btn.addEventListener("click", fmtActions[id]);
      }
    });

    // Chat info button
    if (elements.chatInfoBtn) {
      elements.chatInfoBtn.addEventListener("click", function () {
        showInfoModal();
      });
    }

    // Back button (mobile)
    if (elements.backBtn) {
      elements.backBtn.addEventListener("click", function () {
        var sidebar = document.getElementById("chat-sidebar");
        if (sidebar) {
          sidebar.classList.remove("hidden");
        }
        elements.backBtn.classList.add("hidden");
      });
    }

    // Leave conversation button
    if (elements.leaveConvBtn) {
      elements.leaveConvBtn.addEventListener("click", function () {
        leaveCurrentConversation();
      });
    }

    // Close info modal
    if (elements.closeInfoBtn) {
      elements.closeInfoBtn.addEventListener("click", function () {
        hideInfoModal();
      });
    }

    // New conversation modal: tab switching
    if (elements.directTab) {
      elements.directTab.addEventListener("click", function () {
        setActiveTab("direct");
      });
    }
    if (elements.groupTab) {
      elements.groupTab.addEventListener("click", function () {
        setActiveTab("group");
      });
    }

    // User search in new conversation modal
    if (elements.userSearchInput) {
      elements.userSearchInput.addEventListener("input", function () {
        clearTimeout(userSearchDebounce);
        var query = elements.userSearchInput.value;
        userSearchDebounce = setTimeout(function () {
          searchUsers(query);
        }, 150);
      });
    }

    // Cancel new conversation
    if (elements.cancelConvBtn) {
      elements.cancelConvBtn.addEventListener("click", function () {
        hideNewConvModal();
      });
    }

    // Create conversation
    if (elements.createConvBtn) {
      elements.createConvBtn.addEventListener("click", function () {
        createConversation();
      });
    }

    // Group name input updates create button state
    var groupNameInput = document.getElementById("group-name-input");
    if (groupNameInput) {
      groupNameInput.addEventListener("input", function () {
        updateCreateBtnState();
      });
    }

    // Add member search
    if (elements.addMemberSearch) {
      elements.addMemberSearch.addEventListener("input", function () {
        clearTimeout(addMemberSearchDebounce);
        var query = elements.addMemberSearch.value;
        addMemberSearchDebounce = setTimeout(function () {
          searchAddMember(query);
        }, 300);
      });
    }

    // Sidebar toggle (mobile)
    if (elements.sidebarToggle) {
      elements.sidebarToggle.addEventListener("click", function () {
        var sidebar = document.getElementById("chat-sidebar");
        if (sidebar) {
          sidebar.classList.toggle("hidden");
        }
      });
    }

    // Scroll detection for auto-scroll behavior
    if (elements.messagesContainer) {
      elements.messagesContainer.addEventListener("scroll", function () {
        userScrolledUp = !isScrolledToBottom();
      });
    }

    // Emoji button
    if (elements.emojiBtn) {
      elements.emojiBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleEmojiPicker();
      });
    }

    // Close emoji picker on outside click
    document.addEventListener("click", function (e) {
      if (elements.emojiPicker && !elements.emojiPicker.classList.contains("hidden")) {
        if (!elements.emojiPicker.contains(e.target) && e.target !== elements.emojiBtn) {
          hideEmojiPicker();
        }
      }
    });

    // Embed paste button
    if (elements.embedPasteBtn) {
      elements.embedPasteBtn.addEventListener("click", function () {
        showPasteModal();
      });
    }

    // Embed share button
    if (elements.embedShareBtn) {
      elements.embedShareBtn.addEventListener("click", function () {
        showShareModal();
      });
    }

    // Paste modal: cancel
    if (elements.cancelEmbedPaste) {
      elements.cancelEmbedPaste.addEventListener("click", function () {
        hidePasteModal();
      });
    }

    // Paste modal: create
    if (elements.createEmbedPaste) {
      elements.createEmbedPaste.addEventListener("click", function () {
        createEmbedPaste();
      });
    }

    // Paste modal: text input for gutter + char count
    if (elements.embedPasteText) {
      elements.embedPasteText.addEventListener("input", function () {
        updateEmbedPasteGutter();
        if (elements.embedPasteCharCount) {
          elements.embedPasteCharCount.textContent = elements.embedPasteText.value.length + " characters";
        }
      });
    }

    // Paste modal: password toggle
    if (elements.embedPasteTogglePw) {
      elements.embedPasteTogglePw.addEventListener("click", function () {
        var isPassword = elements.embedPastePassword.type === "password";
        elements.embedPastePassword.type = isPassword ? "text" : "password";
        elements.embedPasteTogglePw.querySelector(".eye-open").classList.toggle("hidden", isPassword);
        elements.embedPasteTogglePw.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
      });
    }

    // Paste modal: preview button
    if (elements.embedPastePreviewBtn) {
      elements.embedPastePreviewBtn.addEventListener("click", function () {
        previewEmbedPaste();
      });
    }

    // Paste preview modal: close button
    if (elements.closeEmbedPastePreview) {
      elements.closeEmbedPastePreview.addEventListener("click", function () {
        if (elements.embedPastePreviewModal) {
          elements.embedPastePreviewModal.classList.add("hidden");
        }
      });
    }

    // Paste preview modal: overlay click to close
    if (elements.embedPastePreviewModal) {
      elements.embedPastePreviewModal.addEventListener("click", function (e) {
        if (e.target === elements.embedPastePreviewModal) {
          elements.embedPastePreviewModal.classList.add("hidden");
        }
      });
    }

    // Share modal: password toggle
    if (elements.embedShareTogglePw) {
      elements.embedShareTogglePw.addEventListener("click", function () {
        var isPassword = elements.embedSharePassword.type === "password";
        elements.embedSharePassword.type = isPassword ? "text" : "password";
        elements.embedShareTogglePw.querySelector(".eye-open").classList.toggle("hidden", isPassword);
        elements.embedShareTogglePw.querySelector(".eye-closed").classList.toggle("hidden", !isPassword);
      });
    }

    // Share modal: cancel
    if (elements.cancelEmbedShare) {
      elements.cancelEmbedShare.addEventListener("click", function () {
        hideShareModal();
      });
    }

    // Share modal: upload
    if (elements.createEmbedShare) {
      elements.createEmbedShare.addEventListener("click", function () {
        createEmbedShare();
      });
    }

    // Close modals on overlay click
    if (elements.newConvModal) {
      elements.newConvModal.addEventListener("click", function (e) {
        if (e.target === elements.newConvModal) {
          hideNewConvModal();
        }
      });
    }
    if (elements.infoModal) {
      elements.infoModal.addEventListener("click", function (e) {
        if (e.target === elements.infoModal) {
          hideInfoModal();
        }
      });
    }
    if (elements.pasteModal) {
      elements.pasteModal.addEventListener("click", function (e) {
        if (e.target === elements.pasteModal) {
          hidePasteModal();
        }
      });
    }
    if (elements.shareModal) {
      elements.shareModal.addEventListener("click", function (e) {
        if (e.target === elements.shareModal) {
          hideShareModal();
        }
      });
    }

    // Close modals on Escape key
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        // Preview modal first (highest z-index)
        if (
          elements.embedPastePreviewModal &&
          !elements.embedPastePreviewModal.classList.contains("hidden")
        ) {
          elements.embedPastePreviewModal.classList.add("hidden");
        } else if (
          elements.newConvModal &&
          !elements.newConvModal.classList.contains("hidden")
        ) {
          hideNewConvModal();
        } else if (
          elements.infoModal &&
          !elements.infoModal.classList.contains("hidden")
        ) {
          hideInfoModal();
        } else if (
          elements.pasteModal &&
          !elements.pasteModal.classList.contains("hidden")
        ) {
          hidePasteModal();
        } else if (
          elements.shareModal &&
          !elements.shareModal.classList.contains("hidden")
        ) {
          hideShareModal();
        }
        // Close emoji picker on escape
        hideEmojiPicker();
      }
    });

    // Window resize handler
    window.addEventListener("resize", handleResize);
  }

  // ── State Change Listener ───────────────────────────────────────────────

  ChatState.onStateChange(function (type, data) {
    switch (type) {
      case "conversations":
        renderConversationList(
          elements.convSearch ? elements.convSearch.value : ""
        );
        break;

      case "currentConversation":
        updateChatView();
        renderConversationList(
          elements.convSearch ? elements.convSearch.value : ""
        );
        break;

      case "messages":
        // Full message list was refreshed — re-render if viewing this conversation
        if (data && data.conversationId) {
          var currentConv = ChatState.getCurrentConversation();
          if (currentConv && currentConv.id === data.conversationId) {
            // Messages are loaded internally; we just re-render the list
            // ChatState.loadMessages already updated the internal cache
          }
        }
        renderConversationList(
          elements.convSearch ? elements.convSearch.value : ""
        );
        break;

      case "message":
        if (data && data.message) {
          appendNewMessage(data.message);
          scrollToBottom();
        }
        // Update conversation list for unread ordering
        renderConversationList(
          elements.convSearch ? elements.convSearch.value : ""
        );
        break;

      case "typing":
        if (data) {
          showTypingIndicator(data.userId, data.conversationId);
        }
        break;

      case "stop_typing":
        hideTypingIndicator();
        break;

      case "unread":
        renderConversationList(
          elements.convSearch ? elements.convSearch.value : ""
        );
        break;

      case "presence":
        // Update subtitle if viewing a direct conversation
        var conv = ChatState.getCurrentConversation();
        if (conv && conv.type === "direct" && elements.chatSubtitle) {
          elements.chatSubtitle.textContent = getConversationSubtitle(conv);
        }
        // Refresh info modal if open
        if (
          elements.infoModal &&
          !elements.infoModal.classList.contains("hidden") &&
          conv
        ) {
          renderInfoMembers(conv);
        }
        break;

      case "member_added":
      case "member_removed":
        // Refresh info modal if open
        var currentConv = ChatState.getCurrentConversation();
        if (
          elements.infoModal &&
          !elements.infoModal.classList.contains("hidden") &&
          currentConv
        ) {
          renderInfoMembers(currentConv);
        }
        break;

      case "rekey":
        // Key was rotated — no UI action needed, keys are cached internally
        break;
    }
  });

  // ── Mobile Responsive Handling ──────────────────────────────────────────

  function handleResize() {
    var isMobile = window.innerWidth < 768;
    var sidebar = document.getElementById("chat-sidebar");

    if (!isMobile) {
      if (sidebar) {
        sidebar.classList.remove("hidden");
      }
      if (elements.backBtn) {
        elements.backBtn.classList.add("hidden");
      }
    }
  }

  // ── Authentication & Initialization ─────────────────────────────────────

  try {
    var authRes = await fetch("/api/auth/me");
    var authData = await authRes.json();

    if (!authData.authenticated || authData.guest) {
      window.location.href = "/login";
      return;
    }

    var userId = authData.user.id;

    // Initialize chat state
    await ChatState.init(userId);

    // Connect WebSocket
    ChatWS.connect();

    // Show the chat app
    var chatApp = document.getElementById("chat-app");
    var authRequired = document.getElementById("auth-required");

    if (chatApp) {
      chatApp.classList.remove("hidden");
    }
    if (authRequired) {
      authRequired.classList.add("hidden");
    }

    // Render initial state
    renderConversationList();
    setupEventListeners();
    initEmojiPicker();

    // Check if user has RSA key pair, prompt setup if not
    var keyCheck = await ChatCrypto.getKeyFromIndexedDB(userId);
    if (!keyCheck) {
      // Try to restore from server backup
      try {
        var backupRes = await fetch("/api/chat/keys/backup");
        if (backupRes.ok) {
          // Backup exists but we need the user's password to decrypt it
          // Show key restore modal — for now, show setup modal
        }
      } catch (e) {
        // Ignore fetch errors
      }
      showKeySetupModal();
    }
  } catch (err) {
    console.error("Chat initialization failed:", err);
    var authRequiredEl = document.getElementById("auth-required");
    if (authRequiredEl) {
      authRequiredEl.textContent =
        "Failed to initialize chat. Please refresh the page.";
    }
  }
})();
