import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STORY_SAMPLE, storySpoken } from "../src/components/studio/ReelCreator";

// The motion kit is a browser script; load it with just enough of a window to parse stories.
function kit() {
  const window: Record<string, any> = { TIMING: { words: [], envelope: { fps: 30, db: [] }, voiceEnd: 0 } };
  new Function("window", "document", readFileSync("resources/film-kit/cutroom-motion.js", "utf8"))(window, {});
  return window.CRM;
}

describe("story mode", () => {
  it("narration gets only the spoken lines, in order", () => {
    const spoken = storySpoken(STORY_SAMPLE);
    expect(spoken.startsWith("Episódio um. O primeiro cliente. Bia, acorda!")).toBe(true);
    expect(spoken).not.toMatch(/Léo \(|Narrador:|\[cena|#/);
    expect(spoken.endsWith("Continua no próximo episódio.")).toBe(true);
  });

  it("the kit parses title, scenes, speakers and moods", () => {
    const story = kit().parseStory(STORY_SAMPLE);
    expect(story.episode).toBe("Episódio 1");
    expect(story.title).toBe("O primeiro cliente");
    expect(story.lines[1]).toMatchObject({ who: "Léo", mood: "animado", text: "Bia, acorda! Alguém pagou!" });
    expect(story.lines[1].scene).toMatchObject({ place: "quarto", time: "noite" });
    expect(story.lines.at(-1)).toMatchObject({ who: "Narrador", text: "Continua no próximo episódio." });
    expect(story.lines.find((l: { text: string }) => l.text.startsWith("Ele quer cancelar")).scene.place).toBe("escritorio");
    // Same words as the narration: the director maps lines to spoken words by count.
    const count = story.lines.reduce((n: number, l: { text: string }) => n + l.text.split(/\s+/).length, 0);
    expect(count).toBe(storySpoken(STORY_SAMPLE).split(/\s+/).length);
  });
});
