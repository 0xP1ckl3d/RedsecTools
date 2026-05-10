const assert = require("node:assert/strict");
const { createRouteHarness } = require("../helpers/route-harness");

(async () => {
  const harness = await createRouteHarness({ name: "notifications-routes", routes: [] });

  // Register notification routes manually since the harness doesn't know about them
  const notificationRouter = require("../../server/routes/notifications");
  harness.app.use("/api", notificationRouter);

  try {
    const user = harness.createUserWithSession({ id: "notif-user", permissions: [] });
    const other = harness.createUserWithSession({ id: "notif-other", permissions: [] });
    const { createNotification, getNotificationsByUserId, getUnreadNotificationCount } = harness.database;

    // --- Test: List notifications returns empty for new user ---
    const listEmpty = await harness.requestJson({ path: "/api/notifications", cookie: user.cookie });
    assert.equal(listEmpty.status, 200);
    assert.equal(listEmpty.body.notifications.length, 0);
    assert.equal(listEmpty.body.unreadCount, 0);

    // --- Test: Create notification directly via DB and list it ---
    createNotification({
      userId: user.id,
      category: "system",
      title: "Test notification",
      body: "This is a test",
      severity: "info",
    });
    createNotification({
      userId: user.id,
      category: "engage",
      action: "qa_assigned",
      title: "QA assigned",
      body: "You have been assigned a QA review",
      severity: "warning",
    });

    const listAfter = await harness.requestJson({ path: "/api/notifications", cookie: user.cookie });
    assert.equal(listAfter.status, 200);
    assert.equal(listAfter.body.notifications.length, 2);
    assert.equal(listAfter.body.unreadCount, 2);
    const titles = listAfter.body.notifications.map((n) => n.title);
    assert.ok(titles.includes("QA assigned"));
    assert.ok(titles.includes("Test notification"));

    // --- Test: Notifications are user-scoped (cross-user isolation) ---
    const otherList = await harness.requestJson({ path: "/api/notifications", cookie: other.cookie });
    assert.equal(otherList.status, 200);
    assert.equal(otherList.body.notifications.length, 0);
    assert.equal(otherList.body.unreadCount, 0);

    // --- Test: Mark single notification as read ---
    const notifId = listAfter.body.notifications[0].id;
    const markRead = await harness.requestJson({
      method: "POST",
      path: `/api/notifications/${notifId}/read`,
      cookie: user.cookie,
    });
    assert.equal(markRead.status, 200);
    assert.equal(markRead.body.success, true);
    assert.equal(markRead.body.unreadCount, 1);

    // --- Test: Cross-user cannot mark another user's notification as read ---
    const otherMarkRead = await harness.requestJson({
      method: "POST",
      path: `/api/notifications/${notifId}/read`,
      cookie: other.cookie,
    });
    assert.equal(otherMarkRead.status, 404);

    // --- Test: Mark all as read ---
    createNotification({
      userId: user.id,
      category: "system",
      title: "Third notification",
      body: "Another test",
      severity: "success",
    });

    const markAll = await harness.requestJson({
      method: "POST",
      path: "/api/notifications/read-all",
      cookie: user.cookie,
    });
    assert.equal(markAll.status, 200);
    assert.equal(markAll.body.success, true);
    assert.equal(markAll.body.markedRead, 2);
    assert.equal(markAll.body.unreadCount, 0);

    // Verify all are read via list
    const listAllRead = await harness.requestJson({ path: "/api/notifications", cookie: user.cookie });
    assert.equal(listAllRead.body.unreadCount, 0);
    assert.equal(listAllRead.body.notifications.length, 3);
    for (const n of listAllRead.body.notifications) {
      assert.ok(n.read_at != null, `Notification ${n.id} should be read`);
    }

    // --- Test: Pagination ---
    for (let i = 0; i < 5; i++) {
      createNotification({
        userId: user.id,
        category: "system",
        title: `Pagination ${i}`,
        body: `Page test ${i}`,
        severity: "info",
      });
    }

    const page1 = await harness.requestJson({ path: "/api/notifications?limit=2&offset=0", cookie: user.cookie });
    assert.equal(page1.body.notifications.length, 2);

    const page2 = await harness.requestJson({ path: "/api/notifications?limit=2&offset=2", cookie: user.cookie });
    assert.equal(page2.body.notifications.length, 2);
    assert.notEqual(page1.body.notifications[0].id, page2.body.notifications[0].id);

    // --- Test: Unauthenticated requests are rejected ---
    const noAuth = await harness.requestJson({ path: "/api/notifications" });
    assert.equal(noAuth.status, 401);

    const noAuthRead = await harness.requestJson({ method: "POST", path: "/api/notifications/read-all" });
    assert.equal(noAuthRead.status, 401);

    // --- Test: DB-level functions work correctly ---
    const dbNotifs = getNotificationsByUserId(user.id, 100, 0);
    assert.ok(dbNotifs.length >= 8, "Should have all notifications");

    const dbCount = getUnreadNotificationCount(user.id);
    assert.equal(dbCount, 5, "Should have 5 unread from pagination test");

    // --- Test: Notification with all fields ---
    const fullNotif = createNotification({
      userId: user.id,
      category: "engage",
      action: "engagement_assigned",
      title: "Engagement assigned",
      body: "You are now the tech lead",
      linkUrl: "/engage/engagements/abc",
      entityType: "engagement",
      entityId: "abc",
      severity: "critical",
    });
    assert.ok(fullNotif);
    assert.equal(fullNotif.category, "engage");
    assert.equal(fullNotif.action, "engagement_assigned");
    assert.equal(fullNotif.link_url, "/engage/engagements/abc");
    assert.equal(fullNotif.entity_type, "engagement");
    assert.equal(fullNotif.entity_id, "abc");
    assert.equal(fullNotif.severity, "critical");
    assert.ok(fullNotif.id);

    // --- Test: Expired notifications are filtered from queries ---
    createNotification({
      userId: user.id,
      category: "system",
      title: "Expired notif",
      body: "Should not appear",
      severity: "info",
      expiresAt: Math.floor(Date.now() / 1000) - 3600,
    });
    const afterExpiry = await harness.requestJson({ path: "/api/notifications?limit=100", cookie: user.cookie });
    const expiredTitles = afterExpiry.body.notifications.map((n) => n.title);
    assert.ok(!expiredTitles.includes("Expired notif"), "Expired notifications should not appear");

    // --- Test: Default severity is info ---
    const noSeverity = createNotification({
      userId: user.id,
      category: "system",
      title: "No severity",
    });
    assert.equal(noSeverity.severity, "info");

    console.log("All notification integration tests passed");
  } finally {
    await harness.close();
  }
})();
