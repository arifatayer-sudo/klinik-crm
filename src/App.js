import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";

/* ═══════════════════════════════════════════
   SABİTLER
═══════════════════════════════════════════ */
const ISLEMLER = ["Botox", "Filler", "Mezoterapi"];
const ISLEM_RENK  = { Botox: "#2563eb", Filler: "#db2777", Mezoterapi: "#059669" };
const ISLEM_BG    = { Botox: "#eff6ff", Filler: "#fdf2f8", Mezoterapi: "#f0fdf4" };

const HATIRLATICI_KURALLARI = {
  Botox:      [{ etiket: "2 Hafta Kontrolü", gun: 14 }, { etiket: "3 Ay Yenileme",  gun: 90  }],
  Filler:     [{ etiket: "2 Hafta Kontrolü", gun: 14 }, { etiket: "3 Ay Rötuş",     gun: 90  }, { etiket: "6 Ay İncelemesi", gun: 180 }],
  Mezoterapi: [{ etiket: "2 Hafta Takibi",   gun: 14 }, { etiket: "3 Ay Destekleyici", gun: 90 }],
};

const PERSONEL_LISTESI = ["Dr. Ayşe Kaya", "Dr. Mehmet Öz", "Hem. Selin Arslan", "Hem. Zeynep Çelik", "Atanmamış"];
const PERSONEL_ROLLER  = { "Dr. Ayşe Kaya": "admin", "Dr. Mehmet Öz": "admin", "Hem. Selin Arslan": "personel", "Hem. Zeynep Çelik": "personel" };
const PERSONEL_PINLER  = { "Dr. Ayşe Kaya": "1234", "Dr. Mehmet Öz": "2345", "Hem. Selin Arslan": "3456", "Hem. Zeynep Çelik": "4567" };

const uid   = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const bugun = () => new Date().toISOString().slice(0, 10);
const gunEkle = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const gunFarki = (s) => { const a = new Date(s); a.setHours(0,0,0,0); const b = new Date(); b.setHours(0,0,0,0); return Math.ceil((a - b) / 86400000); };
const tarihFmt = (s) => s ? new Date(s).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const tarihKisa = (s) => s ? new Date(s).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }) : "—";
const normaliz = (s) => s?.replace(/\s/g, "").toLowerCase();

/* ═══════════════════════════════════════════
   ANA UYGULAMA
═══════════════════════════════════════════ */
export default function App() {
  const [hastalar,      setHastalar]      = useState([]);
  const [tedaviler,     setTedaviler]     = useState([]);
  const [hatirlaticilar, setHatirlaticilar] = useState([]);
  const [yukleniyor,    setYukleniyor]    = useState(true);

  const [kullanici, setKullanici] = useState(null);
  const [gorunum,   setGorunum]   = useState("panel");
  const [modal,     setModal]     = useState(null);
  const [seciliHasta, setSeciliHasta] = useState(null);
  const [bildirim,  setBildirim]  = useState(null);
  const [hatTab,    setHatTab]    = useState("bugun");
  const [hastaArama, setHastaArama] = useState("");
  const [filtreIslem, setFiltreIslem] = useState("Tümü");
  const [filtrePersonel, setFiltrePersonel] = useState("Tümü");

  const bildirimGoster = (msg, tip = "tamam") => {
    setBildirim({ msg, tip });
    setTimeout(() => setBildirim(null), 3200);
  };

  /* ── Supabase'den veri yükle ── */
  useEffect(() => {
    if (!kullanici) return;
    const veriyiYukle = async () => {
      setYukleniyor(true);
      const [{ data: h }, { data: t }, { data: r }] = await Promise.all([
        supabase.from("patients").select("*").order("created_at", { ascending: false }),
        supabase.from("treatments").select("*").order("date", { ascending: false }),
        supabase.from("reminders").select("*").order("due_date", { ascending: true }),
      ]);
      if (h) setHastalar(h.map(mapHasta));
      if (t) setTedaviler(t.map(mapTedavi));
      if (r) setHatirlaticilar(r.map(mapHatirlatici));
      setYukleniyor(false);
    };
    veriyiYukle();

    /* Gerçek zamanlı güncellemeler */
    const kanalH = supabase.channel("patients-ch").on("postgres_changes", { event: "*", schema: "public", table: "patients" }, () => veriyiYukle()).subscribe();
    const kanalT = supabase.channel("treatments-ch").on("postgres_changes", { event: "*", schema: "public", table: "treatments" }, () => veriyiYukle()).subscribe();
    const kanalR = supabase.channel("reminders-ch").on("postgres_changes", { event: "*", schema: "public", table: "reminders" }, () => veriyiYukle()).subscribe();

    return () => { supabase.removeChannel(kanalH); supabase.removeChannel(kanalT); supabase.removeChannel(kanalR); };
  }, [kullanici]);

  /* ── Veri eşleme (snake_case → camelCase) ── */
  const mapHasta = (r) => ({ id: r.id, isim: r.name, telefon: r.phone, notlar: r.notes || "", olusturuldu: r.created_at });
  const mapTedavi = (r) => ({ id: r.id, hastaId: r.patient_id, islem: r.procedure, tarih: r.date, fiyat: Number(r.price) || 0, notlar: r.notes || "", olusturuldu: r.created_at });
  const mapHatirlatici = (r) => ({ id: r.id, tedaviId: r.treatment_id, hastaId: r.patient_id, islem: r.procedure, etiket: r.label, sonTarih: r.due_date, durum: r.status, atanan: r.assigned_to, tamamlananTarih: r.completed_at, tamamlayan: r.completed_by, waGonderildi: r.wa_sent });

  /* ── Hasta işlemleri ── */
  const hastaEkle = async (veri) => {
    if (hastalar.some(h => normaliz(h.telefon) === normaliz(veri.telefon))) {
      bildirimGoster("⚠ Bu telefon numarası zaten kayıtlı", "uyari");
      return false;
    }
    const yeni = { id: uid(), name: veri.isim, phone: veri.telefon, notes: veri.notlar || "", created_at: bugun() };
    const { error } = await supabase.from("patients").insert(yeni);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return false; }
    bildirimGoster("Hasta eklendi ✓");
    return true;
  };

  const hastaSil = async (id) => {
    await supabase.from("patients").delete().eq("id", id);
    setSeciliHasta(null); setModal(null);
    bildirimGoster("Hasta silindi", "uyari");
  };

  const hastaGuncelle = async (id, veri) => {
    await supabase.from("patients").update({ notes: veri.notlar }).eq("id", id);
    bildirimGoster("Notlar kaydedildi ✓");
  };

  /* ── Tedavi işlemleri ── */
  const tedaviEkle = async (hastaId, veri) => {
    const t = { id: uid(), patient_id: hastaId, procedure: veri.islem, date: veri.tarih, price: Number(veri.fiyat) || 0, notes: veri.notlar || "", created_at: bugun() };
    const { error } = await supabase.from("treatments").insert(t);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return; }
    const yeniHatirlaticilar = HATIRLATICI_KURALLARI[veri.islem].map(k => ({
      id: uid(), treatment_id: t.id, patient_id: hastaId, procedure: veri.islem,
      label: k.etiket, due_date: gunEkle(veri.tarih, k.gun),
      status: "pending", assigned_to: kullanici?.isim || "Atanmamış",
      completed_at: null, completed_by: null, wa_sent: false,
    }));
    await supabase.from("reminders").insert(yeniHatirlaticilar);
    bildirimGoster(`${veri.islem} eklendi — ${yeniHatirlaticilar.length} hatırlatıcı oluşturuldu ✓`);
  };

  /* ── Hatırlatıcı işlemleri ── */
  const tamamlaIsaretle = async (id) => {
    await supabase.from("reminders").update({ status: "done", completed_at: bugun(), completed_by: kullanici?.isim || "Personel" }).eq("id", id);
    bildirimGoster("Tamamlandı ✓");
  };
  const bekleyeAl = async (id) => {
    await supabase.from("reminders").update({ status: "pending", completed_at: null, completed_by: null }).eq("id", id);
  };
  const personelAta = async (id, personel) => {
    await supabase.from("reminders").update({ assigned_to: personel }).eq("id", id);
  };
  const waGonderildiIsaretle = async (id) => {
    await supabase.from("reminders").update({ wa_sent: true }).eq("id", id);
  };

  /* ── CSV İçe Aktarma ── */
  const csvIceriAktar = async (csv) => {
    const satirlar = csv.trim().split("\n").slice(1);
    let eklendi = 0, atlandi = 0;
    for (const satir of satirlar) {
      const kolonlar = satir.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      const [isim, telefon, islem, tarih, fiyat, notlar] = kolonlar;
      if (!isim || !telefon) { atlandi++; continue; }
      if (hastalar.some(h => normaliz(h.telefon) === normaliz(telefon))) { atlandi++; continue; }
      const p = { id: uid(), name: isim, phone: telefon, notes: notlar || "", created_at: bugun() };
      await supabase.from("patients").insert(p);
      if (islem && tarih && ISLEMLER.includes(islem)) {
        const t = { id: uid(), patient_id: p.id, procedure: islem, date: tarih, price: Number(fiyat) || 0, notes: "", created_at: bugun() };
        await supabase.from("treatments").insert(t);
        const rems = HATIRLATICI_KURALLARI[islem].map(k => ({ id: uid(), treatment_id: t.id, patient_id: p.id, procedure: islem, label: k.etiket, due_date: gunEkle(tarih, k.gun), status: "pending", assigned_to: "Atanmamış", completed_at: null, completed_by: null, wa_sent: false }));
        await supabase.from("reminders").insert(rems);
      }
      eklendi++;
    }
    bildirimGoster(`${eklendi} hasta eklendi, ${atlandi} atlandı`);
  };

  /* ── Hesaplananlar ── */
  const hastaHaritasi = Object.fromEntries(hastalar.map(h => [h.id, h]));
  const bugunStr = bugun();
  const bugunHat    = hatirlaticilar.filter(r => r.durum === "pending" && r.sonTarih === bugunStr);
  const gecmisHat   = hatirlaticilar.filter(r => r.durum === "pending" && r.sonTarih < bugunStr);
  const gelecekHat  = hatirlaticilar.filter(r => r.durum === "pending" && r.sonTarih > bugunStr);
  const tamamlananHat = hatirlaticilar.filter(r => r.durum === "done");
  const toplamGelir = tedaviler.reduce((s, t) => s + (t.fiyat || 0), 0);
  const aylikGelir  = tedaviler.filter(t => t.tarih?.slice(0, 7) === bugunStr.slice(0, 7)).reduce((s, t) => s + (t.fiyat || 0), 0);

  const filtreliHatirlaticilar = (() => {
    let l = hatTab === "bugun" ? bugunHat : hatTab === "gecmis" ? gecmisHat : hatTab === "gelecek" ? gelecekHat : hatirlaticilar;
    if (filtreIslem !== "Tümü") l = l.filter(r => r.islem === filtreIslem);
    if (filtrePersonel !== "Tümü") l = l.filter(r => r.atanan === filtrePersonel);
    return [...l].sort((a, b) => a.sonTarih.localeCompare(b.sonTarih));
  })();

  const filtreliHastalar = hastalar.filter(h => {
    const q = hastaArama.toLowerCase();
    return h.isim.toLowerCase().includes(q) || h.telefon.includes(q) || h.id.toLowerCase().includes(q);
  });

  if (!kullanici) return <GirisEkrani onGiris={u => setKullanici(u)} bildirim={bildirim} />;

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f8f6f3", fontFamily: "'Outfit','Helvetica Neue',sans-serif", overflow: "hidden" }}>
      <GlobalStiller />

      <YanMenu gorunum={gorunum} setGorunum={setGorunum} kullanici={kullanici} onCikis={() => setKullanici(null)} bugunSayisi={bugunHat.length} gecmisSayisi={gecmisHat.length} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <UstBar gorunum={gorunum} kullanici={kullanici} onHastaEkle={() => setModal("hastaEkle")} onIceriAktar={() => setModal("iceriAktar")} hastaArama={hastaArama} setHastaArama={setHastaArama} />
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", animation: "yukariCik .3s ease" }}>
          {yukleniyor ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 40, height: 40, border: "3px solid #e4ddd5", borderTopColor: "#1a1a2e", borderRadius: "50%", animation: "don 1s linear infinite", margin: "0 auto 16px" }} />
                <div style={{ color: "#9b8f88", fontSize: 14 }}>Veriler yükleniyor…</div>
              </div>
            </div>
          ) : (
            <>
              {gorunum === "panel"     && <Panel hastalar={hastalar} tedaviler={tedaviler} hatirlaticilar={hatirlaticilar} hastaHaritasi={hastaHaritasi} bugunHat={bugunHat} gecmisHat={gecmisHat} gelecekHat={gelecekHat} tamamlananHat={tamamlananHat} toplamGelir={toplamGelir} aylikGelir={aylikGelir} tamamlaIsaretle={tamamlaIsaretle} setGorunum={setGorunum} setHatTab={setHatTab} />}
              {gorunum === "hastalar"  && <HastaListesi hastalar={filtreliHastalar} tedaviler={tedaviler} hatirlaticilar={hatirlaticilar} onSec={h => { setSeciliHasta(h); setModal("profil"); }} />}
              {gorunum === "hatirlaticilar" && <HatirlaticiPanosu hatirlaticilar={filtreliHatirlaticilar} tumHatirlaticilar={hatirlaticilar} hastaHaritasi={hastaHaritasi} hatTab={hatTab} setHatTab={setHatTab} filtreIslem={filtreIslem} setFiltreIslem={setFiltreIslem} filtrePersonel={filtrePersonel} setFiltrePersonel={setFiltrePersonel} tamamlaIsaretle={tamamlaIsaretle} bekleyeAl={bekleyeAl} personelAta={personelAta} waGonderildiIsaretle={waGonderildiIsaretle} bugunHat={bugunHat} gecmisHat={gecmisHat} gelecekHat={gelecekHat} kullanici={kullanici} />}
              {gorunum === "analitik"  && <Analitik hastalar={hastalar} tedaviler={tedaviler} hatirlaticilar={hatirlaticilar} tamamlananHat={tamamlananHat} toplamGelir={toplamGelir} aylikGelir={aylikGelir} />}
              {gorunum === "ozet"      && <OzetPaneli hastalar={hastalar} hatirlaticilar={hatirlaticilar} hastaHaritasi={hastaHaritasi} bugunHat={bugunHat} gecmisHat={gecmisHat} bildirimGoster={bildirimGoster} />}
            </>
          )}
        </div>
      </div>

      {bildirim && <Bildirim {...bildirim} />}

      {modal === "hastaEkle" && <HastaEkleModal onKapat={() => setModal(null)} onKaydet={hastaEkle} />}
      {modal === "iceriAktar" && <IceriAktarModal onKapat={() => setModal(null)} onAktar={csv => { csvIceriAktar(csv); setModal(null); }} />}
      {modal === "profil" && seciliHasta && (
        <ProfilModal
          hasta={seciliHasta}
          tedaviler={tedaviler.filter(t => t.hastaId === seciliHasta.id)}
          hatirlaticilar={hatirlaticilar.filter(r => r.hastaId === seciliHasta.id)}
          onKapat={() => { setModal(null); setSeciliHasta(null); }}
          onTedaviEkle={v => tedaviEkle(seciliHasta.id, v)}
          onSil={() => hastaSil(seciliHasta.id)}
          onNotlarGuncelle={n => hastaGuncelle(seciliHasta.id, { notlar: n })}
          tamamlaIsaretle={tamamlaIsaretle} bekleyeAl={bekleyeAl}
          kullanici={kullanici} bildirimGoster={bildirimGoster}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   GLOBAL STİLLER
═══════════════════════════════════════════ */
function GlobalStiller() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #d6cfc6; border-radius: 4px; }
      input, select, textarea { font-family: inherit; outline: none; }
      input:focus, select:focus, textarea:focus { border-color: #1a1a2e !important; box-shadow: 0 0 0 3px rgba(26,26,46,.07) !important; }
      @keyframes yukariCik { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes don { to { transform: rotate(360deg); } }
      @keyframes soldan { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes yukarisol { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .satir:hover { background: #f1ede8 !important; cursor: pointer; }
      .btn { cursor: pointer; transition: all .15s; border: none; border-radius: 9px; font-family: inherit; font-weight: 500; }
      .btn:hover { filter: brightness(.94); }
      .btn:active { transform: scale(.97); }
      .kart { background: #fff; border-radius: 14px; border: 1px solid #ece7e0; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
      .nav { transition: all .18s; cursor: pointer; border-radius: 10px; padding: 10px 12px; display: flex; align-items: center; gap: 9px; font-size: 14px; color: #78706a; }
      .nav:hover { background: #f1ede8; color: #1a1a2e; }
      .nav.aktif { background: #1a1a2e; color: #fff; }
      .giris { background: #f8f6f3; border: 1.5px solid #e4ddd5; border-radius: 9px; padding: 9px 13px; font-size: 14px; color: #1a1a2e; width: 100%; transition: all .2s; }
      .etiket { border-radius: 6px; padding: 2px 9px; font-size: 11px; font-weight: 600; letter-spacing: .4px; display: inline-block; }
      .mono { font-family: 'JetBrains Mono', monospace; }
    `}</style>
  );
}

/* ═══════════════════════════════════════════
   GİRİŞ EKRANI
═══════════════════════════════════════════ */
function GirisEkrani({ onGiris, bildirim }) {
  const [adim,    setAdim]    = useState("sec");
  const [secilen, setSecilen] = useState(null);
  const [pin,     setPin]     = useState("");
  const [hata,    setHata]    = useState("");

  const girisYap = () => {
    if (PERSONEL_PINLER[secilen] === pin) {
      onGiris({ isim: secilen, rol: PERSONEL_ROLLER[secilen] || "personel" });
    } else {
      setHata("Hatalı PIN"); setPin("");
    }
  };

  return (
    <div style={{ height: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Outfit',sans-serif" }}>
      <GlobalStiller />
      <div style={{ width: 420, background: "#fff", borderRadius: 20, padding: 40, boxShadow: "0 32px 80px rgba(0,0,0,.35)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, background: "#1a1a2e", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 16px" }}>💎</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#1a1a2e", letterSpacing: -.5 }}>Klinik CRM <span style={{ color: "#e11d48", fontStyle: "italic" }}>Pro</span></div>
          <div style={{ fontSize: 13, color: "#9b8f88", marginTop: 4 }}>Personel Girişi · Güvenli Erişim</div>
        </div>
        {adim === "sec" ? (
          <>
            <div style={{ fontSize: 13, color: "#78706a", marginBottom: 12, fontWeight: 500 }}>Profilinizi seçin</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.keys(PERSONEL_PINLER).map(isim => (
                <button key={isim} className="btn" onClick={() => { setSecilen(isim); setAdim("pin"); setHata(""); }}
                  style={{ background: "#f8f6f3", color: "#1a1a2e", padding: "12px 16px", textAlign: "left", fontSize: 14, display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar isim={isim} boyut={32} />
                  <span style={{ flex: 1 }}>{isim}</span>
                  <span style={{ fontSize: 11, color: "#b0a89e", background: "#ece7e0", padding: "2px 8px", borderRadius: 6 }}>{PERSONEL_ROLLER[isim]}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => { setAdim("sec"); setSecilen(null); setPin(""); setHata(""); }} style={{ background: "none", border: "none", color: "#9b8f88", cursor: "pointer", fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 4 }}>← Geri</button>
            <div style={{ fontSize: 14, color: "#78706a", marginBottom: 6 }}><strong style={{ color: "#1a1a2e" }}>{secilen}</strong> için PIN</div>
            <input className="giris" type="password" maxLength={6} value={pin} onChange={e => { setPin(e.target.value); setHata(""); }} placeholder="PIN giriniz" onKeyDown={e => e.key === "Enter" && girisYap()} autoFocus style={{ marginBottom: 8, fontSize: 20, letterSpacing: 8, textAlign: "center" }} />
            {hata && <div style={{ color: "#e11d48", fontSize: 13, marginBottom: 8 }}>{hata}</div>}
            <Btn onClick={girisYap} koyu style={{ width: "100%", padding: 13, fontSize: 15, fontWeight: 600, marginTop: 4 }}>Giriş Yap →</Btn>
            <div style={{ fontSize: 11, color: "#b0a89e", textAlign: "center", marginTop: 12 }}>Demo PIN'ler: 1234 · 2345 · 3456 · 4567</div>
          </>
        )}
      </div>
      {bildirim && <Bildirim {...bildirim} />}
    </div>
  );
}

/* ═══════════════════════════════════════════
   YAN MENÜ
═══════════════════════════════════════════ */
function YanMenu({ gorunum, setGorunum, kullanici, onCikis, bugunSayisi, gecmisSayisi }) {
  const menuler = [
    { k: "panel",          ikon: "⬡", etiket: "Panel" },
    { k: "hastalar",       ikon: "◎", etiket: "Hastalar" },
    { k: "hatirlaticilar", ikon: "◷", etiket: "Hatırlatıcılar" },
    { k: "analitik",       ikon: "▦", etiket: "Analitik" },
    { k: "ozet",           ikon: "✉", etiket: "AI Günlük Özet" },
  ];
  const rozet = gecmisSayisi > 0 ? gecmisSayisi : bugunSayisi;
  const rozetRenk = gecmisSayisi > 0 ? "#e11d48" : "#d97706";

  return (
    <div style={{ width: 210, background: "#1a1a2e", display: "flex", flexDirection: "column", padding: "18px 10px", gap: 2, flexShrink: 0 }}>
      <div style={{ padding: "8px 12px 20px", marginBottom: 4 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#4a4a6a", fontWeight: 500, marginBottom: 3 }}>Klinik</div>
        <div style={{ fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: -.5 }}>CRM <span style={{ color: "#e11d48", fontStyle: "italic" }}>Pro</span></div>
      </div>
      {menuler.map(m => (
        <div key={m.k} className={`nav ${gorunum === m.k ? "aktif" : ""}`} onClick={() => setGorunum(m.k)}>
          <span style={{ fontSize: 15, opacity: gorunum === m.k ? 1 : .7 }}>{m.ikon}</span>
          <span style={{ flex: 1 }}>{m.etiket}</span>
          {m.k === "hatirlaticilar" && rozet > 0 && (
            <span style={{ background: rozetRenk, color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }} className="mono">{rozet}</span>
          )}
        </div>
      ))}
      <div style={{ marginTop: "auto", borderTop: "1px solid #2d2d4e", paddingTop: 14 }}>
        <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar isim={kullanici.isim} boyut={30} />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kullanici.isim.split(" ")[1] || kullanici.isim}</div>
            <div style={{ fontSize: 10, color: "#4a4a6a", textTransform: "uppercase", letterSpacing: 1 }}>{kullanici.rol}</div>
          </div>
        </div>
        <button className="btn" onClick={onCikis} style={{ width: "100%", background: "rgba(255,255,255,.06)", color: "#9b9bbb", padding: "8px 12px", fontSize: 12, textAlign: "left", marginTop: 4 }}>⇤ Çıkış Yap</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ÜST BAR
═══════════════════════════════════════════ */
function UstBar({ gorunum, onHastaEkle, onIceriAktar, hastaArama, setHastaArama }) {
  const basliklar = { panel: "Panel", hastalar: "Hasta Kayıtları", hatirlaticilar: "Hatırlatıcı Görevler", analitik: "Analitik", ozet: "AI Günlük Özet" };
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #ece7e0", padding: "0 28px", height: 58, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", flex: 1 }}>{basliklar[gorunum]}</div>
      {gorunum === "hastalar" && <>
        <input className="giris" value={hastaArama} onChange={e => setHastaArama(e.target.value)} placeholder="İsim, telefon veya ID ile ara…" style={{ width: 260, padding: "7px 13px" }} />
        <Btn onClick={onIceriAktar} style={{ background: "#f1ede8", color: "#5a4a3a", padding: "7px 16px", fontSize: 13 }}>⬆ CSV İçe Aktar</Btn>
        <Btn onClick={onHastaEkle} koyu style={{ padding: "7px 18px", fontSize: 13 }}>+ Yeni Hasta</Btn>
      </>}
      {gorunum === "hatirlaticilar" && <Btn onClick={onHastaEkle} koyu style={{ padding: "7px 18px", fontSize: 13 }}>+ Yeni Hasta</Btn>}
    </div>
  );
}

/* ═══════════════════════════════════════════
   PANEL (DASHBOARD)
═══════════════════════════════════════════ */
function Panel({ hastalar, tedaviler, hatirlaticilar, hastaHaritasi, bugunHat, gecmisHat, gelecekHat, tamamlananHat, toplamGelir, aylikGelir, tamamlaIsaretle, setGorunum, setHatTab }) {
  const istatistikler = [
    { etiket: "Bugünkü Aramalar",  deger: bugunHat.length,  renk: "#d97706", arkaplan: "#fffbeb", kenar: "#fde68a",  eylem: () => { setGorunum("hatirlaticilar"); setHatTab("bugun"); } },
    { etiket: "Geçmiş",           deger: gecmisHat.length, renk: "#e11d48", arkaplan: "#fff1f2", kenar: "#fecdd3",  eylem: () => { setGorunum("hatirlaticilar"); setHatTab("gecmis"); } },
    { etiket: "Yaklaşan (30 gün)",deger: gelecekHat.filter(r => gunFarki(r.sonTarih) <= 30).length, renk: "#2563eb", arkaplan: "#eff6ff", kenar: "#bfdbfe", eylem: () => { setGorunum("hatirlaticilar"); setHatTab("gelecek"); } },
    { etiket: "Tamamlanan",       deger: tamamlananHat.length, renk: "#059669", arkaplan: "#f0fdf4", kenar: "#a7f3d0", eylem: null },
    { etiket: "Toplam Hasta",     deger: hastalar.length,  renk: "#7c3aed", arkaplan: "#faf5ff", kenar: "#ddd6fe",  eylem: () => setGorunum("hastalar") },
    { etiket: "Bu Ay Gelir",      deger: `₺${aylikGelir.toLocaleString("tr-TR")}`, renk: "#0369a1", arkaplan: "#f0f9ff", kenar: "#bae6fd", eylem: () => setGorunum("analitik") },
  ];

  const acilList = [...gecmisHat, ...bugunHat].slice(0, 8);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {istatistikler.map(s => <IstatistikKarti key={s.etiket} {...s} onClick={s.eylem} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 18 }}>
        <div className="kart" style={{ padding: 20 }}>
          <BolumBasligi ikon={gecmisHat.length ? "🔴" : "📞"} baslik="Acil & Bugün" titreme={gecmisHat.length > 0} />
          {acilList.length === 0 ? <Bos metin="Harika! Acil hatırlatıcı yok." /> : acilList.map(r => {
            const h = hastaHaritasi[r.hastaId]; const g = gunFarki(r.sonTarih);
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#f8f6f3", borderRadius: 10, border: "1px solid #ece7e0", marginBottom: 7 }}>
                <Avatar isim={h?.isim || "?"} boyut={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a2e" }}>{h?.isim}</div>
                  <div style={{ fontSize: 12, color: "#9b8f88" }}>{r.etiket} · <IslemEtiketi islem={r.islem} kucuk /></div>
                </div>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: g < 0 ? "#e11d48" : "#d97706" }}>{g < 0 ? `${Math.abs(g)}g gecikti` : "Bugün"}</span>
                <a href={`tel:${h?.telefon}`}><Btn kk koyu>📞</Btn></a>
                <a href={`https://wa.me/${h?.telefon?.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer"><Btn kk style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>💬</Btn></a>
                <Btn kk onClick={() => tamamlaIsaretle(r.id)} style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>✓</Btn>
              </div>
            );
          })}
        </div>
        <div className="kart" style={{ padding: 20 }}>
          <BolumBasligi ikon="🧴" baslik="Son Tedaviler" />
          {[...tedaviler].sort((a, b) => b.tarih.localeCompare(a.tarih)).slice(0, 8).map(t => {
            const h = hastaHaritasi[t.hastaId];
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #f1ede8" }}>
                <IslemEtiketi islem={t.islem} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a2e" }}>{h?.isim}</div>
                  <div style={{ fontSize: 11, color: "#9b8f88" }}>{tarihFmt(t.tarih)}</div>
                </div>
                {t.fiyat > 0 && <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>₺{t.fiyat.toLocaleString("tr-TR")}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   HASTA LİSTESİ
═══════════════════════════════════════════ */
function HastaListesi({ hastalar, tedaviler, hatirlaticilar, onSec }) {
  return (
    <div className="kart" style={{ overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f8f6f3", borderBottom: "1px solid #ece7e0" }}>
            {["Hasta ID", "İsim & Notlar", "Telefon", "Tedavi", "Bekleyen", "Son Ziyaret", ""].map(b => (
              <th key={b} style={{ padding: "11px 16px", textAlign: "left", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#9b8f88", fontWeight: 500 }}>{b}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hastalar.length === 0 && <tr><td colSpan={7} style={{ padding: 48, textAlign: "center", color: "#b0a89e", fontSize: 14 }}>Hasta bulunamadı</td></tr>}
          {hastalar.map(h => {
            const hTedavi = tedaviler.filter(t => t.hastaId === h.id);
            const hHat    = hatirlaticilar.filter(r => r.hastaId === h.id && r.durum === "pending");
            const sonTedavi = [...hTedavi].sort((a, b) => b.tarih.localeCompare(a.tarih))[0];
            return (
              <tr key={h.id} className="satir" style={{ borderBottom: "1px solid #f1ede8", transition: "background .1s" }} onClick={() => onSec(h)}>
                <td style={{ padding: "12px 16px" }}><span className="mono" style={{ fontSize: 11, color: "#9b8f88" }}>{h.id}</span></td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar isim={h.isim} boyut={34} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a2e" }}>{h.isim}</div>
                      {h.notlar && <div style={{ fontSize: 11, color: "#9b8f88" }}>{h.notlar.slice(0, 38)}{h.notlar.length > 38 ? "…" : ""}</div>}
                    </div>
                  </div>
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "#5a4a3a" }}>{h.telefon}</td>
                <td style={{ padding: "12px 16px" }}><span className="mono" style={{ fontWeight: 700, color: "#1a1a2e" }}>{hTedavi.length}</span></td>
                <td style={{ padding: "12px 16px" }}>
                  {hHat.length > 0
                    ? <span className="etiket" style={{ background: "#fff1f2", color: "#e11d48", border: "1px solid #fecdd3" }}>{hHat.length} bekliyor</span>
                    : <span style={{ color: "#b0a89e", fontSize: 12 }}>—</span>}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 12, color: "#9b8f88" }}>{sonTedavi ? tarihFmt(sonTedavi.tarih) : "Henüz yok"}</td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                    <a href={`tel:${h.telefon}`}><Btn kk koyu>📞</Btn></a>
                    <a href={`https://wa.me/${h.telefon.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer"><Btn kk style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>💬</Btn></a>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════
   HATIRLATICI PANOSU
═══════════════════════════════════════════ */
function HatirlaticiPanosu({ hatirlaticilar, tumHatirlaticilar, hastaHaritasi, hatTab, setHatTab, filtreIslem, setFiltreIslem, filtrePersonel, setFiltrePersonel, tamamlaIsaretle, bekleyeAl, personelAta, waGonderildiIsaretle, bugunHat, gecmisHat, gelecekHat }) {
  const sekmeler = [
    { k: "bugun",   etiket: "Bugün",    sayi: bugunHat.length,  renk: "#d97706" },
    { k: "gecmis",  etiket: "Geçmiş",   sayi: gecmisHat.length, renk: "#e11d48" },
    { k: "gelecek", etiket: "Yaklaşan", sayi: gelecekHat.length, renk: "#2563eb" },
    { k: "tumu",    etiket: "Tümü",     sayi: tumHatirlaticilar.length, renk: "#78706a" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 6, background: "#fff", borderRadius: 12, padding: 4, border: "1px solid #ece7e0", width: "fit-content" }}>
        {sekmeler.map(s => (
          <button key={s.k} className="btn" onClick={() => setHatTab(s.k)}
            style={{ background: hatTab === s.k ? "#1a1a2e" : "transparent", color: hatTab === s.k ? "#fff" : "#78706a", padding: "7px 16px", fontSize: 13, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            {s.etiket}
            <span className="mono" style={{ background: hatTab === s.k ? "rgba(255,255,255,.2)" : "#f1ede8", color: hatTab === s.k ? "#fff" : s.renk, borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>{s.sayi}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <select className="giris" value={filtreIslem} onChange={e => setFiltreIslem(e.target.value)} style={{ width: "auto" }}>
          <option value="Tümü">Tüm İşlemler</option>
          {ISLEMLER.map(p => <option key={p}>{p}</option>)}
        </select>
        <select className="giris" value={filtrePersonel} onChange={e => setFiltrePersonel(e.target.value)} style={{ width: "auto" }}>
          <option value="Tümü">Tüm Personel</option>
          {PERSONEL_LISTESI.map(s => <option key={s}>{s}</option>)}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#9b8f88" }}>{hatirlaticilar.length} hatırlatıcı</span>
      </div>
      <div className="kart" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8f6f3", borderBottom: "1px solid #ece7e0" }}>
              {["Hasta", "İşlem", "Hatırlatıcı", "Tarih", "Gün", "Atanan", "Durum", "İşlemler"].map(b => (
                <th key={b} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#9b8f88", fontWeight: 500 }}>{b}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hatirlaticilar.length === 0 && <tr><td colSpan={8} style={{ padding: 48, textAlign: "center", color: "#b0a89e", fontSize: 14 }}>Bu görünümde hatırlatıcı yok</td></tr>}
            {hatirlaticilar.map(r => {
              const h = hastaHaritasi[r.hastaId]; const g = gunFarki(r.sonTarih);
              const gecmis = r.durum === "pending" && g < 0;
              const bugunMu = r.durum === "pending" && g === 0;
              const tamamlandi = r.durum === "done";
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid #f1ede8", background: tamamlandi ? "#fafaf8" : gecmis ? "#fff8f8" : bugunMu ? "#fffbeb" : "#fff", opacity: tamamlandi ? .75 : 1 }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{h?.isim}</div>
                    <div className="mono" style={{ fontSize: 11, color: "#9b8f88" }}>{h?.telefon}</div>
                  </td>
                  <td style={{ padding: "10px 14px" }}><IslemEtiketi islem={r.islem} /></td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: "#5a4a3a", maxWidth: 150 }}>{r.etiket}</td>
                  <td style={{ padding: "10px 14px" }}><span className="mono" style={{ fontSize: 12 }}>{tarihKisa(r.sonTarih)}</span></td>
                  <td style={{ padding: "10px 14px" }}>
                    {!tamamlandi && <span className="mono" style={{ fontWeight: 700, fontSize: 13, color: g < 0 ? "#e11d48" : g === 0 ? "#d97706" : "#059669" }}>{g < 0 ? `-${Math.abs(g)}` : g === 0 ? "Bugün" : `+${g}`}</span>}
                    {tamamlandi && <span style={{ fontSize: 11, color: "#9b8f88" }}>✓ {tarihKisa(r.tamamlananTarih)}</span>}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <select style={{ background: "transparent", border: "none", fontSize: 12, color: "#5a4a3a", cursor: "pointer", fontFamily: "inherit", maxWidth: 130 }} value={r.atanan} onChange={e => personelAta(r.id, e.target.value)}>
                      {PERSONEL_LISTESI.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {tamamlandi  ? <span className="etiket" style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>Tamamlandı</span>
                    : gecmis     ? <span className="etiket" style={{ background: "#fff1f2", color: "#e11d48", border: "1px solid #fecdd3" }}>Geçmiş</span>
                    : bugunMu    ? <span className="etiket" style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a" }}>Bugün</span>
                    :              <span className="etiket" style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}>Yaklaşan</span>}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {!tamamlandi && <>
                        <a href={`tel:${h?.telefon}`}><Btn kk koyu>📞</Btn></a>
                        <a href={`https://wa.me/${h?.telefon?.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Merhaba ${h?.isim?.split(" ")[0]}, ${r.islem} tedaviniz için ${r.etiket} zamanı geldi. Randevu almak ister misiniz? 😊`)}`} target="_blank" rel="noreferrer" onClick={() => waGonderildiIsaretle(r.id)}>
                          <Btn kk style={{ background: r.waGonderildi ? "#e8f5e9" : "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>{r.waGonderildi ? "✓WA" : "💬WA"}</Btn>
                        </a>
                        <Btn kk onClick={() => tamamlaIsaretle(r.id)} style={{ background: "#1a1a2e", color: "#fff" }}>✓ Bitti</Btn>
                      </>}
                      {tamamlandi && <Btn kk onClick={() => bekleyeAl(r.id)} style={{ background: "#f1ede8", color: "#78706a" }}>↩ Geri Al</Btn>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ANALİTİK
═══════════════════════════════════════════ */
function Analitik({ hastalar, tedaviler, hatirlaticilar, tamamlananHat, toplamGelir, aylikGelir }) {
  const islemBazli = ISLEMLER.map(p => ({
    islem: p,
    sayi: tedaviler.filter(t => t.islem === p).length,
    gelir: tedaviler.filter(t => t.islem === p).reduce((s, t) => s + (t.fiyat || 0), 0),
  }));
  const oran = hatirlaticilar.length > 0 ? Math.round(tamamlananHat.length / hatirlaticilar.length * 100) : 0;

  const aylar = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const anahtar = d.toISOString().slice(0, 7);
    const etiket  = d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
    const gelir   = tedaviler.filter(t => t.tarih?.slice(0, 7) === anahtar).reduce((s, t) => s + (t.fiyat || 0), 0);
    const sayi    = tedaviler.filter(t => t.tarih?.slice(0, 7) === anahtar).length;
    aylar.push({ anahtar, etiket, gelir, sayi });
  }
  const maxGelir = Math.max(...aylar.map(a => a.gelir), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {[
          { etiket: "Toplam Gelir",    deger: `₺${toplamGelir.toLocaleString("tr-TR")}`, renk: "#0369a1" },
          { etiket: "Bu Ay",           deger: `₺${aylikGelir.toLocaleString("tr-TR")}`,  renk: "#059669" },
          { etiket: "Tamamlanma Oranı",deger: `%${oran}`,                                renk: "#7c3aed" },
          { etiket: "Hasta Başı Ort.", deger: hastalar.length > 0 ? `₺${Math.round(toplamGelir / hastalar.length).toLocaleString("tr-TR")}` : "—", renk: "#d97706" },
        ].map(k => (
          <div key={k.etiket} className="kart" style={{ padding: "18px 20px" }}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: k.renk }}>{k.deger}</div>
            <div style={{ fontSize: 12, color: "#9b8f88", marginTop: 4 }}>{k.etiket}</div>
          </div>
        ))}
      </div>
      <div className="kart" style={{ padding: 24 }}>
        <BolumBasligi ikon="📈" baslik="Aylık Gelir (Son 6 Ay)" />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 140, marginTop: 16 }}>
          {aylar.map(a => (
            <div key={a.anahtar} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span className="mono" style={{ fontSize: 10, color: "#9b8f88" }}>₺{Math.round(a.gelir / 1000)}B</span>
              <div style={{ width: "100%", background: "linear-gradient(to top,#1a1a2e,#4a4a6e)", borderRadius: "6px 6px 0 0", height: `${Math.max(a.gelir / maxGelir * 100, a.gelir > 0 ? 6 : 0)}px`, transition: "height .6s ease", position: "relative" }}>
                {a.sayi > 0 && <div style={{ position: "absolute", top: 4, left: 0, right: 0, textAlign: "center", fontSize: 10, color: "#fff" }}>{a.sayi}</div>}
              </div>
              <span style={{ fontSize: 10, color: "#9b8f88" }}>{a.etiket}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="kart" style={{ padding: 20 }}>
          <BolumBasligi ikon="⬡" baslik="İşlem Türüne Göre" />
          <div style={{ marginTop: 12 }}>
            {islemBazli.map(b => (
              <div key={b.islem} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <IslemEtiketi islem={b.islem} />
                  <div style={{ display: "flex", gap: 16 }}>
                    <span style={{ fontSize: 13, color: "#5a4a3a" }}>{b.sayi} işlem</span>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>₺{b.gelir.toLocaleString("tr-TR")}</span>
                  </div>
                </div>
                <div style={{ height: 7, background: "#f1ede8", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${tedaviler.length > 0 ? (b.sayi / tedaviler.length) * 100 : 0}%`, background: ISLEM_RENK[b.islem], borderRadius: 4, transition: "width .6s" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="kart" style={{ padding: 20 }}>
          <BolumBasligi ikon="✓" baslik="Hatırlatıcı Sağlığı" />
          <div style={{ marginTop: 12 }}>
            {[
              { etiket: "Toplam Hatırlatıcı", deger: hatirlaticilar.length, renk: "#78706a" },
              { etiket: "Tamamlanan",          deger: tamamlananHat.length, renk: "#059669" },
              { etiket: "Bekleyen",            deger: hatirlaticilar.filter(r => r.durum === "pending").length, renk: "#2563eb" },
              { etiket: "Geçmiş",              deger: hatirlaticilar.filter(r => r.durum === "pending" && gunFarki(r.sonTarih) < 0).length, renk: "#e11d48" },
              { etiket: "Tamamlanma Oranı",    deger: `%${oran}`, renk: "#7c3aed" },
            ].map(s => (
              <div key={s.etiket} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #f1ede8" }}>
                <span style={{ fontSize: 13, color: "#78706a" }}>{s.etiket}</span>
                <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: s.renk }}>{s.deger}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   AI GÜNLÜK ÖZET
═══════════════════════════════════════════ */
function OzetPaneli({ hastalar, hatirlaticilar, hastaHaritasi, bugunHat, gecmisHat, bildirimGoster }) {
  const [ozet,    setOzet]    = useState("");
  const [yukl,    setYukl]    = useState(false);
  const [kopyalandi, setKopyalandi] = useState(false);

  const baglamOlustur = () => {
    const acil = [...gecmisHat, ...bugunHat].map(r => {
      const h = hastaHaritasi[r.hastaId]; const g = gunFarki(r.sonTarih);
      return `- ${h?.isim} (${h?.telefon}) | ${r.islem} | ${r.etiket} | ${g < 0 ? `${Math.abs(g)} GÜN GECİKTİ` : "BUGÜN"} | Atanan: ${r.atanan}`;
    }).join("\n");
    return `Bugün: ${new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}

KLİNİK GÜNLÜK GÖREV BRİFİNGİ
================================
Geçmiş hatırlatıcılar: ${gecmisHat.length}
Bugün araması gereken: ${bugunHat.length}
Toplam aktif hasta: ${hastalar.length}

ACİL KONTAKTLAR:
${acil || "Hiç yok — harika bir gün!"}`;
  };

  const ozetOlustur = async () => {
    setYukl(true); setOzet("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `Sen profesyonel bir klinik koordinatör asistanısın. Estetik klinik personeli (Botox, Filler, Mezoterapi) için kısa, sıcak günlük brifing e-postaları yazıyorsun.
Formatı şu şekilde yap:
1. Bugünün tarihi ile sıcak bir selamlama
2. Kısa özet (2-3 cümle)
3. Öncelikli arama listesi (önce gecikenler)
4. Motive edici kapanış
300 kelimeden az tut. Türkçe yaz. Emoji kullan ama abartma.`,
          messages: [{ role: "user", content: `Bu veriye göre bugünün klinik brifing e-postasını yaz:\n\n${baglamOlustur()}` }],
        }),
      });
      const veri = await res.json();
      const metin = veri.content?.map(c => c.text || "").join("") || "Özet oluşturulamadı.";
      setOzet(metin);
    } catch (e) {
      setOzet("Hata oluştu. Lütfen tekrar deneyin.");
    }
    setYukl(false);
  };

  const kopyala = () => {
    navigator.clipboard.writeText(ozet);
    setKopyalandi(true); setTimeout(() => setKopyalandi(false), 2000);
    bildirimGoster("Panoya kopyalandı ✓");
  };

  const sablonlar = [
    { baslik: "Botox Takip",     mesaj: "Merhaba {İsim}, Botox tedavinizin takip zamanı geldi. Randevu almak ister misiniz? 😊" },
    { baslik: "Filler Kontrolü", mesaj: "Merhaba {İsim}, dolgu tedaviniz için kontrol zamanı! Sizi görmek isteriz." },
    { baslik: "Mezoterapi",      mesaj: "Merhaba {İsim}, mezoterapi booster seansınız için hatırlatma. Randevunuzu alalım mı?" },
    { baslik: "Genel Takip",     mesaj: "Merhaba {İsim}, tedavinizin takip zamanı geldi. Kliniğimizde sizi görmek isteriz!" },
  ];

  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="kart" style={{ padding: 24 }}>
        <BolumBasligi ikon="✉" baslik="AI Günlük Brifing" />
        <p style={{ fontSize: 14, color: "#78706a", marginTop: 8, lineHeight: 1.6 }}>Bugün kimi aramanız gerektiğini, gecikmişleri ve görev atamalarını gösteren — ekibinize göndermeye hazır — AI destekli günlük brifing e-postası oluşturun.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, margin: "18px 0" }}>
          {[
            { ikon: "🔴", etiket: "Geçmiş", deger: gecmisHat.length, renk: "#e11d48" },
            { ikon: "📞", etiket: "Bugün",  deger: bugunHat.length,  renk: "#d97706" },
            { ikon: "👥", etiket: "Hastalar",deger: hastalar.length, renk: "#7c3aed" },
          ].map(s => (
            <div key={s.etiket} style={{ background: "#f8f6f3", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>{s.ikon}</span>
              <div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: s.renk }}>{s.deger}</div>
                <div style={{ fontSize: 11, color: "#9b8f88" }}>{s.etiket}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={ozetOlustur} disabled={yukl}
            style={{ background: "#1a1a2e", color: "#fff", padding: "11px 24px", fontSize: 14, fontWeight: 600, opacity: yukl ? .7 : 1, display: "flex", alignItems: "center", gap: 8 }}>
            {yukl ? <><span style={{ width: 14, height: 14, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "don 1s linear infinite" }} /> Oluşturuluyor…</> : "✨ Brifing Oluştur"}
          </button>
          {ozet && <button className="btn" onClick={kopyala} style={{ background: "#f1ede8", color: "#5a4a3a", padding: "11px 20px", fontSize: 14 }}>{kopyalandi ? "✓ Kopyalandı" : "📋 Kopyala"}</button>}
        </div>
      </div>
      {ozet && (
        <div className="kart" style={{ padding: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#9b8f88", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 }}>Oluşturulan Brifing</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.8, color: "#1a1a2e", background: "#f8f6f3", borderRadius: 10, padding: "18px 20px", border: "1px solid #ece7e0", animation: "yukariCik .3s ease" }}>{ozet}</div>
        </div>
      )}
      <div className="kart" style={{ padding: 20 }}>
        <BolumBasligi ikon="💬" baslik="WhatsApp Mesaj Şablonları" />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {sablonlar.map(s => (
            <div key={s.baslik} style={{ background: "#f8f6f3", borderRadius: 10, padding: "12px 16px", border: "1px solid #ece7e0" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#1a1a2e", marginBottom: 4 }}>{s.baslik}</div>
              <div style={{ fontSize: 13, color: "#78706a", marginBottom: 8 }}>{s.mesaj}</div>
              <button className="btn" onClick={() => { navigator.clipboard.writeText(s.mesaj); bildirimGoster("Şablon kopyalandı!"); }}
                style={{ background: "#1a1a2e", color: "#fff", padding: "5px 12px", fontSize: 12 }}>Kopyala</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   PROFİL MODALİ
═══════════════════════════════════════════ */
function ProfilModal({ hasta, tedaviler, hatirlaticilar, onKapat, onTedaviEkle, onSil, onNotlarGuncelle, tamamlaIsaretle, bekleyeAl, kullanici, bildirimGoster }) {
  const [notlar,   setNotlar]   = useState(hasta.notlar || "");
  const [tedaviEk, setTedaviEk] = useState(false);
  const [txForm,   setTxForm]   = useState({ islem: "Botox", tarih: bugun(), fiyat: "", notlar: "" });
  const [kaydedildi, setKaydedildi] = useState(false);

  const notlarKaydet = () => { onNotlarGuncelle(notlar); setKaydedildi(true); setTimeout(() => setKaydedildi(false), 1500); };
  const tedaviKaydet = () => {
    if (!txForm.tarih) return;
    onTedaviEkle(txForm);
    setTedaviEk(false);
    setTxForm({ islem: "Botox", tarih: bugun(), fiyat: "", notlar: "" });
  };

  const bekleyenHat  = hatirlaticilar.filter(r => r.durum === "pending").sort((a, b) => a.sonTarih.localeCompare(b.sonTarih));
  const tamamlHat    = hatirlaticilar.filter(r => r.durum === "done");
  const toplamHarcama = tedaviler.reduce((s, t) => s + (t.fiyat || 0), 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 16px", backdropFilter: "blur(4px)", overflowY: "auto" }} onClick={onKapat}>
      <div style={{ background: "#fff", borderRadius: 20, width: 900, maxWidth: "100%", boxShadow: "0 32px 80px rgba(0,0,0,.25)", animation: "yukariCik .25s ease", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ background: "#1a1a2e", padding: "24px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar isim={hasta.isim} boyut={48} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{hasta.isim}</div>
              <div className="mono" style={{ fontSize: 12, color: "#9b9bbb" }}>ID: {hasta.id} · Kayıt: {tarihFmt(hasta.olusturuldu)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a href={`tel:${hasta.telefon}`}><Btn style={{ background: "rgba(255,255,255,.12)", color: "#fff" }}>📞 {hasta.telefon}</Btn></a>
            <a href={`https://wa.me/${hasta.telefon.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer"><Btn style={{ background: "#059669", color: "#fff" }}>💬 WhatsApp</Btn></a>
            {!tedaviEk && <Btn onClick={() => setTedaviEk(true)} style={{ background: "#e11d48", color: "#fff" }}>+ Tedavi</Btn>}
            <button onClick={onKapat} style={{ background: "none", border: "none", color: "#9b9bbb", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
        </div>
        <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              {[{ etiket: "Tedavi", deger: tedaviler.length, renk: "#7c3aed" }, { etiket: "Bekleyen", deger: bekleyenHat.length, renk: "#e11d48" }, { etiket: "Harcama", deger: `₺${toplamHarcama.toLocaleString("tr-TR")}`, renk: "#059669" }].map(s => (
                <div key={s.etiket} style={{ background: "#f8f6f3", borderRadius: 10, padding: 12, textAlign: "center" }}>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: s.renk }}>{s.deger}</div>
                  <div style={{ fontSize: 11, color: "#9b8f88" }}>{s.etiket}</div>
                </div>
              ))}
            </div>
            {tedaviEk && (
              <div style={{ background: "#f8f6f3", borderRadius: 12, padding: 16, border: "2px solid #1a1a2e" }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Yeni Tedavi Ekle</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <select className="giris" value={txForm.islem} onChange={e => setTxForm(f => ({ ...f, islem: e.target.value }))}>
                    {ISLEMLER.map(p => <option key={p}>{p}</option>)}
                  </select>
                  <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400e" }}>🔔 {HATIRLATICI_KURALLARI[txForm.islem].length} hatırlatıcı otomatik oluşturulacak</div>
                  <input type="date" className="giris" value={txForm.tarih} onChange={e => setTxForm(f => ({ ...f, tarih: e.target.value }))} />
                  <input className="giris" type="number" placeholder="Ücret (₺)" value={txForm.fiyat} onChange={e => setTxForm(f => ({ ...f, fiyat: e.target.value }))} />
                  <textarea className="giris" rows={2} placeholder="Notlar…" value={txForm.notlar} onChange={e => setTxForm(f => ({ ...f, notlar: e.target.value }))} style={{ resize: "none" }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn onClick={() => setTedaviEk(false)} style={{ background: "#f1ede8", color: "#78706a", flex: 1 }}>İptal</Btn>
                    <Btn onClick={tedaviKaydet} koyu style={{ flex: 2 }}>Tedaviyi Kaydet</Btn>
                  </div>
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 6, fontWeight: 500, letterSpacing: .5, textTransform: "uppercase" }}>Klinik Notları</div>
              <textarea className="giris" rows={4} value={notlar} onChange={e => setNotlar(e.target.value)} placeholder="Alerjiler, tercihler, gözlemler…" style={{ resize: "vertical" }} />
              <Btn onClick={notlarKaydet} koyu style={{ width: "100%", marginTop: 8, background: kaydedildi ? "#059669" : "#1a1a2e" }}>{kaydedildi ? "✓ Kaydedildi" : "Notları Kaydet"}</Btn>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 8, fontWeight: 500, letterSpacing: .5, textTransform: "uppercase" }}>Tedavi Geçmişi</div>
              {tedaviler.length === 0 ? <Bos metin="Henüz tedavi yok" /> :
                [...tedaviler].sort((a, b) => b.tarih.localeCompare(a.tarih)).map(t => (
                  <div key={t.id} style={{ background: "#f8f6f3", borderRadius: 8, padding: "10px 12px", marginBottom: 7, border: "1px solid #ece7e0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <IslemEtiketi islem={t.islem} />
                      <span style={{ fontSize: 12, color: "#9b8f88" }}>{tarihFmt(t.tarih)}</span>
                      {t.fiyat > 0 && <span className="mono" style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700 }}>₺{t.fiyat.toLocaleString("tr-TR")}</span>}
                    </div>
                    {t.notlar && <div style={{ fontSize: 12, color: "#78706a" }}>{t.notlar}</div>}
                    <div className="mono" style={{ fontSize: 10, color: "#b0a89e", marginTop: 3 }}>TXN-{t.id}</div>
                  </div>
                ))
              }
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 8, fontWeight: 500, letterSpacing: .5, textTransform: "uppercase" }}>Yaklaşan Hatırlatıcılar</div>
              {bekleyenHat.length === 0 ? <Bos metin="Bekleyen hatırlatıcı yok 🎉" /> :
                bekleyenHat.map(r => {
                  const g = gunFarki(r.sonTarih);
                  return (
                    <div key={r.id} style={{ background: g < 0 ? "#fff8f8" : g === 0 ? "#fffbeb" : "#f8f6f3", borderRadius: 8, padding: "10px 12px", marginBottom: 6, border: `1px solid ${g < 0 ? "#fecdd3" : g === 0 ? "#fde68a" : "#ece7e0"}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <IslemEtiketi islem={r.islem} kucuk />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{r.etiket}</span>
                        <span className="mono" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: g < 0 ? "#e11d48" : g === 0 ? "#d97706" : "#059669" }}>
                          {g < 0 ? `${Math.abs(g)}g gecikti` : g === 0 ? "Bugün" : `${g} gün sonra`}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#9b8f88", marginBottom: 6 }}>{tarihFmt(r.sonTarih)}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <a href={`tel:${hasta.telefon}`}><Btn kk koyu>📞</Btn></a>
                        <a href={`https://wa.me/${hasta.telefon.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Merhaba ${hasta.isim.split(" ")[0]}, ${r.islem} için ${r.etiket} zamanı geldi!`)}`} target="_blank" rel="noreferrer">
                          <Btn kk style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>💬</Btn>
                        </a>
                        <Btn kk onClick={() => tamamlaIsaretle(r.id)} style={{ background: "#1a1a2e", color: "#fff", flex: 1 }}>✓ Tamamlandı</Btn>
                      </div>
                    </div>
                  );
                })
              }
            </div>
            {tamamlHat.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 8, fontWeight: 500, letterSpacing: .5, textTransform: "uppercase" }}>Tamamlananlar ({tamamlHat.length})</div>
                {tamamlHat.map(r => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "#f0fdf4", borderRadius: 7, border: "1px solid #a7f3d0", marginBottom: 5 }}>
                    <span style={{ color: "#059669", fontSize: 12 }}>✓</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#059669" }}>{r.etiket}</span>
                      <span style={{ fontSize: 11, color: "#9b8f88", marginLeft: 8 }}>{tarihKisa(r.tamamlananTarih)} · {r.tamamlayan}</span>
                    </div>
                    <button onClick={() => bekleyeAl(r.id)} style={{ background: "none", border: "none", color: "#9b8f88", cursor: "pointer", fontSize: 11 }}>↩</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {kullanici?.rol === "admin" && (
          <div style={{ padding: "0 24px 24px", display: "flex", justifyContent: "flex-end" }}>
            <button className="btn" onClick={onSil} style={{ background: "#fff1f2", color: "#e11d48", border: "1px solid #fecdd3", padding: "8px 18px", fontSize: 13 }}>🗑 Hastayı Sil</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   HASTA EKLE MODALİ
═══════════════════════════════════════════ */
function HastaEkleModal({ onKapat, onKaydet }) {
  const [f, setF] = useState({ isim: "", telefon: "", notlar: "" });
  return (
    <Modal onKapat={onKapat} baslik="Yeni Hasta Ekle">
      <Alan etiket="Ad Soyad *"><input className="giris" value={f.isim} onChange={e => setF(p => ({ ...p, isim: e.target.value }))} placeholder="Ayşe Yılmaz" autoFocus /></Alan>
      <Alan etiket="Telefon Numarası *"><input className="giris" value={f.telefon} onChange={e => setF(p => ({ ...p, telefon: e.target.value }))} placeholder="+90 532 000 0000" /></Alan>
      <Alan etiket="Notlar"><textarea className="giris" rows={3} value={f.notlar} onChange={e => setF(p => ({ ...p, notlar: e.target.value }))} placeholder="Alerji, tercih…" style={{ resize: "none" }} /></Alan>
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <Btn onClick={onKapat} style={{ flex: 1, background: "#f1ede8", color: "#78706a", padding: 11 }}>İptal</Btn>
        <Btn koyu onClick={() => { if (!f.isim || !f.telefon) return; if (onKaydet({ isim: f.isim, telefon: f.telefon, notlar: f.notlar })) onKapat(); }} style={{ flex: 2, padding: 11, fontWeight: 600 }}>Hastayı Ekle</Btn>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════
   İÇERİ AKTAR MODALİ
═══════════════════════════════════════════ */
function IceriAktarModal({ onKapat, onAktar }) {
  const [metin, setMetin] = useState("");
  const sablon = `isim,telefon,islem,tarih,fiyat,notlar\nAyşe Yılmaz,+90 532 000 0001,Botox,2026-03-15,1200,Alın\nFatma Kaya,+90 532 000 0002,Filler,2026-02-20,2200,Yanak`;
  return (
    <Modal onKapat={onKapat} baslik="CSV / Excel'den İçe Aktar">
      <p style={{ fontSize: 13, color: "#78706a", marginBottom: 12, lineHeight: 1.6 }}>Zorunlu: <code style={{ background: "#f1ede8", padding: "1px 5px", borderRadius: 4 }}>isim, telefon</code>. İsteğe bağlı: islem, tarih, fiyat, notlar</p>
      <div style={{ background: "#f8f6f3", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 11, color: "#9b8f88", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "pre-wrap", border: "1px dashed #d6cfc6" }}>{sablon}</div>
      <textarea className="giris" rows={9} value={metin} onChange={e => setMetin(e.target.value)} placeholder="CSV verisi buraya…" style={{ resize: "vertical", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }} />
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <Btn onClick={onKapat} style={{ flex: 1, background: "#f1ede8", color: "#78706a", padding: 11 }}>İptal</Btn>
        <Btn koyu onClick={() => { if (metin.trim()) onAktar(metin); }} style={{ flex: 2, padding: 11, fontWeight: 600 }}>⬆ İçe Aktar</Btn>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════
   ORTAK MİNİ BİLEŞENLER
═══════════════════════════════════════════ */
function IstatistikKarti({ etiket, deger, renk, arkaplan, kenar, onClick }) {
  return (
    <div className="kart" onClick={onClick} style={{ padding: "18px 20px", background: arkaplan, border: `1px solid ${kenar}`, cursor: onClick ? "pointer" : "default", transition: "transform .15s, box-shadow .15s" }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,.1)"; } }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
      <div className="mono" style={{ fontSize: 30, fontWeight: 800, color: renk, lineHeight: 1 }}>{deger}</div>
      <div style={{ fontSize: 12, color: "#78706a", marginTop: 5 }}>{etiket}</div>
    </div>
  );
}

function IslemEtiketi({ islem, kucuk }) {
  return <span className="etiket" style={{ background: ISLEM_BG[islem], color: ISLEM_RENK[islem], border: `1px solid ${ISLEM_RENK[islem]}30`, fontSize: kucuk ? 10 : 11 }}>{islem}</span>;
}

function Avatar({ isim, boyut = 36 }) {
  const renkler = ["#e11d48", "#2563eb", "#7c3aed", "#059669", "#d97706", "#0369a1"];
  const arkaplan = renkler[(isim?.charCodeAt(0) || 0) % renkler.length];
  return <div style={{ width: boyut, height: boyut, borderRadius: "50%", background: arkaplan, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: boyut * .38, flexShrink: 0 }}>{isim?.charAt(0)?.toUpperCase()}</div>;
}

function Btn({ children, onClick, koyu, kk, style = {}, ...rest }) {
  return <button className="btn" onClick={onClick} {...rest} style={{ background: koyu ? "#1a1a2e" : "#f1ede8", color: koyu ? "#fff" : "#5a4a3a", padding: kk ? "5px 10px" : "8px 16px", fontSize: kk ? 12 : 13, ...style }}>{children}</button>;
}

function Alan({ etiket, children }) {
  return <div style={{ marginBottom: 14 }}><div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 6, fontWeight: 500 }}>{etiket}</div>{children}</div>;
}

function Modal({ children, onKapat, baslik }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }} onClick={onKapat}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 28, width: 480, maxWidth: "95vw", animation: "yukariCik .25s ease", boxShadow: "0 24px 80px rgba(0,0,0,.25)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e", marginBottom: 20 }}>{baslik}</div>
        {children}
      </div>
    </div>
  );
}

function BolumBasligi({ ikon, baslik, titreme }) {
  return <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1a2e", display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
    <span style={{ animation: titreme ? "don 2s linear infinite" : "none" }}>{ikon}</span> {baslik}
  </div>;
}

function Bos({ metin }) {
  return <div style={{ textAlign: "center", padding: "24px 0", color: "#b0a89e", fontSize: 13, fontStyle: "italic" }}>{metin}</div>;
}

function Bildirim({ msg, tip }) {
  return <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 99999, background: tip === "uyari" ? "#7c0a02" : tip === "hata" ? "#450a0a" : "#1a2e1a", color: "#fff", borderRadius: 10, padding: "12px 20px", fontSize: 14, boxShadow: "0 8px 32px rgba(0,0,0,.25)", animation: "yukariCik .25s ease", maxWidth: 340 }}>{msg}</div>;
}