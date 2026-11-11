import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import type { StudioProfile } from "../../shared/profile";
import { ACCESSORIES, AVATAR_BASES, BASE_LABEL, DEFAULT_CHOICE, HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, composeAvatar, type AccessoryId, type AvatarBaseId, type AvatarChoice } from "../../shared/avatar-compose";
import { renderAvatarPixels } from "../../../resources/avatar-engine/avatar-engine.js";
import { t } from "./studioLanguage";
import { structuredReply, studioRequest } from "./salesReels";
import { openAiConnect } from "./AiConnect";

/**
 * Avatar creator: one screen. Live engine preview (talking, blinking, cycling poses), a few layered
 * choices (face, hair, outfit, accessory, colours, name, personality), an AI suggestion from the brand,
 * and one Save. No candidates, quality gates or approval steps.
 */

const POSES = ["neutral", "explaining", "pointing", "surprised", "celebrating"] as const;
const EXPRESSIONS = ["happy", "neutral", "confident", "thinking", "surprised", "serious"] as const;
const MOUTHS = ["X", "A", "E", "B", "C", "D", "F"] as const;
const POSE_LABEL: Record<(typeof POSES)[number], string> = { neutral: "Parado", explaining: "Explicando", pointing: "Apontando", surprised: "Surpreso", celebrating: "Comemorando" };

interface Saved { name: string; personality: string; choice: AvatarChoice }
/** The creator's last choices, kept in the profile (choice is stored as JSON text). */
function readSaved(profile: StudioProfile): Saved | null {
  const raw = profile.preferences?.avatarStudio as { name?: string; personality?: string; choice?: string } | undefined;
  if (!raw?.name || !raw.choice) return null;
  try {
    return { name: raw.name, personality: raw.personality ?? "", choice: { ...DEFAULT_CHOICE, ...(JSON.parse(raw.choice) as Partial<AvatarChoice>) } };
  } catch {
    return null;
  }
}
const suggestion = z.object({
  name: z.string().min(1).max(40),
  personality: z.string().max(600),
  face: z.enum(AVATAR_BASES), hair: z.enum(AVATAR_BASES), outfit: z.enum(AVATAR_BASES),
  accessory: z.enum(["none", "headphones", "glasses"]),
  skin: z.number().int().min(0).max(4),
  hairColor: z.string().regex(/^#[0-9a-f]{6}$/i), outfitColor: z.string().regex(/^#[0-9a-f]{6}$/i), accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  pose: z.enum(POSES).optional(),
});

/** Live preview: the real engine draws every frame (mouth, blink, pose cycle). */
function LivePreview({ pkg, pose, talking }: { pkg: unknown; pose: (typeof POSES)[number] | "cycle"; talking: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!pkg) return;
    let frame = 0, raf = 0, last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 1000 / 12) return;
      last = now;
      frame++;
      const canvas = ref.current;
      if (!canvas) return;
      try {
        const cyclePose = POSES[Math.floor(frame / 36) % POSES.length];
        const state = {
          pose: pose === "cycle" ? cyclePose : pose,
          expression: EXPRESSIONS[Math.floor(frame / 48) % EXPRESSIONS.length],
          mouth: talking ? MOUTHS[(frame * 7 + Math.floor(frame / 3)) % MOUTHS.length] : "X",
          blink: frame % 40 < 2 ? 1 : 0,
          frame,
        } as Parameters<typeof renderAvatarPixels>[1];
        const px = renderAvatarPixels(pkg, state);
        if (canvas.width !== px.width) { canvas.width = px.width; canvas.height = px.height; }
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
        setError("");
      } catch (reason) {
        setError(String(reason).slice(0, 120));
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pkg, pose, talking]);
  return (
    <div className="avatar-live">
      <canvas ref={ref} aria-label={t("Prévia do avatar")} />
      {error && <small className="reel-error">{error}</small>}
    </div>
  );
}

function Swatches({ colors, value, onChange, label }: { colors: readonly string[]; value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={t(label)}>
      {colors.map((c) => <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c.toLowerCase()} aria-label={c} style={{ background: c }} onClick={() => onChange(c)} />)}
      <label className="swatch-custom" title={t("Outra cor")}><input type="color" value={value} onChange={(e) => onChange(e.target.value)} /></label>
    </div>
  );
}

function Options<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented avatar-options" role="radiogroup" aria-label={t(label)}>
      {options.map(([id, name]) => <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}>{t(name)}</button>)}
    </div>
  );
}

export function AvatarStudio({ profile, aiConnected, onSaved }: { profile: StudioProfile; aiConnected: boolean; onSaved: (profile: StudioProfile) => void }) {
  const saved = readSaved(profile);
  const [bases, setBases] = useState<Record<AvatarBaseId, unknown> | null>(null);
  const [choice, setChoice] = useState<AvatarChoice>(saved?.choice ?? { ...DEFAULT_CHOICE, outfitColor: profile.brand.accent || DEFAULT_CHOICE.outfitColor });
  const [name, setName] = useState(saved?.name ?? "");
  const [personality, setPersonality] = useState(saved?.personality ?? "");
  const [pose, setPose] = useState<(typeof POSES)[number] | "cycle">("cycle");
  const [talking, setTalking] = useState(true);
  const [busy, setBusy] = useState<"" | "ai" | "save">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    studioRequest<Record<AvatarBaseId, unknown>>("avatarStudioBases").then(setBases, (reason) => setError(String(reason)));
  }, []);
  const pkg = useMemo(() => (bases ? composeAvatar(bases, choice, "preview") : null), [bases, choice]);
  const set = (patch: Partial<AvatarChoice>) => { setChoice((c) => ({ ...c, ...patch })); setDone(false); };

  async function suggest() {
    if (!aiConnected) { openAiConnect(); return; }
    setBusy("ai");
    setError("");
    try {
      const r = await structuredReply(`Sugira o apresentador em pixel art de uma marca para Reels de vendas.
Marca (dados): ${JSON.stringify({ nome: profile.brand.name || profile.name, oQueVende: profile.personality.description.slice(0, 2000), tom: profile.personality.presentation.slice(0, 300), corDaMarca: profile.brand.accent })}
Escolha: name (nome curto e simpático do apresentador), personality (2 frases: jeito de falar e de se mexer, para combinar com quem compra), face/hair/outfit entre strategist (estruturado, sério), companion (acolhedor, leve), expert (didático), accessory entre none, headphones, glasses, skin (0 a 4, do mais claro ao mais escuro), hairColor, outfitColor (use a cor da marca ou uma que combine), accentColor (contraste com a roupa), pose favorita entre ${POSES.join(", ")}.
Responda só com JSON: {"name":"","personality":"","face":"strategist","hair":"companion","outfit":"expert","accessory":"none","skin":1,"hairColor":"#453B56","outfitColor":"#385579","accentColor":"#E7B85C","pose":"explaining"}`, "Sugerir avatar pela marca", suggestion);
      setName(r.name);
      setPersonality(r.personality);
      setChoice({ face: r.face, hair: r.hair, outfit: r.outfit, accessory: r.accessory as AccessoryId, skin: r.skin, hairColor: r.hairColor, outfitColor: r.outfitColor, accentColor: r.accentColor });
      if (r.pose) setPose(r.pose);
      setDone(false);
    } catch (reason) {
      setError(String(reason).replace(/^Error.*?: (Error: )?/, ""));
    } finally {
      setBusy("");
    }
  }

  // First visit with no avatar yet: the AI fills everything from the brand.
  useEffect(() => {
    if (tried.current || saved || !aiConnected || !profile.personality.description.trim()) return;
    tried.current = true;
    void suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConnected]);

  async function save() {
    setBusy("save");
    setError("");
    try {
      const r = await studioRequest<{ profile: StudioProfile }>("avatarStudioSave", { profileId: profile.id, name: name.trim() || "Apresentador", personality: personality.trim(), choice });
      onSaved(r.profile);
      setDone(true);
    } catch (reason) {
      setError(String(reason).replace(/^Error.*?: (Error: )?/, ""));
    } finally {
      setBusy("");
    }
  }

  const baseOptions = AVATAR_BASES.map((b) => [b, BASE_LABEL[b]] as const);
  return (
    <div className="page avatar-studio">
      <header className="page-head">
        <div>
          <h1>{t("Seu avatar")}</h1>
          <p>{t("O apresentador dos seus vídeos. Mude o que quiser; a prévia é o motor de verdade, falando e se mexendo.")}</p>
        </div>
        <button type="button" className="studio-secondary-button" disabled={!!busy} onClick={() => void suggest()}>
          {busy === "ai" ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} {t(busy === "ai" ? "Pensando no seu avatar…" : "Sugerir com IA pela marca")}
        </button>
      </header>
      {error && <p className="reel-error" role="alert">{error}</p>}
      <div className="avatar-studio-body">
        <section className="avatar-stage">
          {pkg ? <LivePreview pkg={pkg} pose={pose} talking={talking} /> : <div className="avatar-live"><LoaderCircle className="spin" /></div>}
          <div className="avatar-stage-controls">
            <Options label="Pose" value={pose} onChange={setPose} options={[["cycle", "Todas"], ...POSES.map((p) => [p, POSE_LABEL[p]] as const)] as const} />
            <label className="mcp-mode"><input type="checkbox" checked={talking} onChange={(e) => setTalking(e.target.checked)} /> {t("Falando")}</label>
          </div>
          <strong className="avatar-stage-name">{name || t("Sem nome")}</strong>
          {personality && <p className="avatar-stage-personality">{personality}</p>}
        </section>

        <section className="avatar-controls">
          <label className="field"><span>{t("Nome")}</span><input value={name} maxLength={40} placeholder={t("Ex.: Léo")} onChange={(e) => { setName(e.target.value); setDone(false); }} /></label>
          <div className="avatar-row"><span>{t("Rosto e corpo")}</span><Options label="Rosto e corpo" value={choice.face} onChange={(face) => set({ face })} options={baseOptions} /></div>
          <div className="avatar-row"><span>{t("Pele")}</span>
            <div className="swatches" role="radiogroup" aria-label={t("Pele")}>
              {SKIN_TONES.map((tone, i) => <button key={i} type="button" role="radio" aria-checked={choice.skin === i} aria-label={`${t("Tom")} ${i + 1}`} style={{ background: tone[1] }} onClick={() => set({ skin: i })} />)}
            </div>
          </div>
          <div className="avatar-row"><span>{t("Cabelo")}</span><Options label="Cabelo" value={choice.hair} onChange={(hair) => set({ hair })} options={baseOptions} /></div>
          <div className="avatar-row"><span>{t("Cor do cabelo")}</span><Swatches label="Cor do cabelo" colors={HAIR_COLORS} value={choice.hairColor} onChange={(hairColor) => set({ hairColor })} /></div>
          <div className="avatar-row"><span>{t("Roupa")}</span><Options label="Roupa" value={choice.outfit} onChange={(outfit) => set({ outfit })} options={baseOptions} /></div>
          <div className="avatar-row"><span>{t("Cor da roupa")}</span><Swatches label="Cor da roupa" colors={[...new Set([profile.brand.accent, ...OUTFIT_COLORS].filter((c): c is string => /^#[0-9a-f]{6}$/i.test(c ?? "")))]} value={choice.outfitColor} onChange={(outfitColor) => set({ outfitColor })} /></div>
          <div className="avatar-row"><span>{t("Detalhes")}</span><Swatches label="Cor dos detalhes" colors={["#E7B85C", "#C8FF5A", "#FFFFFF", "#78D4D0", "#FF8FA3"]} value={choice.accentColor} onChange={(accentColor) => set({ accentColor })} /></div>
          <div className="avatar-row"><span>{t("Acessório")}</span><Options label="Acessório" value={choice.accessory} onChange={(accessory) => set({ accessory })} options={Object.entries(ACCESSORIES) as [AccessoryId, string][]} /></div>
          <label className="field"><span>{t("Personalidade")}</span><textarea rows={3} maxLength={600} value={personality} placeholder={t("Como ele fala e se mexe. Ex.: animado, direto, gesticula muito.")} onChange={(e) => { setPersonality(e.target.value); setDone(false); }} /></label>
          <div className="avatar-save">
            <button type="button" className="studio-primary-button" disabled={!!busy || !pkg} onClick={() => void save()}>
              {busy === "save" ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} {t(saved ? "Salvar mudanças" : "Salvar avatar")}
            </button>
            {done && <span className="notice-line ok"><Check size={14} /> {t("Pronto. Os próximos vídeos já usam este avatar.")}</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
