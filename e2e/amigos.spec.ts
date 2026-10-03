import { expect, test } from "@playwright/test";

test("amigos abre com Seguindo e Seguidores quando a lista da Steam não pode ser lida", async ({ page }) => {
  await page.goto("/api/auth/dev-login");
  const res = await page.goto("/amigos");

  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Amigos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Seguindo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Seguidores" })).toBeVisible();
  await expect(page.getByText("Não deu para ler a sua lista de amigos da Steam agora")).toBeVisible();
  await expect(page.getByText("Sua lista de amigos está privada")).toHaveCount(0);
});
