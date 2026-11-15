import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Camera, Check, LoaderCircle, Sparkles } from "lucide-react";
import type { StudioProfile } from "../../shared/profile";
import { ACCESSORIES, AVATAR_BASES, BASE_LABEL, DEFAULT_CHOICE, FACIAL_HAIR, HAIR_COLORS, HAIR_STYLES, HATS, LOOK_PRESETS_AVATAR, OUTFITS, OUTFIT_COLORS, PANTS_COLORS, SKIN_TONES, composeAvatar, type AccessoryId, type AvatarBaseId, type AvatarChoice, type FacialHair, type HairStyle, type Hat, type Outfit } from "../../shared/avatar-compose";
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
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const keysOf = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
/** Every kit choice the AI can fill (from the brand or from a photo). */
const suggestion = z.object({
  name: z.string().min(1).max(40),
  personality: z.string().max(600),
  face: z.enum(AVATAR_BASES).catch("strategist"), hair: z.enum(keysOf(HAIR_STYLES)).catch("curto"), outfit: z.enum(AVATAR_BASES).catch("strategist"),
  top: z.enum(keysOf(OUTFITS)).catch("camiseta"), facial: z.enum(keysOf(FACIAL_HAIR)).catch("none"), lashes: z.boolean().catch(false), hat: z.enum(keysOf(HATS)).catch("none"),
  accessory: z.enum(["none", "headphones", "glasses"]).catch("none"),
  skin: z.number().int().min(0).max(4).catch(1),
  hairColor: hexColor.catch("#453B56"), outfitColor: hexColor.catch("#385579"), accentColor: hexColor.catch("#E7B85C"), pantsColor: hexColor.catch("#2A2A33"),
  pose: z.enum(POSES).optional().catch(undefined),
});
const KIT_MENU = `face/outfit entre strategist (rosto anguloso; corpo de blazer estruturado), companion (rosto redondo; corpo de moletom), expert (rosto oval; corpo de camisa); hair em ${Object.keys(HAIR_STYLES).join(", ")} (strategist = curto com topete anguloso, companion = cacheado volumoso, expert = repartido de lado); top (a peça de roupa) em ${Object.keys(OUTFITS).join(", ")} ("base" mantém a roupa do corpo); facial em ${Object.keys(FACIAL_HAIR).join(", ")}; lashes true/false (cílios marcados); hat em ${Object.keys(HATS).join(", ")}; accessory em none, headphones, glasses; skin de 0 (mais clara) a 4 (mais escura); hairColor, outfitColor, accentColor (detalhes) e pantsColor em hex.`;
const KIT_JSON = `{"name":"","personality":"","face":"strategist","hair":"curto","outfit":"strategist","top":"camisa","facial":"none","lashes":false,"hat":"none","accessory":"none","skin":1,"hairColor":"#453B56","outfitColor":"#385579","accentColor":"#E7B85C","pantsColor":"#2A2A33","pose":"explaining"}`;
const toChoice = (r: z.infer<typeof suggestion>): AvatarChoice => ({ face: r.face, hair: r.hair as HairStyle, outfit: r.outfit, top: r.top as Outfit, facial: r.facial as FacialHair, lashes: r.lashes, hat: r.hat as Hat, accessory: r.accessory as AccessoryId, skin: r.skin, hairColor: r.hairColor, outfitColor: r.outfitColor, accentColor: r.accentColor, pantsColor: r.pantsColor });

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
  const [busy, setBusy] = useState<"" | "ai" | "photo" | "save">("");
  const [photo, setPhoto] = useState("");
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
Escolha: name (nome curto e simpático do apresentador), personality (2 frases: jeito de falar e de se mexer, para combinar com quem compra), ${KIT_MENU} Use a cor da marca na roupa ou nos detalhes. Pose favorita entre ${POSES.join(", ")}.
Responda só com JSON: ${KIT_JSON}`, "Sugerir avatar pela marca", suggestion);
      setName(r.name);
      setPersonality(r.personality);
      setChoice(toChoice(r));
      if (r.pose) setPose(r.pose);
      setDone(false);
    } catch (reason) {
      setError(String(reason).replace(/^Error.*?: (Error: )?/, ""));
    } finally {
      setBusy("");
    }
  }

  /** A photo of the person: the AI reads hair, skin, beard, glasses and clothes and picks the closest kit pieces. */
  async function fromPhoto() {
    if (!aiConnected) { openAiConnect(); return; }
    setError("");
    try {
      const picked = await studioRequest<{ canceled?: boolean; id?: string; preview?: string }>("avatarPhotoPick");
      if (picked.canceled || !picked.id) return;
      setPhoto(picked.preview ?? "");
      setBusy("photo");
      const r = await structuredReply(`A imagem anexada é uma foto da pessoa que vai virar um avatar em pixel art (96 px, estilo de jogo). Descreva só a aparência visível para escolher as peças mais parecidas: formato do rosto, tom de pele, corte e cor do cabelo, barba ou bigode, óculos, boné, roupa e cores. Não identifique a pessoa nem comente nada além da aparência. Se algo não aparece na foto, escolha um padrão neutro.
Escolha: name ${name.trim() ? `(mantenha "${name.trim().slice(0, 40)}")` : "(um nome curto e simpático)"}, personality ${personality.trim() ? "(mantenha a atual)" : "(2 frases neutras sobre o jeito de apresentar)"}, ${KIT_MENU}
Responda só com JSON: ${KIT_JSON}`, "Criar avatar pela foto", suggestion, [picked.id]);
      if (!name.trim()) setName(r.name);
      if (!personality.trim()) setPersonality(r.personality);
      setChoice(toChoice(r));
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
        <div className="page-actions">
          <button type="button" className="studio-secondary-button" disabled={!!busy} onClick={() => void fromPhoto()} title={t("A foto fica só neste computador e vai para a IA conectada apenas para descrever a aparência.")}>
            {busy === "photo" ? <LoaderCircle size={14} className="spin" /> : <Camera size={14} />} {t(busy === "photo" ? "Lendo a sua foto…" : "Criar a partir de uma foto")}
          </button>
          <button type="button" className="studio-secondary-button" disabled={!!busy} onClick={() => void suggest()}>
            {busy === "ai" ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} {t(busy === "ai" ? "Pensando no seu avatar…" : "Sugerir com IA pela marca")}
          </button>
        </div>
      </header>
      {error && <p className="reel-error" role="alert">{error}</p>}
      <div className="avatar-studio-body">
        <section className="avatar-stage">
          {pkg ? <LivePreview pkg={pkg} pose={pose} talking={talking} /> : <div className="avatar-live"><LoaderCircle className="spin" /></div>}
          <div className="avatar-stage-controls">
            <Options label="Pose" value={pose} onChange={setPose} options={[["cycle", "Todas"], ...POSES.map((p) => [p, POSE_LABEL[p]] as const)] as const} />
            <label className="mcp-mode"><input type="checkbox" checked={talking} onChange={(e) => setTalking(e.target.checked)} /> {t("Falando")}</label>
          </div>
          {photo && <img className="avatar-photo" src={photo} alt={t("Sua foto de referência")} />}
          <strong className="avatar-stage-name">{name || t("Sem nome")}</strong>
          {personality && <p className="avatar-stage-personality">{personality}</p>}
        </section>

        <section className="avatar-controls">
          <label className="field"><span>{t("Nome")}</span><input value={name} maxLength={40} placeholder={t("Ex.: Léo")} onChange={(e) => { setName(e.target.value); setDone(false); }} /></label>
          <div className="avatar-row"><span>{t("Começar com")}</span><Options label="Começar com" value={"" as string} onChange={(k) => set(LOOK_PRESETS_AVATAR[k as keyof typeof LOOK_PRESETS_AVATAR])} options={[["masculino", "Masculino"], ["feminino", "Feminino"], ["neutro", "Neutro"]] as const} /></div>
          <div className="avatar-row"><span>{t("Rosto")}</span><Options label="Rosto" value={choice.face} onChange={(face) => set({ face })} options={baseOptions} /></div>
          <div className="avatar-row"><span>{t("Pele")}</span>
            <div className="swatches" role="radiogroup" aria-label={t("Pele")}>
              {SKIN_TONES.map((tone, i) => <button key={i} type="button" role="radio" aria-checked={choice.skin === i} aria-label={`${t("Tom")} ${i + 1}`} style={{ background: tone[1] }} onClick={() => set({ skin: i })} />)}
            </div>
          </div>
          <div className="avatar-row"><span>{t("Cabelo")}</span>
            <select value={choice.hair} aria-label={t("Cabelo")} onChange={(e) => set({ hair: e.target.value as HairStyle })}>
              {(Object.entries(HAIR_STYLES) as [HairStyle, string][]).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
          </div>
          <div className="avatar-row"><span>{t("Cor do cabelo")}</span><Swatches label="Cor do cabelo" colors={HAIR_COLORS} value={choice.hairColor} onChange={(hairColor) => set({ hairColor })} /></div>
          <div className="avatar-row"><span>{t("Barba e cílios")}</span>
            <select value={choice.facial ?? "none"} aria-label={t("Barba")} onChange={(e) => set({ facial: e.target.value as FacialHair })}>
              {(Object.entries(FACIAL_HAIR) as [FacialHair, string][]).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
            <label className="mcp-mode"><input type="checkbox" checked={!!choice.lashes} onChange={(e) => set({ lashes: e.target.checked })} /> {t("Cílios")}</label>
          </div>
          <div className="avatar-row"><span>{t("Corpo")}</span><Options label="Corpo" value={choice.outfit} onChange={(outfit) => set({ outfit })} options={baseOptions} /></div>
          <div className="avatar-row"><span>{t("Roupa")}</span>
            <select value={choice.top ?? "base"} aria-label={t("Roupa")} onChange={(e) => set({ top: e.target.value as Outfit })}>
              {(Object.entries(OUTFITS) as [Outfit, string][]).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
          </div>
          <div className="avatar-row"><span>{t("Cor da roupa")}</span><Swatches label="Cor da roupa" colors={[...new Set([profile.brand.accent, ...OUTFIT_COLORS].filter((c): c is string => /^#[0-9a-f]{6}$/i.test(c ?? "")))]} value={choice.outfitColor} onChange={(outfitColor) => set({ outfitColor })} /></div>
          <div className="avatar-row"><span>{t("Cor da calça")}</span><Swatches label="Cor da calça" colors={PANTS_COLORS} value={choice.pantsColor ?? "#2A2A33"} onChange={(pantsColor) => set({ pantsColor })} /></div>
          <div className="avatar-row"><span>{t("Detalhes")}</span><Swatches label="Cor dos detalhes" colors={["#E7B85C", "#C8FF5A", "#FFFFFF", "#78D4D0", "#FF8FA3"]} value={choice.accentColor} onChange={(accentColor) => set({ accentColor })} /></div>
          <div className="avatar-row"><span>{t("Acessório")}</span><Options label="Acessório" value={choice.accessory} onChange={(accessory) => set({ accessory })} options={Object.entries(ACCESSORIES) as [AccessoryId, string][]} /></div>
          <div className="avatar-row"><span>{t("Chapéu")}</span><Options label="Chapéu" value={choice.hat ?? "none"} onChange={(hat) => set({ hat })} options={Object.entries(HATS) as [Hat, string][]} /></div>
          <label className="field"><span>{t("Personalidade")}</span><textarea rows={2} maxLength={600} value={personality} placeholder={t("Como ele fala e se mexe. Ex.: animado, direto, gesticula muito.")} onChange={(e) => { setPersonality(e.target.value); setDone(false); }} /></label>
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
