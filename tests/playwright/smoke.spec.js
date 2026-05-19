const { test, expect } = require("@playwright/test");
const AxeBuilder = require("axe-core");

async function injectAxe(page) {
  await page.addScriptTag({ content: AxeBuilder.source });
}

async function expectNoCriticalA11y(page) {
  await injectAxe(page);
  const results = await page.evaluate(async () => window.axe.run(document, {
    resultTypes: ["violations"],
    rules: {
      "color-contrast": { enabled: true },
    },
  }));
  const serious = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test("login shell renders across desktop and mobile without serious accessibility regressions", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /^login$/i })).toBeVisible();
  await expectNoCriticalA11y(page);
});

test("admin security panel exposes SAML and integration controls", async ({ page }) => {
  await page.goto("/admin");
  await page.getByPlaceholder(/admin password/i).fill("playwright-admin-password");
  await page.getByRole("button", { name: /login/i }).click();
  await page.getByRole("button", { name: /security/i }).click();
  await expect(page.getByText("Single Sign-On")).toBeVisible();
  await expect(page.getByText("Enable SAML SSO")).toBeVisible();
  await expect(page.getByText("Publish OpenAPI in admin")).toBeVisible();
  await expect(page.getByText("Enable service-account API", { exact: true })).toBeVisible();
  await expect(page.getByText("Enable platform webhooks", { exact: true })).toBeVisible();
  await expectNoCriticalA11y(page);
});
