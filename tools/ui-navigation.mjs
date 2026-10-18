/** Exercise the same menu routes users use, keeping smoke tests independent of layout. */
export async function workspacePanel(page, panel) {
  const names = {
    media: "Mídia",
    transcript: "Transcrição",
    style: "Estilo e edição",
  };
  const tools = page.getByRole("button", { name: "Ferramentas", exact: true });
  if (await tools.count()) {
    await tools.click();
    await page
      .getByRole("menuitem", { name: names[panel], exact: true })
      .click();
  } else {
    const legacy = {
      media: "Mídia",
      transcript: "Transcrição",
      style: "Estilo",
    };
    await page
      .getByRole("button", { name: legacy[panel], exact: true })
      .click();
  }
}

export async function conversationPanel(page, panel) {
  const name = panel === "packages" ? "Pacotes" : "Assistente";
  const menu = page.getByRole("button", { name: "Conversa", exact: true });
  if (await menu.count()) {
    await menu.click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  } else await page.getByRole("button", { name, exact: true }).click();
}

export async function expandGroup(page, title) {
  const summary = page.locator("summary").filter({ hasText: title }).first();
  if (await summary.count()) {
    const open = await summary.evaluate((item) => item.parentElement?.open);
    if (!open) await summary.click();
  }
}
