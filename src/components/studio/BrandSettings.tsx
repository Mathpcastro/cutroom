import { useEffect, useState } from "react";
import { useStudioGuard } from "./useStudioGuard";

interface Brand { name: string; handle?: string; context: string; website?: string; logo?: string; palette: { accent: string; ink: string; paper: string }; source: "manual" | "carrossell" }

const api = <T,>(method: string, params?: unknown) => window.cutroom!.request<T>(method, params);
const EMPTY_BRAND: Brand = { name: "", context: "", palette: { accent: "#E8462F", ink: "#1E1C1A", paper: "#EBE7E1" }, source: "manual" };

export function BrandSettings() {
  const { error, notice, guard } = useStudioGuard();
  const [brand, setBrand] = useState<Brand>(EMPTY_BRAND);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    void api<{ brand: Brand | null }>("getBrand").then((r) => r.brand && setBrand(r.brand), () => undefined);
  }, []);
  const setPalette = (key: keyof Brand["palette"], value: string) => setBrand({ ...brand, palette: { ...brand.palette, [key]: value } });

  return (
    <section className="studio-section">
      {error && <p className="studio-error" role="alert">{error}</p>}
      {notice && <p className="studio-notice">{notice}</p>}
      <p className="studio-lead">Os vídeos usam o nome, o tom, a oferta e as cores daqui. Importe do Carrossell ou preencha à mão.</p>
      <div className="studio-actions">
        <button className="button" onClick={() => void guard(async () => setProfiles((await api<{ profiles: { id: string; name: string }[] }>("carrossellProfiles")).profiles))}>Importar do Carrossell</button>
        {profiles?.map((p) => (
          <button key={p.id} className="button small" onClick={() => void guard(async () => { setBrand((await api<{ brand: Brand }>("importCarrossellBrand", { profileId: p.id })).brand); setProfiles(null); }, `Marca importada do perfil ${p.name}.`)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="field-pair">
        <label className="field">Nome da marca<input value={brand.name} maxLength={200} onChange={(e) => setBrand({ ...brand, name: e.target.value })} /></label>
        <label className="field">@ do Instagram<input value={brand.handle ?? ""} maxLength={100} onChange={(e) => setBrand({ ...brand, handle: e.target.value })} /></label>
      </div>
      <label className="field">
        O que vende, para quem, tom e oferta
        <textarea rows={5} value={brand.context} maxLength={60000} placeholder="Ex.: App de agenda para clínicas de estética. Tom direto e leve. Oferta: 7 dias grátis." onChange={(e) => setBrand({ ...brand, context: e.target.value })} />
      </label>
      <label className="field">Site<input value={brand.website ?? ""} maxLength={500} placeholder="https://" onChange={(e) => setBrand({ ...brand, website: e.target.value })} /></label>
      <div className="studio-colors">
        {(["accent", "ink", "paper"] as const).map((k) => (
          <label key={k} className="field color-field">
            {k === "accent" ? "Destaque" : k === "ink" ? "Texto" : "Fundo"}
            <input type="color" value={brand.palette[k]} onChange={(e) => setPalette(k, e.target.value)} />
          </label>
        ))}
        <label className="field">
          Logo (PNG, JPG, WebP ou SVG)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setBrand({ ...brand, logo: String(reader.result) });
              reader.readAsDataURL(file);
            }}
          />
        </label>
        {brand.logo && <img className="studio-logo" src={brand.logo} alt="Logo da marca" />}
      </div>
      <div className="studio-actions">
        <button className="button primary" onClick={() => void guard(async () => setBrand((await api<{ brand: Brand }>("saveBrand", { ...brand, source: brand.source ?? "manual" })).brand), "Marca salva.")}>Salvar marca</button>
      </div>
    </section>
  );
}
