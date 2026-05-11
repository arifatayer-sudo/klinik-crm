import { useState, useEffect } from "react";
import { supabase } from "./supabase";

/* ══════════════════════════════════════════════════
   SABİTLER & YARDIMCILAR
══════════════════════════════════════════════════ */
const KLINIK_ADI = "Candemir Ceran Clinic";
const AUTH_EMAIL = "admin@ceranclinic.com";
const AUTH_ENABLED = false;

const VARSAYILAN_PERSONEL = [
  { id: "p1", isim: "Dr. Candemir Ceran", rol: "admin",    pin: "654321" },
  { id: "p2", isim: "Ari",               rol: "admin",    pin: "021994" },
  { id: "p3", isim: "Mehtap Kaboğlu",    rol: "personel", pin: "1818" },
  { id: "p4", isim: "Simge Gül",         rol: "personel", pin: "1414" },
  { id: "p5", isim: "Sümeyye",           rol: "personel", pin: "5555" },
];

const VARSAYILAN_ISLEMLER = [
  { id: "i1", isim: "Botox",      renk: "#2563eb", hatirlaticilar: [{ etiket: "2 Hafta Kontrolü", gun: 14 }, { etiket: "3 Ay Yenileme", gun: 90 }] },
  { id: "i2", isim: "Filler",     renk: "#db2777", hatirlaticilar: [{ etiket: "2 Hafta Kontrolü", gun: 14 }, { etiket: "3 Ay Rötuş", gun: 90 }, { etiket: "6 Ay İncelemesi", gun: 180 }] },
  { id: "i3", isim: "Mezoterapi", renk: "#059669", hatirlaticilar: [{ etiket: "2 Hafta Takibi", gun: 14 }, { etiket: "3 Ay Destekleyici", gun: 90 }] },
];

const VARSAYILAN_ULKE_KODU = "+90";
const EXCEL_ALANLARI = {
  isim: ["isim", "ad soyad", "adsoyad", "hasta", "hasta adı", "hasta adi", "name", "full name", "fullname"],
  telefon: ["telefon", "telefon numarası", "telefon numarasi", "tel", "gsm", "mobile", "phone"],
  islem: ["islem", "işlem", "procedure", "tedavi", "treatment"],
  tarih: ["tarih", "işlem tarihi", "islem tarihi", "tedavi tarihi", "date"],
  fiyat: ["fiyat", "ucret", "ücret", "price", "tutar"],
  notlar: ["notlar", "not", "notes", "açıklama", "aciklama", "açiklama", "acıklama"],
};

const uid      = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const bugun    = () => new Date().toISOString().slice(0, 10);
const gunEkle  = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const gunFarki = (s) => { const a = new Date(s); a.setHours(0,0,0,0); const b = new Date(); b.setHours(0,0,0,0); return Math.ceil((a - b) / 86400000); };
const tarihFmt  = (s) => s ? new Date(s).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const tarihKisa = (s) => s ? new Date(s).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }) : "—";
const anahtarNormaliz = (s) => String(s ?? "")
  .trim()
  .toLocaleLowerCase("tr-TR")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/ı/g, "i");
const telefonuBirlestir = (ulkeKodu = VARSAYILAN_ULKE_KODU, numara = "") => {
  const kod = String(ulkeKodu || VARSAYILAN_ULKE_KODU).trim();
  const temizNumara = String(numara || "").replace(/\s+/g, " ").trim();
  return `${kod}${temizNumara ? ` ${temizNumara}` : ""}`.trim();
};
const telefonuParcala = (telefon = "") => {
  const temiz = String(telefon ?? "").trim().replace(/\s+/g, " ").replace(/^00/, "+");
  if (!temiz) return { ulkeKodu: VARSAYILAN_ULKE_KODU, numara: "" };
  const eslesme = temiz.match(/^(\+\d{1,4})(?:\s*)(.*)$/);
  return eslesme
    ? { ulkeKodu: eslesme[1], numara: eslesme[2].trim() }
    : { ulkeKodu: VARSAYILAN_ULKE_KODU, numara: temiz.replace(/^\+/, "") };
};
const telefonuNormalizeEt = (telefon, varsayilanKod = VARSAYILAN_ULKE_KODU) => {
  const temiz = String(telefon ?? "").trim().replace(/\s+/g, " ").replace(/^00/, "+");
  if (!temiz) return "";
  const eslesme = temiz.match(/^(\+\d{1,4})(?:\s*)(.*)$/);
  return eslesme ? telefonuBirlestir(eslesme[1], eslesme[2]) : telefonuBirlestir(varsayilanKod, temiz.replace(/^\+/, ""));
};
const telefonAnahtari = (telefon) => telefonuNormalizeEt(telefon).replace(/[^\d+]/g, "");
const adaGoreSirala = (liste) => [...liste].sort((a, b) => (a.isim || "").localeCompare(b.isim || "", "tr-TR", { sensitivity: "base" }));
const alanDegeriBul = (satir, adaylar) => {
  const kayitlar = Object.entries(satir || {});
  for (const aday of adaylar) {
    const hedef = anahtarNormaliz(aday);
    const bulunan = kayitlar.find(([anahtar]) => anahtarNormaliz(anahtar) === hedef);
    if (bulunan && String(bulunan[1] ?? "").trim()) return bulunan[1];
  }
  return "";
};
const excelTarihiniNormalizeEt = (deger) => {
  if (!deger) return "";
  if (deger instanceof Date && !Number.isNaN(deger.getTime())) return deger.toISOString().slice(0, 10);
  const metin = String(deger).trim();
  if (!metin) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(metin)) return metin;
  const parcalar = metin.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (parcalar) {
    let [, gun, ay, yil] = parcalar;
    if (yil.length === 2) yil = `20${yil}`;
    return `${yil.padStart(4, "0")}-${ay.padStart(2, "0")}-${gun.padStart(2, "0")}`;
  }
  const tarih = new Date(metin);
  return Number.isNaN(tarih.getTime()) ? "" : tarih.toISOString().slice(0, 10);
};
const lsAl      = (k, v) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : v; } catch { return v; } };
const lsKaydet  = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const paraFmt   = (n) => `₺${Number(n || 0).toLocaleString("tr-TR")}`;
const CSV_IMPORT_LIMIT = 9999;
const COP_KUTUSU_GUN = 45;
const SUPABASE_PAGE_SIZE = 1000;
const TABLES = {
  patients: "patients",
  treatments: "treatments",
  reminders: "reminders",
  settings: "app_settings",
};
const supabaseTumKayitlar = async (table, orderColumn, ascending = false) => {
  const kayitlar = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderColumn, { ascending })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;
    kayitlar.push(...(data || []));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }
  return kayitlar;
};

/* ══════════════════════════════════════════════════
   ANA UYGULAMA
══════════════════════════════════════════════════ */
export default function App() {
  const [hastalar,        setHastalar]        = useState([]);
  const [tedaviler,       setTedaviler]       = useState([]);
  const [hatirlaticilar,  setHatirlaticilar]  = useState([]);
  const [iletisimLog,     setIletisimLog]     = useState(() => lsAl("klinik_log", []));
  const [yukleniyor,      setYukleniyor]      = useState(true);
  const [personelListesi, setPersonelListesi] = useState(() => lsAl("klinik_personel", VARSAYILAN_PERSONEL));
  const [islemListesi,    setIslemListesi]    = useState(() => lsAl("klinik_islemler",  VARSAYILAN_ISLEMLER));
  const [kullanici,       setKullanici]       = useState(() => lsAl("klinik_oturum",   null));
  const [authSession,     setAuthSession]     = useState(null);
  const [authHazir,       setAuthHazir]       = useState(false);
  const [ayarlarHazir,    setAyarlarHazir]    = useState(false);
  const [gorunum,         setGorunum]         = useState("panel");
  const [modal,           setModal]           = useState(null);
  const [seciliHasta,     setSeciliHasta]     = useState(null);
  const [profilTedaviAc,  setProfilTedaviAc]  = useState(false);
  const [bildirim,        setBildirim]        = useState(null);
  const [hatTab,          setHatTab]          = useState("bugun");
  const [hastaArama,      setHastaArama]      = useState("");
  const [filtreIslem,     setFiltreIslem]     = useState("Tümü");
  const [filtrePersonel,  setFiltrePersonel]  = useState("Tümü");
  const [menuAcik,        setMenuAcik]        = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const medya = window.matchMedia("(max-width: 900px)");
    const mobildeKapat = (olay) => { if (olay.matches) setMenuAcik(false); };
    if (medya.matches) setMenuAcik(false);
    if (medya.addEventListener) {
      medya.addEventListener("change", mobildeKapat);
      return () => medya.removeEventListener("change", mobildeKapat);
    }
    medya.addListener(mobildeKapat);
    return () => medya.removeListener(mobildeKapat);
  }, []);

  const bildirimGoster = (msg, tip = "tamam") => { setBildirim({ msg, tip }); setTimeout(() => setBildirim(null), 3200); };
  const isAdmin = kullanici?.rol === "admin";

  useEffect(() => {
    if (!AUTH_ENABLED) {
      setAuthHazir(true);
      return;
    }
    let aktif = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!aktif) return;
      setAuthSession(data.session || null);
      setAuthHazir(true);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session || null);
      setAuthHazir(true);
      if (!session) {
        setKullanici(null);
        lsKaydet("klinik_oturum", null);
      }
    });
    return () => {
      aktif = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const ayarKaydet = async (key, value) => {
    const { error } = await supabase.from(TABLES.settings).upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) bildirimGoster("Ayar buluta kaydedilemedi: " + error.message, "uyari");
  };
  const personelGuncelle = (l) => { setPersonelListesi(l); lsKaydet("klinik_personel", l); ayarKaydet("personel", l); };
  const islemGuncelle    = (l) => { setIslemListesi(l);    lsKaydet("klinik_islemler",  l); ayarKaydet("islemler", l); };
  const oturumAc         = (u) => { setKullanici(u);       lsKaydet("klinik_oturum",    u); };
  const authGiris = async (email, sifre) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: sifre });
    if (error) {
      bildirimGoster("E-posta veya şifre hatalı", "hata");
      return false;
    }
    return true;
  };
  const oturumKapat = async () => {
    setKullanici(null);
    lsKaydet("klinik_oturum", null);
    await supabase.auth.signOut();
    setAuthSession(null);
  };

  const iletisimKaydet = (hastaId, hastaIsim, yontem, personelIsim, etiket) => {
    const log = { id: uid(), hastaId, hastaIsim, yontem, personel: personelIsim, etiket, tarih: bugun(), saat: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) };
    setIletisimLog(prev => { const y = [log, ...prev].slice(0, 500); lsKaydet("klinik_log", y); return y; });
  };

  useEffect(() => {
    if (AUTH_ENABLED && !authSession) {
      setAyarlarHazir(false);
      return;
    }
    let iptal = false;
    const ayarlariYukle = async () => {
      const { data, error } = await supabase.from(TABLES.settings).select("key,value").in("key", ["personel", "islemler"]);
      if (!iptal && !error && data) {
        const uzakPersonel = data.find(x => x.key === "personel")?.value;
        const uzakIslemler = data.find(x => x.key === "islemler")?.value;
        if (Array.isArray(uzakPersonel) && uzakPersonel.length) { setPersonelListesi(uzakPersonel); lsKaydet("klinik_personel", uzakPersonel); }
        if (Array.isArray(uzakIslemler) && uzakIslemler.length) { setIslemListesi(uzakIslemler); lsKaydet("klinik_islemler", uzakIslemler); }
      }
      if (!iptal) setAyarlarHazir(true);
    };
    ayarlariYukle();
    const kanal = supabase.channel(`${TABLES.settings}_ch`).on("postgres_changes", { event: "*", schema: "public", table: TABLES.settings }, ayarlariYukle).subscribe();
    return () => { iptal = true; supabase.removeChannel(kanal); };
  }, [authSession]);

  /* ── Supabase ── */
  useEffect(() => {
    if ((AUTH_ENABLED && !authSession) || !kullanici) return;
    const yukle = async () => {
      setYukleniyor(true);
      try {
        const [h, t, r] = await Promise.all([
          supabaseTumKayitlar(TABLES.patients, "created_at", false),
          supabaseTumKayitlar(TABLES.treatments, "date", false),
          supabaseTumKayitlar(TABLES.reminders, "due_date", true),
        ]);
        const zamanAsimi = Date.now() - COP_KUTUSU_GUN * 86400000;
        const suresiDolan = h.filter(x => x.deleted_at && new Date(x.deleted_at).getTime() < zamanAsimi).map(x => x.id);
        if (suresiDolan.length) await supabase.from(TABLES.patients).delete().in("id", suresiDolan);
        setHastalar(h.filter(x => !suresiDolan.includes(x.id)).map(mH));
        setTedaviler(t.map(mT));
        setHatirlaticilar(r.map(mR));
      } catch (error) {
        bildirimGoster("Veriler yüklenemedi: " + error.message, "hata");
      }
      setYukleniyor(false);
    };
    yukle();
    const kH = supabase.channel("ch_p").on("postgres_changes", { event: "*", schema: "public", table: TABLES.patients   }, yukle).subscribe();
    const kT = supabase.channel("ch_t").on("postgres_changes", { event: "*", schema: "public", table: TABLES.treatments }, yukle).subscribe();
    const kR = supabase.channel("ch_r").on("postgres_changes", { event: "*", schema: "public", table: TABLES.reminders  }, yukle).subscribe();
    return () => { supabase.removeChannel(kH); supabase.removeChannel(kT); supabase.removeChannel(kR); };
  }, [authSession, kullanici]);

  const mH = (r) => ({ id: r.id, isim: r.name, telefon: r.phone, notlar: r.notes || "", olusturuldu: r.created_at, silinmeTarihi: r.deleted_at || null });
  const mT = (r) => ({ id: r.id, hastaId: r.patient_id, islem: r.procedure, tarih: r.date, fiyat: Number(r.price) || 0, notlar: r.notes || "", personel: r.personel || "", upsales: r.upsales || false, upsalesIslem: r.upsales_islem || "", upsalesFiyat: Number(r.upsales_fiyat) || 0 });
  const mR = (r) => ({ id: r.id, tedaviId: r.treatment_id, hastaId: r.patient_id, islem: r.procedure, etiket: r.label, sonTarih: r.due_date, durum: r.status, atanan: r.assigned_to, tamamlananTarih: r.completed_at, tamamlayan: r.completed_by, waGonderildi: r.wa_sent });
  const hatirlaticiTaslagiOlustur = (tedaviId, hastaId, veri, atanan = "Atanmamış") => {
    const islemBilgi = islemListesi.find(i => i.isim === veri.islem);
    const hatKurallari = veri.ozelHatirlaticilar || islemBilgi?.hatirlaticilar || [];
    return hatKurallari.map(k => ({
      id: uid(),
      treatment_id: tedaviId,
      patient_id: hastaId,
      procedure: veri.islem,
      label: k.etiket,
      due_date: gunEkle(veri.tarih, k.gun),
      status: "pending",
      assigned_to: atanan,
      completed_at: null,
      completed_by: null,
      wa_sent: false,
    }));
  };

  /* ── Hasta ── */
  const hastaEkle = async (veri) => {
    const telefon = telefonuNormalizeEt(veri.telefon, veri.ulkeKodu || VARSAYILAN_ULKE_KODU);
    if (hastalar.some(h => telefonAnahtari(h.telefon) === telefonAnahtari(telefon))) { bildirimGoster("⚠ Bu telefon zaten kayıtlı", "uyari"); return false; }
    const y = { id: uid(), name: veri.isim, phone: telefon, notes: veri.notlar || "", created_at: bugun() };
    const { error } = await supabase.from(TABLES.patients).insert(y);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return false; }
    setHastalar(prev => [{ id: y.id, isim: veri.isim, telefon, notlar: veri.notlar || "", olusturuldu: bugun() }, ...prev]);
    bildirimGoster("Hasta eklendi ✓"); return true;
  };
  const hastaSil = async (id) => {
    const silinmeTarihi = new Date().toISOString();
    const { error } = await supabase.from(TABLES.patients).update({ deleted_at: silinmeTarihi }).eq("id", id);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return; }
    setHastalar(p => p.map(h => h.id === id ? { ...h, silinmeTarihi } : h));
    setSeciliHasta(null); setModal(null); bildirimGoster("Hasta çöp kutusuna taşındı", "uyari");
  };
  const hastaGeriAl = async (id) => {
    const { error } = await supabase.from(TABLES.patients).update({ deleted_at: null }).eq("id", id);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return; }
    setHastalar(p => p.map(h => h.id === id ? { ...h, silinmeTarihi: null } : h));
    bildirimGoster("Hasta geri alındı ✓");
  };
  const hastaKaliciSil = async (id) => {
    const { error } = await supabase.from(TABLES.patients).delete().eq("id", id);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return; }
    setHastalar(p => p.filter(h => h.id !== id));
    setTedaviler(p => p.filter(t => t.hastaId !== id));
    setHatirlaticilar(p => p.filter(r => r.hastaId !== id));
    bildirimGoster("Hasta kalıcı silindi", "uyari");
  };
  const copuBosalt = async () => {
    const ids = hastalar.filter(h => h.silinmeTarihi).map(h => h.id);
    if (!ids.length) return;
    const { error } = await supabase.from(TABLES.patients).delete().in("id", ids);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return; }
    setHastalar(p => p.filter(h => !ids.includes(h.id)));
    setTedaviler(p => p.filter(t => !ids.includes(t.hastaId)));
    setHatirlaticilar(p => p.filter(r => !ids.includes(r.hastaId)));
    bildirimGoster("Çöp kutusu boşaltıldı", "uyari");
  };
  const hastaGuncelle = async (id, veri) => {
    const telefon = telefonuNormalizeEt(veri.telefon, veri.ulkeKodu || VARSAYILAN_ULKE_KODU);
    if (hastalar.some(h => h.id !== id && telefonAnahtari(h.telefon) === telefonAnahtari(telefon))) {
      bildirimGoster("⚠ Bu telefon zaten kayıtlı", "uyari");
      return false;
    }
    const payload = { name: veri.isim, phone: telefon, notes: veri.notlar || "" };
    const { error } = await supabase.from(TABLES.patients).update(payload).eq("id", id);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return false; }
    const guncelHasta = { id, isim: veri.isim, telefon, notlar: veri.notlar || "", olusturuldu: hastalar.find(h => h.id === id)?.olusturuldu || bugun() };
    setHastalar(p => p.map(h => h.id === id ? { ...h, ...guncelHasta } : h));
    setSeciliHasta(prev => prev?.id === id ? { ...prev, ...guncelHasta } : prev);
    bildirimGoster("Hasta bilgileri kaydedildi ✓");
    return true;
  };

  /* ── Tedavi ── */
  const tedaviEkle = async (hastaId, veri) => {
    const t = { id: uid(), patient_id: hastaId, procedure: veri.islem, date: veri.tarih, price: Number(veri.fiyat) || 0, notes: veri.notlar || "", created_at: bugun(), personel: kullanici?.isim || "", upsales: veri.upsales || false, upsales_islem: veri.upsalesIslem || "", upsales_fiyat: Number(veri.upsalesFiyat) || 0 };
    const { error } = await supabase.from(TABLES.treatments).insert(t);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return false; }
    setTedaviler(prev => [mT(t), ...prev]);
    const yeniR = hatirlaticiTaslagiOlustur(t.id, hastaId, veri, kullanici?.isim || "Atanmamış");
    if (yeniR.length > 0) {
      await supabase.from(TABLES.reminders).insert(yeniR);
      setHatirlaticilar(prev => [...prev, ...yeniR.map(mR)]);
    }
    bildirimGoster(`${veri.islem} eklendi${veri.upsales ? " + Upsales" : ""} ✓`);
    return true;
  };
  const hizliIslemTuruEkle = (isim) => {
    const ad = String(isim || "").trim();
    if (!ad) return "";
    const mevcut = islemListesi.find(i => i.isim.toLocaleLowerCase("tr-TR") === ad.toLocaleLowerCase("tr-TR"));
    if (mevcut) return mevcut.isim;
    const yeni = { id: uid(), isim: ad, renk: "#8b5cf6", hatirlaticilar: [{ etiket: "2 Hafta Kontrolü", gun: 14 }, { etiket: "3 Ay Takip", gun: 90 }] };
    islemGuncelle([...islemListesi, yeni]);
    bildirimGoster(`${ad} işlem listesine eklendi ✓`);
    return yeni.isim;
  };
  const tedaviGuncelle = async (tedaviId, veri) => {
    const mevcutTedavi = tedaviler.find(t => t.id === tedaviId);
    if (!mevcutTedavi) return false;
    const payload = {
      procedure: veri.islem,
      date: veri.tarih,
      price: Number(veri.fiyat) || 0,
      notes: veri.notlar || "",
      upsales: veri.upsales || false,
      upsales_islem: veri.upsalesIslem || "",
      upsales_fiyat: Number(veri.upsalesFiyat) || 0,
    };
    const { error } = await supabase.from(TABLES.treatments).update(payload).eq("id", tedaviId);
    if (error) { bildirimGoster("Hata: " + error.message, "hata"); return false; }

    setTedaviler(prev => prev.map(t => t.id === tedaviId ? { ...t, islem: veri.islem, tarih: veri.tarih, fiyat: Number(veri.fiyat) || 0, notlar: veri.notlar || "", upsales: veri.upsales || false, upsalesIslem: veri.upsalesIslem || "", upsalesFiyat: Number(veri.upsalesFiyat) || 0 } : t));

    const mevcutPending = hatirlaticilar.filter(r => r.tedaviId === tedaviId && r.durum === "pending");
    if (mevcutPending.length > 0) {
      await supabase.from(TABLES.reminders).delete().eq("treatment_id", tedaviId).eq("status", "pending");
      setHatirlaticilar(prev => prev.filter(r => !(r.tedaviId === tedaviId && r.durum === "pending")));
    }

    const yeniPending = hatirlaticiTaslagiOlustur(tedaviId, mevcutTedavi.hastaId, veri, mevcutPending[0]?.atanan || "Atanmamış");
    if (yeniPending.length > 0) {
      await supabase.from(TABLES.reminders).insert(yeniPending);
      setHatirlaticilar(prev => [...prev, ...yeniPending.map(mR)]);
    }

    await supabase.from(TABLES.reminders).update({ procedure: veri.islem }).eq("treatment_id", tedaviId).eq("status", "done");
    setHatirlaticilar(prev => prev.map(r => r.tedaviId === tedaviId && r.durum === "done" ? { ...r, islem: veri.islem } : r));
    bildirimGoster("Tedavi güncellendi ✓");
    return true;
  };

  /* ── Hatırlatıcı ── */
  const tamamlaIsaretle = async (id) => {
    await supabase.from(TABLES.reminders).update({ status: "done", completed_at: bugun(), completed_by: kullanici?.isim }).eq("id", id);
    setHatirlaticilar(p => p.map(r => r.id === id ? { ...r, durum: "done", tamamlananTarih: bugun(), tamamlayan: kullanici?.isim } : r));
    bildirimGoster("Tamamlandı ✓");
  };
  const bekleyeAl   = async (id) => { await supabase.from(TABLES.reminders).update({ status: "pending", completed_at: null, completed_by: null }).eq("id", id); setHatirlaticilar(p => p.map(r => r.id === id ? { ...r, durum: "pending", tamamlananTarih: null, tamamlayan: null } : r)); };
  const personelAta = async (id, per) => { await supabase.from(TABLES.reminders).update({ assigned_to: per }).eq("id", id); setHatirlaticilar(p => p.map(r => r.id === id ? { ...r, atanan: per } : r)); };
  const waGonderildi = async (id) => { await supabase.from(TABLES.reminders).update({ wa_sent: true }).eq("id", id); setHatirlaticilar(p => p.map(r => r.id === id ? { ...r, waGonderildi: true } : r)); };

  /* ── Excel / CSV ── */
  const disKaynaktanIceriAktar = async (kayitlar) => {
    if (kayitlar.length > CSV_IMPORT_LIMIT) { bildirimGoster(`En fazla ${CSV_IMPORT_LIMIT} hasta içe aktarılabilir`, "uyari"); return; }
    const varOlanTelefonlar = new Set(hastalar.map(h => telefonAnahtari(h.telefon)));
    let ek = 0, at = 0, hata = 0;
    for (const kayit of kayitlar) {
      const isim = String(kayit.isim || "").trim();
      const telefon = telefonuNormalizeEt(kayit.telefon, kayit.ulkeKodu || VARSAYILAN_ULKE_KODU);
      const telefonKey = telefonAnahtari(telefon);
      const islem = String(kayit.islem || "").trim();
      const tarih = excelTarihiniNormalizeEt(kayit.tarih);
      const fiyat = Number(String(kayit.fiyat || "").replace(",", ".")) || 0;
      const notlar = String(kayit.notlar || "").trim();

      if (!isim || !telefon || !telefonKey || varOlanTelefonlar.has(telefonKey)) { at++; continue; }

      const p = { id: uid(), name: isim, phone: telefon, notes: notlar, created_at: bugun() };
      const { error: hastaHata } = await supabase.from(TABLES.patients).insert(p);
      if (hastaHata) { hata++; continue; }

      varOlanTelefonlar.add(telefonKey);
      ek++;

      if (islem && tarih) {
        const ib = islemListesi.find(i => i.isim === islem);
        const t = { id: uid(), patient_id: p.id, procedure: islem, date: tarih, price: fiyat, notes: "", created_at: bugun(), personel: kullanici?.isim || "", upsales: false, upsales_islem: "", upsales_fiyat: 0 };
        const { error: tedaviHata } = await supabase.from(TABLES.treatments).insert(t);
        if (!tedaviHata && ib) {
          const rems = ib.hatirlaticilar.map(k => ({ id: uid(), treatment_id: t.id, patient_id: p.id, procedure: islem, label: k.etiket, due_date: gunEkle(tarih, k.gun), status: "pending", assigned_to: "Atanmamış", completed_at: null, completed_by: null, wa_sent: false }));
          await supabase.from(TABLES.reminders).insert(rems);
        }
      }
    }
    const mesaj = [`${ek} hasta eklendi`, at > 0 ? `${at} atlandı` : null, hata > 0 ? `${hata} hata oluştu` : null].filter(Boolean).join(", ");
    bildirimGoster(mesaj, hata > 0 ? "uyari" : "tamam");
  };

  const hastalariDisaAktar = async (liste = hastalar) => {
    if (!liste.length) { bildirimGoster("Dışa aktarılacak hasta yok", "uyari"); return; }
    try {
      const XLSX = await import("xlsx");
      const satirlar = liste.map(hasta => {
        const hastaTedavileri = tedaviler
          .filter(t => t.hastaId === hasta.id)
          .sort((a, b) => (b.tarih || "").localeCompare(a.tarih || ""));
        const bekleyenHat = hatirlaticilar.filter(r => r.hastaId === hasta.id && r.durum === "pending");
        const sonTedavi = hastaTedavileri[0];

        return {
          hasta_id: hasta.id,
          isim: hasta.isim,
          telefon: hasta.telefon,
          notlar: hasta.notlar || "",
          tedavi_sayisi: hastaTedavileri.length,
          son_tedavi: sonTedavi?.islem || "",
          son_ziyaret: sonTedavi?.tarih || "",
          bekleyen_hatirlatici: bekleyenHat.length,
          toplam_harcama: hastaTedavileri.reduce((toplam, t) => toplam + (t.fiyat || 0), 0),
          kayit_tarihi: String(hasta.olusturuldu || "").slice(0, 10),
        };
      });

      const ws = XLSX.utils.json_to_sheet(satirlar);
      ws["!cols"] = [
        { wch: 12 },
        { wch: 24 },
        { wch: 18 },
        { wch: 28 },
        { wch: 12 },
        { wch: 16 },
        { wch: 14 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Hastalar");
      XLSX.writeFile(wb, `hasta-listesi-${bugun()}.xlsx`);
      bildirimGoster(`${satirlar.length} hasta dışa aktarıldı ✓`);
    } catch (error) {
      bildirimGoster("Dışa aktarma sırasında hata oluştu", "hata");
    }
  };

  /* ── Hesaplananlar ── */
  const aktifHastalar   = adaGoreSirala(hastalar.filter(h => !h.silinmeTarihi));
  const copHastalar     = hastalar.filter(h => h.silinmeTarihi);
  const aktifHastaIdleri = new Set(aktifHastalar.map(h => h.id));
  const aktifTedaviler  = tedaviler.filter(t => aktifHastaIdleri.has(t.hastaId));
  const aktifHatirlaticilar = hatirlaticilar.filter(r => aktifHastaIdleri.has(r.hastaId));
  const hastaHaritasi   = Object.fromEntries(hastalar.map(h => [h.id, h]));
  const bugunStr        = bugun();
  const bugunHat        = aktifHatirlaticilar.filter(r => r.durum === "pending" && r.sonTarih === bugunStr);
  const gecmisHat       = aktifHatirlaticilar.filter(r => r.durum === "pending" && r.sonTarih < bugunStr);
  const gelecekHat      = aktifHatirlaticilar.filter(r => r.durum === "pending" && r.sonTarih > bugunStr);
  const tamamlananHat   = aktifHatirlaticilar.filter(r => r.durum === "done");
  const toplamGelir     = aktifTedaviler.reduce((s, t) => s + (t.fiyat || 0), 0);
  const aylikGelir      = aktifTedaviler.filter(t => t.tarih?.slice(0, 7) === bugunStr.slice(0, 7)).reduce((s, t) => s + (t.fiyat || 0), 0);
  const personelIsimleri = [...personelListesi.map(p => p.isim), "Atanmamış"];

  const filtreliHatirlaticilar = (() => {
    let l = hatTab === "bugun" ? bugunHat : hatTab === "gecmis" ? gecmisHat : hatTab === "gelecek" ? gelecekHat : aktifHatirlaticilar;
    if (filtreIslem    !== "Tümü") l = l.filter(r => r.islem  === filtreIslem);
    if (filtrePersonel !== "Tümü") l = l.filter(r => r.atanan === filtrePersonel);
    return [...l].sort((a, b) => a.sonTarih.localeCompare(b.sonTarih));
  })();

  const filtreliHastalar = adaGoreSirala(aktifHastalar.filter(h => {
    const q = hastaArama.toLowerCase();
    return h.isim.toLowerCase().includes(q) || h.telefon.includes(q) || h.id.toLowerCase().includes(q);
  }));

  if (AUTH_ENABLED && !authHazir) return <Yukleniyor />;
  if (AUTH_ENABLED && !authSession) return <AuthGirisEkrani varsayilanEmail={AUTH_EMAIL} onGiris={authGiris} bildirim={bildirim} />;
  if (!kullanici && !ayarlarHazir) return <Yukleniyor />;
  if (!kullanici) return <GirisEkrani personelListesi={personelListesi} onGiris={oturumAc} bildirim={bildirim} />;

  return (
    <div className="appShell" style={{ display: "flex", height: "100vh", background: "#f8f6f3", fontFamily: "'Outfit','Helvetica Neue',sans-serif", overflow: "hidden" }}>
      <GlobalStiller />
      <YanMenu gorunum={gorunum} setGorunum={setGorunum} kullanici={kullanici} onCikis={oturumKapat} bugunSayisi={bugunHat.length} gecmisSayisi={gecmisHat.length} copSayisi={copHastalar.length} menuAcik={menuAcik} setMenuAcik={setMenuAcik} isAdmin={isAdmin} />
      <div className="appMain" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <UstBar gorunum={gorunum} onHastaEkle={() => setModal("hastaEkle")} onIceriAktar={() => setModal("iceriAktar")} onDisaAktar={() => hastalariDisaAktar(filtreliHastalar)} hastaArama={hastaArama} setHastaArama={setHastaArama} isAdmin={isAdmin} />
        <div className="appContent" style={{ flex: 1, overflowY: "auto", padding: "22px 26px", animation: "yukariCik .3s ease" }}>
          {yukleniyor ? <Yukleniyor /> : (
            <>
              {gorunum === "panel"          && <Panel hastalar={aktifHastalar} tedaviler={aktifTedaviler} hastaHaritasi={hastaHaritasi} bugunHat={bugunHat} gecmisHat={gecmisHat} gelecekHat={gelecekHat} tamamlananHat={tamamlananHat} toplamGelir={toplamGelir} aylikGelir={aylikGelir} tamamlaIsaretle={tamamlaIsaretle} setGorunum={setGorunum} setHatTab={setHatTab} isAdmin={isAdmin} kullanici={kullanici} iletisimKaydet={iletisimKaydet} />}
              {gorunum === "hastalar"       && <HastaListesi hastalar={filtreliHastalar} tedaviler={aktifTedaviler} hatirlaticilar={aktifHatirlaticilar} onSec={h => { setProfilTedaviAc(false); setSeciliHasta(h); setModal("profil"); }} onTedaviKaydir={h => { setProfilTedaviAc(true); setSeciliHasta(h); setModal("profil"); }} onSil={hastaSil} kullanici={kullanici} iletisimKaydet={iletisimKaydet} />}
              {gorunum === "hatirlaticilar" && <HatirlaticiPanosu hatirlaticilar={filtreliHatirlaticilar} tumHatirlaticilar={aktifHatirlaticilar} hastaHaritasi={hastaHaritasi} hatTab={hatTab} setHatTab={setHatTab} filtreIslem={filtreIslem} setFiltreIslem={setFiltreIslem} filtrePersonel={filtrePersonel} setFiltrePersonel={setFiltrePersonel} tamamlaIsaretle={tamamlaIsaretle} bekleyeAl={bekleyeAl} personelAta={personelAta} waGonderildi={waGonderildi} bugunHat={bugunHat} gecmisHat={gecmisHat} gelecekHat={gelecekHat} personelIsimleri={personelIsimleri} islemListesi={islemListesi} kullanici={kullanici} iletisimKaydet={iletisimKaydet} />}
              {gorunum === "analitik" && (isAdmin ? <Analitik hastalar={aktifHastalar} tedaviler={aktifTedaviler} hatirlaticilar={aktifHatirlaticilar} tamamlananHat={tamamlananHat} toplamGelir={toplamGelir} aylikGelir={aylikGelir} islemListesi={islemListesi} personelListesi={personelListesi} iletisimLog={iletisimLog} kullanici={kullanici} /> : <Analitik hastalar={aktifHastalar} tedaviler={aktifTedaviler} hatirlaticilar={aktifHatirlaticilar} tamamlananHat={tamamlananHat} toplamGelir={toplamGelir} aylikGelir={aylikGelir} islemListesi={islemListesi} personelListesi={personelListesi} iletisimLog={iletisimLog} kullanici={kullanici} />)}
              {gorunum === "ozet"           && <OzetPaneli hastalar={aktifHastalar} hatirlaticilar={aktifHatirlaticilar} hastaHaritasi={hastaHaritasi} bugunHat={bugunHat} gecmisHat={gecmisHat} bildirimGoster={bildirimGoster} />}
              {gorunum === "cop"            && <CopKutusu hastalar={copHastalar} onGeriAl={hastaGeriAl} onKaliciSil={hastaKaliciSil} onBosalt={copuBosalt} />}
              {gorunum === "ayarlar" && (isAdmin ? <Ayarlar personelListesi={personelListesi} onPersonelGuncelle={personelGuncelle} islemListesi={islemListesi} onIslemGuncelle={islemGuncelle} bildirimGoster={bildirimGoster} /> : <YetkiYok />)}
            </>
          )}
        </div>
      </div>
      {bildirim && <Bildirim {...bildirim} />}
      {modal === "hastaEkle"  && <HastaEkleModal onKapat={() => setModal(null)} onKaydet={hastaEkle} />}
      {modal === "iceriAktar" && <IceriAktarModal onKapat={() => setModal(null)} onAktar={disKaynaktanIceriAktar} />}
      {modal === "profil" && seciliHasta && (
        <ProfilModal hasta={seciliHasta} tedaviler={tedaviler.filter(t => t.hastaId === seciliHasta.id)} hatirlaticilar={hatirlaticilar.filter(r => r.hastaId === seciliHasta.id)} onKapat={() => { setModal(null); setSeciliHasta(null); setProfilTedaviAc(false); }} onTedaviEkle={v => tedaviEkle(seciliHasta.id, v)} onTedaviGuncelle={tedaviGuncelle} onSil={() => hastaSil(seciliHasta.id)} onHastaGuncelle={v => hastaGuncelle(seciliHasta.id, v)} tamamlaIsaretle={tamamlaIsaretle} bekleyeAl={bekleyeAl} kullanici={kullanici} isAdmin={isAdmin} bildirimGoster={bildirimGoster} islemListesi={islemListesi} iletisimKaydet={iletisimKaydet} ilkTedaviAc={profilTedaviAc} onYeniIslemTuru={hizliIslemTuruEkle} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   STİLLER
══════════════════════════════════════════════════ */
function GlobalStiller() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
    html,body,#root{height:100%}
    *{box-sizing:border-box;margin:0;padding:0}
    body{overflow-x:hidden}
    ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#d6cfc6;border-radius:4px}
    input,select,textarea{font-family:inherit;outline:none}
    input:focus,select:focus,textarea:focus{border-color:#1a1a2e!important;box-shadow:0 0 0 3px rgba(26,26,46,.07)!important}
    @keyframes yukariCik{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes don{to{transform:rotate(360deg)}}
    .satir:hover{background:#f1ede8!important;cursor:pointer}
    .btn{cursor:pointer;transition:all .15s;border:none;border-radius:9px;font-family:inherit;font-weight:500}
    .btn:hover{filter:brightness(.94)}.btn:active{transform:scale(.97)}
    .kart{background:#fff;border-radius:14px;border:1px solid #ece7e0;box-shadow:0 1px 4px rgba(0,0,0,.04)}
    .nav{transition:all .18s;cursor:pointer;border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:9px;font-size:14px;color:#9b9bbb}
    .nav:hover{background:rgba(255,255,255,.08);color:#fff}
    .nav.aktif{background:rgba(255,255,255,.15);color:#fff}
    .giris{background:#f8f6f3;border:1.5px solid #e4ddd5;border-radius:9px;padding:9px 13px;font-size:14px;color:#1a1a2e;width:100%;transition:all .2s}
    .etiket{border-radius:6px;padding:2px 9px;font-size:11px;font-weight:600;letter-spacing:.4px;display:inline-block}
    .mono{font-family:'JetBrains Mono',monospace}
    .tableCard{-webkit-overflow-scrolling:touch}
    .mobileScroll{max-width:100%}
    @media (max-width:900px){
      .appShell{height:auto!important;min-height:100vh;flex-direction:column!important;overflow:visible!important}
      .appMain{overflow:visible!important;min-width:0}
      .appContent{padding:16px!important;overflow:auto!important}
      .sidebarShell{width:100%!important;padding:10px 12px!important;overflow:visible!important}
      .sidebarTop{padding:0 2px 0!important;margin-bottom:0!important}
      .sidebarShell.sidebarClosed .sidebarCollapsedLabel{display:block!important}
      .sidebarShell.sidebarClosed .sidebarContent{display:none!important}
      .menuToggle{display:flex!important;width:36px!important;height:36px!important;color:#fff!important}
      .topBar{height:auto!important;flex-wrap:wrap!important;align-items:flex-start!important;padding:12px 16px!important}
      .topBarTitle{width:100%}
      .topBarSearch{width:100%!important}
      .grid2,.grid3,.grid4,.settingsGrid,.profileGrid{grid-template-columns:1fr!important}
      .mobileWrap{flex-wrap:wrap!important}
      .mobileScroll{width:100%!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch}
      .tableCard{overflow-x:auto!important}
      .responsiveTable{min-width:720px}
      .profileHeader{flex-direction:column!important;align-items:flex-start!important;gap:14px!important}
      .profileActions{width:100%!important;flex-wrap:wrap!important}
      .profileActions > *{flex:1 1 calc(50% - 8px)}
      .modalBox,.profileModalBox{padding:20px!important;max-height:calc(100vh - 32px);overflow-y:auto}
      input,select,textarea{font-size:16px}
    }
    @media (max-width:640px){
      .responsiveTable{min-width:640px}
      .profileActions > *{flex-basis:100%}
    }
  `}</style>;
}

/* ══════════════════════════════════════════════════
   GİRİŞ EKRANI
══════════════════════════════════════════════════ */
function AuthGirisEkrani({ varsayilanEmail, onGiris, bildirim }) {
  const [email, setEmail] = useState(varsayilanEmail);
  const [sifre, setSifre] = useState("");
  const [hata, setHata] = useState("");
  const [bekliyor, setBekliyor] = useState(false);

  const girisYap = async (e) => {
    e.preventDefault();
    if (!email.trim() || !sifre) {
      setHata("E-posta ve şifre gerekli");
      return;
    }
    setBekliyor(true);
    setHata("");
    const basarili = await onGiris(email, sifre);
    setBekliyor(false);
    if (!basarili) {
      setHata("Giriş bilgileri hatalı");
      setSifre("");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, fontFamily: "'Outfit',sans-serif" }}>
      <GlobalStiller />
      <form onSubmit={girisYap} style={{ width: "min(440px, 100%)", background: "#fff", borderRadius: 22, padding: 36, boxShadow: "0 40px 100px rgba(0,0,0,.4)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 62, height: 62, background: "linear-gradient(135deg,#1a1a2e,#e11d48)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 14px" }}>💎</div>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#1a1a2e", letterSpacing: -.5 }}>{KLINIK_ADI}</div>
          <div style={{ fontSize: 13, color: "#9b8f88", marginTop: 5 }}>Güvenli Giriş</div>
        </div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#78706a", marginBottom: 7 }}>E-posta</label>
        <input className="giris" type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setHata(""); }} style={{ marginBottom: 14 }} />
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#78706a", marginBottom: 7 }}>Şifre</label>
        <input className="giris" type="password" autoComplete="current-password" value={sifre} onChange={e => { setSifre(e.target.value); setHata(""); }} autoFocus style={{ marginBottom: 12 }} />
        {hata && <div style={{ color: "#e11d48", fontSize: 13, marginBottom: 12, textAlign: "center" }}>{hata}</div>}
        <Btn type="submit" koyu disabled={bekliyor} style={{ width: "100%", padding: 14, fontSize: 15, fontWeight: 700 }}>{bekliyor ? "Kontrol ediliyor..." : "Devam Et"}</Btn>
      </form>
      {bildirim && <Bildirim {...bildirim} />}
    </div>
  );
}

function GirisEkrani({ personelListesi, onGiris, bildirim }) {
  const [adim, setAdim] = useState("sec");
  const [secilen, setSecilen] = useState(null);
  const [pin, setPin] = useState("");
  const [hata, setHata] = useState("");

  const girisYap = () => {
    const p = personelListesi.find(x => x.isim === secilen);
    if (p && p.pin === pin) onGiris({ isim: p.isim, rol: p.rol });
    else { setHata("Hatalı PIN — tekrar deneyin"); setPin(""); }
  };

  return (
    <div style={{ height: "100vh", background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Outfit',sans-serif" }}>
      <GlobalStiller />
      <div style={{ width: 440, background: "#fff", borderRadius: 22, padding: 44, boxShadow: "0 40px 100px rgba(0,0,0,.4)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 62, height: 62, background: "linear-gradient(135deg,#1a1a2e,#e11d48)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 14px" }}>💎</div>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#1a1a2e", letterSpacing: -.5 }}>{KLINIK_ADI}</div>
          <div style={{ fontSize: 13, color: "#9b8f88", marginTop: 5 }}>Personel Girişi · Güvenli Erişim</div>
        </div>

        {adim === "sec" ? (
          <>
            <div style={{ fontSize: 13, color: "#78706a", marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Profilinizi seçin</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {personelListesi.map(p => (
                <button key={p.id} className="btn" onClick={() => { setSecilen(p.isim); setAdim("pin"); setHata(""); }}
                  style={{ background: "#f8f6f3", color: "#1a1a2e", padding: "12px 16px", textAlign: "left", fontSize: 14, display: "flex", alignItems: "center", gap: 12, border: "1.5px solid #ece7e0" }}>
                  <Avatar isim={p.isim} boyut={36} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{p.isim}</span>
                  <span style={{ fontSize: 11, color: p.rol === "admin" ? "#e11d48" : "#b0a89e", background: p.rol === "admin" ? "#fff1f2" : "#ece7e0", padding: "3px 9px", borderRadius: 6, fontWeight: 600 }}>{p.rol === "admin" ? "👑 Admin" : "Personel"}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => { setAdim("sec"); setPin(""); setHata(""); }} style={{ background: "none", border: "none", color: "#9b8f88", cursor: "pointer", fontSize: 13, marginBottom: 18, display: "flex", alignItems: "center", gap: 5 }}>← Geri dön</button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, padding: "10px 14px", background: "#f8f6f3", borderRadius: 10 }}>
              <Avatar isim={secilen || ""} boyut={36} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{secilen}</div>
                <div style={{ fontSize: 12, color: "#9b8f88" }}>{personelListesi.find(p => p.isim === secilen)?.rol === "admin" ? "👑 Admin · 6 haneli PIN" : "Personel · PIN"}</div>
              </div>
            </div>
            <input className="giris" type="password" maxLength={6} value={pin}
              onChange={e => { setPin(e.target.value); setHata(""); }}
              onKeyDown={e => e.key === "Enter" && girisYap()}
              placeholder="PIN giriniz" autoFocus
              style={{ marginBottom: 10, fontSize: 24, letterSpacing: 12, textAlign: "center", padding: "14px" }} />
            {hata && <div style={{ color: "#e11d48", fontSize: 13, marginBottom: 10, textAlign: "center" }}>{hata}</div>}
            <Btn onClick={girisYap} koyu style={{ width: "100%", padding: 14, fontSize: 15, fontWeight: 700 }}>Giriş Yap →</Btn>
          </>
        )}
      </div>
      {bildirim && <Bildirim {...bildirim} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   YAN MENÜ
══════════════════════════════════════════════════ */
function YanMenu({ gorunum, setGorunum, kullanici, onCikis, bugunSayisi, gecmisSayisi, copSayisi, menuAcik, setMenuAcik, isAdmin }) {
  const menuler = [
    { k: "panel",          i: "⬡", e: "Panel" },
    { k: "hastalar",       i: "◎", e: "Hastalar" },
    { k: "hatirlaticilar", i: "◷", e: "Hatırlatıcılar" },
    { k: "analitik",       i: "▦", e: isAdmin ? "Analitik & Raporlar" : "Raporlarım" },
    { k: "ozet",           i: "✉", e: "AI Özet" },
    { k: "cop",            i: "⌫", e: "Çöp Kovası" },
    ...(isAdmin ? [{ k: "ayarlar", i: "⚙", e: "Ayarlar" }] : []),
  ];
  const rozet = gecmisSayisi > 0 ? gecmisSayisi : bugunSayisi;
  const rRenk = gecmisSayisi > 0 ? "#e11d48" : "#d97706";

  return (
    <div className={`sidebarShell ${menuAcik ? "sidebarOpen" : "sidebarClosed"}`} style={{ width: menuAcik ? 218 : 58, background: "#1a1a2e", display: "flex", flexDirection: "column", padding: "14px 8px", gap: 2, flexShrink: 0, transition: "width .25s ease", overflow: "hidden" }}>
      <div className="sidebarTop" style={{ display: "flex", alignItems: "center", justifyContent: menuAcik ? "space-between" : "center", padding: "4px 4px 18px", marginBottom: 2 }}>
        {menuAcik ? (
          <div style={{ paddingLeft: 4 }}>
            <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#4a4a6a", fontWeight: 600 }}>Klinik</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>CRM <span style={{ color: "#e11d48", fontStyle: "italic" }}>Pro</span></div>
          </div>
        ) : (
          <div className="sidebarCollapsedLabel" style={{ display: "none", color: "#fff", fontSize: 13, fontWeight: 700, paddingLeft: 4 }}>Menü</div>
        )}
        <button className="menuToggle" onClick={() => setMenuAcik(!menuAcik)} style={{ background: "rgba(255,255,255,.08)", border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: "#9b9bbb", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {menuAcik ? "◀" : "☰"}
        </button>
      </div>

      <div className="sidebarContent" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {menuler.map(m => (
          <div key={m.k} className={`nav ${gorunum === m.k ? "aktif" : ""}`} onClick={() => { setGorunum(m.k); if (window.innerWidth <= 900) setMenuAcik(false); }}
            style={{ justifyContent: menuAcik ? "flex-start" : "center", padding: menuAcik ? "10px 12px" : "10px", position: "relative" }}
            title={!menuAcik ? m.e : ""}>
            <span style={{ fontSize: 15, flexShrink: 0 }}>{m.i}</span>
            {menuAcik && <span style={{ flex: 1, whiteSpace: "nowrap", fontSize: 13 }}>{m.e}</span>}
            {m.k === "hatirlaticilar" && rozet > 0 && (
              <span style={{ background: rRenk, color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700, position: menuAcik ? "relative" : "absolute", top: menuAcik ? 0 : 4, right: menuAcik ? 0 : 4 }} className="mono">{rozet}</span>
            )}
            {m.k === "cop" && copSayisi > 0 && (
              <span style={{ background: "#78706a", color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700, position: menuAcik ? "relative" : "absolute", top: menuAcik ? 0 : 4, right: menuAcik ? 0 : 4 }} className="mono">{copSayisi}</span>
            )}
          </div>
        ))}

        <div style={{ marginTop: "auto", borderTop: "1px solid #2d2d4e", paddingTop: 10 }}>
          {menuAcik ? (
            <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
              <Avatar isim={kullanici.isim} boyut={30} />
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kullanici.isim}</div>
                <div style={{ fontSize: 10, color: kullanici.rol === "admin" ? "#e11d48" : "#4a4a6a", textTransform: "uppercase", letterSpacing: .5 }}>{kullanici.rol === "admin" ? "👑 Admin" : "Personel"}</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 8px" }}><Avatar isim={kullanici.isim} boyut={28} /></div>
          )}
          <button className="btn" onClick={onCikis} style={{ width: "100%", background: "rgba(255,255,255,.06)", color: "#9b9bbb", padding: menuAcik ? "7px 10px" : "7px", fontSize: 12, textAlign: menuAcik ? "left" : "center" }}>
            {menuAcik ? "⇤ Çıkış Yap" : "⇤"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   ÜST BAR
══════════════════════════════════════════════════ */
function UstBar({ gorunum, onHastaEkle, onIceriAktar, onDisaAktar, hastaArama, setHastaArama, isAdmin }) {
  const b = { panel: "Panel", hastalar: "Hasta Kayıtları", hatirlaticilar: "Hatırlatıcı Görevler", analitik: isAdmin ? "Analitik & Raporlar" : "Raporlarım", ozet: "AI Günlük Özet", cop: "Çöp Kovası", ayarlar: "Sistem Ayarları" };
  return (
    <div className="topBar" style={{ background: "#fff", borderBottom: "1px solid #ece7e0", padding: "0 26px", height: 56, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
      <div className="topBarTitle" style={{ fontSize: 17, fontWeight: 700, color: "#1a1a2e", flex: 1 }}>{b[gorunum] || ""}</div>
      {gorunum === "hastalar" && <>
        <input className="giris topBarSearch" value={hastaArama} onChange={e => setHastaArama(e.target.value)} placeholder="İsim, telefon veya ID…" style={{ width: 240, padding: "7px 13px" }} />
        {isAdmin && <Btn onClick={onDisaAktar} style={{ background: "#eef5ff", color: "#1d4ed8", padding: "7px 14px", fontSize: 13, border: "1px solid #bfdbfe" }}>⬇ Dışa Aktar</Btn>}
        {isAdmin && <Btn onClick={onIceriAktar} style={{ background: "#f1ede8", color: "#5a4a3a", padding: "7px 14px", fontSize: 13 }}>⬆ Excel</Btn>}
        <Btn onClick={onHastaEkle} koyu style={{ padding: "7px 16px", fontSize: 13 }}>+ Yeni Hasta</Btn>
      </>}
      {gorunum === "hatirlaticilar" && <Btn onClick={onHastaEkle} koyu style={{ padding: "7px 16px", fontSize: 13 }}>+ Yeni Hasta</Btn>}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   PANEL
══════════════════════════════════════════════════ */
function Panel({ hastalar, tedaviler, hastaHaritasi, bugunHat, gecmisHat, gelecekHat, tamamlananHat, toplamGelir, aylikGelir, tamamlaIsaretle, setGorunum, setHatTab, isAdmin, kullanici, iletisimKaydet }) {
  const ist = [
    { e: "Bugünkü Aramalar",  d: bugunHat.length,  r: "#d97706", a: "#fffbeb", k: "#fde68a", fn: () => { setGorunum("hatirlaticilar"); setHatTab("bugun"); } },
    { e: "Geçmiş",           d: gecmisHat.length, r: "#e11d48", a: "#fff1f2", k: "#fecdd3", fn: () => { setGorunum("hatirlaticilar"); setHatTab("gecmis"); } },
    { e: "Yaklaşan (30 gün)",d: gelecekHat.filter(r => gunFarki(r.sonTarih) <= 30).length, r: "#2563eb", a: "#eff6ff", k: "#bfdbfe", fn: () => { setGorunum("hatirlaticilar"); setHatTab("gelecek"); } },
    { e: "Tamamlanan",       d: tamamlananHat.length, r: "#059669", a: "#f0fdf4", k: "#a7f3d0", fn: null },
    { e: "Toplam Hasta",     d: hastalar.length, r: "#7c3aed", a: "#faf5ff", k: "#ddd6fe", fn: () => setGorunum("hastalar") },
    ...(isAdmin ? [{ e: "Bu Ay Ciro", d: paraFmt(aylikGelir), r: "#0369a1", a: "#f0f9ff", k: "#bae6fd", fn: () => setGorunum("analitik") }] : []),
  ];
  const acil = [...gecmisHat, ...bugunHat].slice(0, 8);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="grid3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {ist.map(s => <IstatistikKarti key={s.e} etiket={s.e} deger={s.d} renk={s.r} arkaplan={s.a} kenar={s.k} onClick={s.fn} />)}
      </div>
      <div className="grid2" style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 18 }}>
        <div className="kart" style={{ padding: 20 }}>
          <BolumBasligi ikon={gecmisHat.length ? "🔴" : "📞"} baslik="Acil & Bugün" titreme={gecmisHat.length > 0} />
          {acil.length === 0 ? <Bos metin="Harika! Acil hatırlatıcı yok." /> : acil.map(r => {
            const h = hastaHaritasi[r.hastaId]; const g = gunFarki(r.sonTarih);
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", background: "#f8f6f3", borderRadius: 10, border: "1px solid #ece7e0", marginBottom: 6 }}>
                <Avatar isim={h?.isim || "?"} boyut={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{h?.isim}</div>
                  <div style={{ fontSize: 11, color: "#9b8f88" }}>{r.etiket} · <IslemEtiketi islem={r.islem} kucuk /></div>
                </div>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: g < 0 ? "#e11d48" : "#d97706" }}>{g < 0 ? `${Math.abs(g)}g gecikti` : "Bugün"}</span>
                <a href={`tel:${h?.telefon}`} onClick={() => iletisimKaydet(h?.id, h?.isim, "Arama", kullanici?.isim, r.etiket)}><Btn kk koyu>📞</Btn></a>
                <a href={`https://wa.me/${h?.telefon?.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Merhaba ${h?.isim?.split(" ")[0]}, ${r.islem} için ${r.etiket} zamanı geldi! 😊`)}`} target="_blank" rel="noreferrer" onClick={() => iletisimKaydet(h?.id, h?.isim, "WhatsApp", kullanici?.isim, r.etiket)}>
                  <Btn kk style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>💬</Btn>
                </a>
                <Btn kk onClick={() => tamamlaIsaretle(r.id)} style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>✓</Btn>
              </div>
            );
          })}
        </div>
        <div className="kart" style={{ padding: 20 }}>
          <BolumBasligi ikon="🧴" baslik="Son Tedaviler" />
          {[...tedaviler].sort((a, b) => b.tarih?.localeCompare(a.tarih)).slice(0, 7).map(t => {
            const h = hastaHaritasi[t.hastaId];
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #f1ede8" }}>
                <IslemEtiketi islem={t.islem} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{h?.isim}</div>
                  <div style={{ fontSize: 11, color: "#9b8f88", display: "flex", gap: 5, alignItems: "center" }}>
                    {tarihFmt(t.tarih)}
                    {t.upsales && <span style={{ background: "#fefce8", color: "#ca8a04", border: "1px solid #fde68a", borderRadius: 4, padding: "0 5px", fontSize: 10, fontWeight: 600 }}>⬆ Upsales</span>}
                  </div>
                </div>
                {isAdmin && t.fiyat > 0 && <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "#1a1a2e" }}>{paraFmt(t.fiyat)}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   HASTA LİSTESİ
══════════════════════════════════════════════════ */
function HastaListesi({ hastalar, tedaviler, hatirlaticilar, onSec, onTedaviKaydir, onSil, kullanici, iletisimKaydet }) {
  const SAYFA_BOYUTU = 100;
  const [sayfa, setSayfa] = useState(1);
  const toplamSayfa = Math.max(1, Math.ceil(hastalar.length / SAYFA_BOYUTU));
  const baslangic = (sayfa - 1) * SAYFA_BOYUTU;
  const sayfaHastalari = hastalar.slice(baslangic, baslangic + SAYFA_BOYUTU);
  const bitis = Math.min(baslangic + SAYFA_BOYUTU, hastalar.length);

  useEffect(() => { setSayfa(1); }, [hastalar.length]);
  useEffect(() => {
    if (sayfa > toplamSayfa) setSayfa(toplamSayfa);
  }, [sayfa, toplamSayfa]);

  const SayfaKontrolleri = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className="mono" style={{ fontSize: 12, color: "#78706a", background: "#fff", border: "1px solid #ece7e0", borderRadius: 8, padding: "5px 9px" }}>
        {hastalar.length ? `${baslangic + 1}-${bitis}` : "0"} / {hastalar.length}
      </span>
      <Btn kk disabled={sayfa <= 1} onClick={() => setSayfa(s => Math.max(1, s - 1))} style={{ opacity: sayfa <= 1 ? .45 : 1 }}>‹</Btn>
      <span className="mono" style={{ fontSize: 12, color: "#78706a" }}>{sayfa}/{toplamSayfa}</span>
      <Btn kk disabled={sayfa >= toplamSayfa} onClick={() => setSayfa(s => Math.min(toplamSayfa, s + 1))} style={{ opacity: sayfa >= toplamSayfa ? .45 : 1 }}>›</Btn>
    </div>
  );

  return (
    <div className="kart tableCard" style={{ overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "#fffaf0", borderBottom: "1px solid #fde68a", color: "#8a5a00", fontSize: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <strong>Kaydır:</strong><span>Sağa: tedavi ekle</span><span>Sola: çöp kovasına taşı</span>
        </div>
        <SayfaKontrolleri />
      </div>
      <table className="responsiveTable" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f8f6f3", borderBottom: "1px solid #ece7e0" }}>
            {["Hasta ID", "İsim & Notlar", "Telefon", "Tedavi", "Bekleyen", "Son Ziyaret", ""].map(b => (
              <th key={b} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#9b8f88", fontWeight: 500 }}>{b}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hastalar.length === 0 && <tr><td colSpan={7} style={{ padding: 48, textAlign: "center", color: "#b0a89e" }}>Hasta bulunamadı</td></tr>}
          {sayfaHastalari.map(h => {
            const hT = tedaviler.filter(t => t.hastaId === h.id);
            const hR = hatirlaticilar.filter(r => r.hastaId === h.id && r.durum === "pending");
            const son = [...hT].sort((a, b) => b.tarih?.localeCompare(a.tarih))[0];
            return (
              <tr key={h.id} className="satir" style={{ borderBottom: "1px solid #f1ede8" }} onClick={() => onSec(h)}>
                <td style={{ padding: "11px 14px" }}><span className="mono" style={{ fontSize: 11, color: "#9b8f88" }}>{h.id}</span></td>
                <td style={{ padding: "11px 14px" }} onClick={e => e.stopPropagation()}>
                  <KaydirmaAlani onSaga={() => onTedaviKaydir(h)} onSola={() => onSil(h.id)} onTikla={() => onSec(h)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, cursor: "grab", touchAction: "pan-y" }}>
                      <Avatar isim={h.isim} boyut={34} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a2e" }}>{h.isim}</div>
                        {h.notlar && <div style={{ fontSize: 11, color: "#9b8f88" }}>{h.notlar.slice(0, 35)}{h.notlar.length > 35 ? "…" : ""}</div>}
                      </div>
                    </div>
                  </KaydirmaAlani>
                </td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{h.telefon}</td>
                <td style={{ padding: "11px 14px" }}><span className="mono" style={{ fontWeight: 700 }}>{hT.length}</span></td>
                <td style={{ padding: "11px 14px" }}>{hR.length > 0 ? <span className="etiket" style={{ background: "#fff1f2", color: "#e11d48", border: "1px solid #fecdd3" }}>{hR.length} bekliyor</span> : <span style={{ color: "#b0a89e", fontSize: 12 }}>—</span>}</td>
                <td style={{ padding: "11px 14px", fontSize: 12, color: "#9b8f88" }}>{son ? tarihFmt(son.tarih) : "Henüz yok"}</td>
                <td style={{ padding: "11px 14px" }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: "flex", gap: 5 }}>
                    <Btn kk onClick={() => onSec(h)} style={{ background: "#eef5ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>✎</Btn>
                    <a href={`tel:${h.telefon}`} onClick={() => iletisimKaydet(h.id, h.isim, "Arama", kullanici?.isim, "—")}><Btn kk koyu>📞</Btn></a>
                    <a href={`https://wa.me/${h.telefon.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" onClick={() => iletisimKaydet(h.id, h.isim, "WhatsApp", kullanici?.isim, "—")}><Btn kk style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>💬</Btn></a>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {toplamSayfa > 1 && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid #ece7e0", background: "#fff", display: "flex", justifyContent: "flex-end" }}>
          <SayfaKontrolleri />
        </div>
      )}
    </div>
  );
}

function KaydirmaAlani({ children, onSaga, onSola, onTikla }) {
  const [baslangic, setBaslangic] = useState(null);
  const [kayma, setKayma] = useState(0);
  const esik = 86;
  const bitir = () => {
    const son = kayma;
    if (son > esik) onSaga();
    else if (son < -esik) onSola();
    else if (Math.abs(son) < 8) onTikla?.();
    setBaslangic(null);
    setKayma(0);
  };
  return (
    <div
      onPointerDown={e => setBaslangic(e.clientX)}
      onPointerMove={e => { if (baslangic !== null) setKayma(Math.max(-125, Math.min(125, e.clientX - baslangic))); }}
      onPointerUp={bitir}
      onPointerCancel={bitir}
      style={{ position: "relative", overflow: "hidden", borderRadius: 10 }}
    >
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", background: kayma >= 0 ? "#eff6ff" : "#fff1f2", color: kayma >= 0 ? "#1d4ed8" : "#e11d48", fontSize: 12, fontWeight: 700, pointerEvents: "none" }}>
        <span>+ Tedavi</span>
        <span>Çöp</span>
      </div>
      <div style={{ position: "relative", transform: `translateX(${kayma}px)`, transition: baslangic === null ? "transform .18s ease" : "none", background: "#fff", borderRadius: 10, padding: "3px 0" }}>
        {children}
      </div>
    </div>
  );
}

function CopKutusu({ hastalar, onGeriAl, onKaliciSil, onBosalt }) {
  return (
    <div className="kart tableCard" style={{ overflow: "hidden" }}>
      <div style={{ padding: 16, borderBottom: "1px solid #ece7e0", background: "#f8f6f3", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e" }}>Çöp kovası</div>
          <div style={{ fontSize: 13, color: "#78706a", marginTop: 4 }}>Silinen hastalar 45 gün burada tutulur. İstersen manuel olarak çöpü boşaltabilirsin.</div>
        </div>
        <Btn onClick={onBosalt} style={{ background: "#fff1f2", color: "#e11d48", border: "1px solid #fecdd3" }}>Çöpü Boşalt</Btn>
      </div>
      <table className="responsiveTable" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ background: "#fff", borderBottom: "1px solid #ece7e0" }}>{["Hasta", "Telefon", "Silinme", "Kalan", "İşlem"].map(b => <th key={b} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#9b8f88", fontWeight: 500 }}>{b}</th>)}</tr></thead>
        <tbody>
          {hastalar.length === 0 && <tr><td colSpan={5} style={{ padding: 48, textAlign: "center", color: "#b0a89e" }}>Çöp kovası boş</td></tr>}
          {hastalar.map(h => {
            const kalan = Math.max(0, COP_KUTUSU_GUN + gunFarki(String(h.silinmeTarihi || "").slice(0, 10)));
            return (
              <tr key={h.id} style={{ borderBottom: "1px solid #f1ede8" }}>
                <td style={{ padding: "11px 14px" }}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Avatar isim={h.isim} boyut={34} /><div><div style={{ fontWeight: 600 }}>{h.isim}</div><div className="mono" style={{ fontSize: 11, color: "#9b8f88" }}>{h.id}</div></div></div></td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{h.telefon}</td>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>{tarihFmt(String(h.silinmeTarihi || "").slice(0, 10))}</td>
                <td style={{ padding: "11px 14px" }}><span className="etiket" style={{ background: kalan ? "#fff7ed" : "#fff1f2", color: kalan ? "#d97706" : "#e11d48", border: `1px solid ${kalan ? "#fed7aa" : "#fecdd3"}` }}>{kalan ? `${kalan} gün` : "Süre doldu"}</span></td>
                <td style={{ padding: "11px 14px" }}><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}><Btn kk koyu onClick={() => onGeriAl(h.id)}>Geri Al</Btn><Btn kk onClick={() => onKaliciSil(h.id)} style={{ background: "#fff1f2", color: "#e11d48", border: "1px solid #fecdd3" }}>Kalıcı Sil</Btn></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   HATIRLATICI PANOSU
══════════════════════════════════════════════════ */
function HatirlaticiPanosu({ hatirlaticilar, tumHatirlaticilar, hastaHaritasi, hatTab, setHatTab, filtreIslem, setFiltreIslem, filtrePersonel, setFiltrePersonel, tamamlaIsaretle, bekleyeAl, personelAta, waGonderildi, bugunHat, gecmisHat, gelecekHat, personelIsimleri, islemListesi, kullanici, iletisimKaydet }) {
  const sek = [
    { k: "bugun",   e: "Bugün",    s: bugunHat.length,          r: "#d97706" },
    { k: "gecmis",  e: "Geçmiş",   s: gecmisHat.length,         r: "#e11d48" },
    { k: "gelecek", e: "Yaklaşan", s: gelecekHat.length,        r: "#2563eb" },
    { k: "tumu",    e: "Tümü",     s: tumHatirlaticilar.length, r: "#78706a" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="mobileScroll" style={{ display: "flex", gap: 6, background: "#fff", borderRadius: 12, padding: 4, border: "1px solid #ece7e0", width: "fit-content" }}>
        {sek.map(s => (
          <button key={s.k} className="btn" onClick={() => setHatTab(s.k)} style={{ background: hatTab === s.k ? "#1a1a2e" : "transparent", color: hatTab === s.k ? "#fff" : "#78706a", padding: "7px 14px", fontSize: 13, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
            {s.e} <span className="mono" style={{ background: hatTab === s.k ? "rgba(255,255,255,.2)" : "#f1ede8", color: hatTab === s.k ? "#fff" : s.r, borderRadius: 10, padding: "1px 6px", fontSize: 10 }}>{s.s}</span>
          </button>
        ))}
      </div>
      <div className="mobileWrap" style={{ display: "flex", gap: 10 }}>
        <select className="giris" value={filtreIslem} onChange={e => setFiltreIslem(e.target.value)} style={{ width: "auto" }}>
          <option value="Tümü">Tüm İşlemler</option>
          {islemListesi.map(i => <option key={i.id}>{i.isim}</option>)}
        </select>
        <select className="giris" value={filtrePersonel} onChange={e => setFiltrePersonel(e.target.value)} style={{ width: "auto" }}>
          <option value="Tümü">Tüm Personel</option>
          {personelIsimleri.map(p => <option key={p}>{p}</option>)}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#9b8f88", alignSelf: "center" }}>{hatirlaticilar.length} hatırlatıcı</span>
      </div>
      <div className="kart tableCard" style={{ overflow: "hidden" }}>
        <table className="responsiveTable" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8f6f3", borderBottom: "1px solid #ece7e0" }}>
              {["Hasta", "İşlem", "Hatırlatıcı", "Tarih", "Gün", "Atanan", "Durum", "İşlemler"].map(b => (
                <th key={b} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", color: "#9b8f88", fontWeight: 500 }}>{b}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hatirlaticilar.length === 0 && <tr><td colSpan={8} style={{ padding: 48, textAlign: "center", color: "#b0a89e" }}>Bu görünümde hatırlatıcı yok</td></tr>}
            {hatirlaticilar.map(r => {
              const h = hastaHaritasi[r.hastaId]; const g = gunFarki(r.sonTarih);
              const gecmis = r.durum === "pending" && g < 0;
              const bugunMu = r.durum === "pending" && g === 0;
              const tamamlandi = r.durum === "done";
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid #f1ede8", background: tamamlandi ? "#fafaf8" : gecmis ? "#fff8f8" : bugunMu ? "#fffbeb" : "#fff", opacity: tamamlandi ? .75 : 1 }}>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{h?.isim}</div>
                    <div className="mono" style={{ fontSize: 11, color: "#9b8f88" }}>{h?.telefon}</div>
                  </td>
                  <td style={{ padding: "9px 12px" }}><IslemEtiketi islem={r.islem} /></td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: "#5a4a3a" }}>{r.etiket}</td>
                  <td style={{ padding: "9px 12px" }}><span className="mono" style={{ fontSize: 12 }}>{tarihKisa(r.sonTarih)}</span></td>
                  <td style={{ padding: "9px 12px" }}>
                    {!tamamlandi && <span className="mono" style={{ fontWeight: 700, fontSize: 13, color: g < 0 ? "#e11d48" : g === 0 ? "#d97706" : "#059669" }}>{g < 0 ? `-${Math.abs(g)}` : g === 0 ? "Bugün" : `+${g}`}</span>}
                    {tamamlandi  && <span style={{ fontSize: 11, color: "#9b8f88" }}>✓ {tarihKisa(r.tamamlananTarih)}</span>}
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <select style={{ background: "transparent", border: "none", fontSize: 12, color: "#5a4a3a", cursor: "pointer", fontFamily: "inherit", maxWidth: 120 }} value={r.atanan} onChange={e => personelAta(r.id, e.target.value)}>
                      {personelIsimleri.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    {tamamlandi  ? <span className="etiket" style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>Tamamlandı</span>
                    : gecmis     ? <span className="etiket" style={{ background: "#fff1f2", color: "#e11d48", border: "1px solid #fecdd3" }}>Geçmiş</span>
                    : bugunMu    ? <span className="etiket" style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a" }}>Bugün</span>
                    :              <span className="etiket" style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}>Yaklaşan</span>}
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {!tamamlandi && <>
                        <a href={`tel:${h?.telefon}`} onClick={() => iletisimKaydet(h?.id, h?.isim, "Arama", kullanici?.isim, r.etiket)}><Btn kk koyu>📞</Btn></a>
                        <a href={`https://wa.me/${h?.telefon?.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Merhaba ${h?.isim?.split(" ")[0]}, ${r.islem} için ${r.etiket} zamanı geldi! 😊`)}`} target="_blank" rel="noreferrer" onClick={() => { waGonderildi(r.id); iletisimKaydet(h?.id, h?.isim, "WhatsApp", kullanici?.isim, r.etiket); }}>
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

/* ══════════════════════════════════════════════════
   ANALİTİK — Admin hepsini görür, personel sadece kendini
══════════════════════════════════════════════════ */
function Analitik({ hastalar, tedaviler, hatirlaticilar, tamamlananHat, toplamGelir, aylikGelir, islemListesi, personelListesi, iletisimLog, kullanici }) {
  const isAdmin = kullanici?.rol === "admin";
  const [tab, setTab] = useState(isAdmin ? "genel" : "upsales");

  // Personel sadece kendi tedavilerini / upsaleslerini görür
  const benimTedaviler = isAdmin ? tedaviler : tedaviler.filter(t => t.personel === kullanici?.isim);
  const upTx      = benimTedaviler.filter(t => t.upsales);
  const topUp     = upTx.reduce((s, t) => s + (t.upsalesFiyat || 0), 0);
  const ayUp      = upTx.filter(t => t.tarih?.slice(0, 7) === bugun().slice(0, 7)).reduce((s, t) => s + (t.upsalesFiyat || 0), 0);

  const oran       = hatirlaticilar.length > 0 ? Math.round(tamamlananHat.length / hatirlaticilar.length * 100) : 0;

  const perSatis = personelListesi.map(p => {
    const px = tedaviler.filter(t => t.personel === p.isim);
    return { ...p, txSayisi: px.length, topSatis: px.reduce((s, t) => s + (t.fiyat || 0), 0), upSatis: px.filter(t => t.upsales).reduce((s, t) => s + (t.upsalesFiyat || 0), 0), aramaSayisi: iletisimLog.filter(l => l.personel === p.isim && l.yontem === "Arama").length, waSayisi: iletisimLog.filter(l => l.personel === p.isim && l.yontem === "WhatsApp").length };
  });

  const aylar = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const k = d.toISOString().slice(0, 7);
    const e = d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
    const gelir = tedaviler.filter(t => t.tarih?.slice(0, 7) === k).reduce((s, t) => s + (t.fiyat || 0), 0);
    const up    = tedaviler.filter(t => t.tarih?.slice(0, 7) === k && t.upsales).reduce((s, t) => s + (t.upsalesFiyat || 0), 0);
    const sayi  = tedaviler.filter(t => t.tarih?.slice(0, 7) === k).length;
    aylar.push({ k, e, gelir, up, sayi });
  }
  const maxG = Math.max(...aylar.map(a => a.gelir), 1);

  const adminSekmeleri = [{ k: "genel", e: "Genel Özet" }, { k: "personel", e: "Personel Raporu" }, { k: "upsales", e: "Upsales Raporu" }, { k: "iletisim", e: "İletişim Logu" }];
  const personelSekmeleri = [{ k: "upsales", e: "Upsales Yaptıklarım" }, { k: "iletisim", e: "İletişim Logum" }];
  const sekmeler = isAdmin ? adminSekmeleri : personelSekmeleri;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {!isAdmin && (
        <div className="kart" style={{ padding: 20, background: "#f0fdf4", border: "1px solid #a7f3d0" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#059669", marginBottom: 12 }}>📊 Benim Performansım</div>
          <div className="grid3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[{ e: "Yaptığım İşlem", d: benimTedaviler.length, r: "#7c3aed" }, { e: "Upsales Sayısı", d: upTx.length, r: "#ca8a04" }, { e: "Upsales Tutarım", d: paraFmt(topUp), r: "#059669" }].map(s => (
              <div key={s.e} style={{ background: "#fff", borderRadius: 10, padding: "12px 14px" }}>
                <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: s.r }}>{s.d}</div>
                <div style={{ fontSize: 12, color: "#9b8f88", marginTop: 3 }}>{s.e}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mobileScroll" style={{ display: "flex", gap: 6, background: "#fff", borderRadius: 12, padding: 4, border: "1px solid #ece7e0", width: "fit-content" }}>
        {sekmeler.map(s => <button key={s.k} className="btn" onClick={() => setTab(s.k)} style={{ background: tab === s.k ? "#1a1a2e" : "transparent", color: tab === s.k ? "#fff" : "#78706a", padding: "7px 16px", fontSize: 13, fontFamily: "inherit" }}>{s.e}</button>)}
      </div>

      {/* GENEL (sadece admin) */}
      {tab === "genel" && isAdmin && <>
        <div className="grid4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {[{ e: "Toplam Ciro", d: paraFmt(toplamGelir), r: "#0369a1" }, { e: "Bu Ay Ciro", d: paraFmt(aylikGelir), r: "#059669" }, { e: "Toplam Upsales", d: paraFmt(tedaviler.filter(t => t.upsales).reduce((s, t) => s + t.upsalesFiyat, 0)), r: "#ca8a04" }, { e: "Tamamlanma Oranı", d: `%${oran}`, r: "#7c3aed" }].map(k => (
            <div key={k.e} className="kart" style={{ padding: "18px 20px" }}>
              <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: k.r }}>{k.d}</div>
              <div style={{ fontSize: 12, color: "#9b8f88", marginTop: 4 }}>{k.e}</div>
            </div>
          ))}
        </div>
        <div className="kart" style={{ padding: 24 }}>
          <BolumBasligi ikon="📈" baslik="Aylık Ciro (Son 6 Ay)" />
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 130, marginTop: 16 }}>
            {aylar.map(a => (
              <div key={a.k} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span className="mono" style={{ fontSize: 10, color: "#9b8f88" }}>{Math.round(a.gelir / 1000)}B</span>
                <div style={{ width: "100%", background: "linear-gradient(to top,#1a1a2e,#4a4a6e)", borderRadius: "6px 6px 0 0", height: `${Math.max(a.gelir / maxG * 100, a.gelir > 0 ? 6 : 0)}px`, transition: "height .6s", display: "flex", justifyContent: "center", paddingTop: 4 }}>
                  {a.sayi > 0 && <div style={{ fontSize: 10, color: "#fff" }}>{a.sayi}</div>}
                </div>
                {a.up > 0 && <div style={{ width: "100%", background: "#ca8a04", borderRadius: "3px 3px 0 0", height: `${Math.max(a.up / maxG * 100, 3)}px` }} />}
                <span style={{ fontSize: 10, color: "#9b8f88" }}>{a.e}</span>
              </div>
            ))}
          </div>
        </div>
      </>}

      {/* PERSONEL RAPORU (sadece admin) */}
      {tab === "personel" && isAdmin && (
        <div className="kart tableCard" style={{ overflow: "hidden" }}>
          <table className="responsiveTable" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f8f6f3", borderBottom: "1px solid #ece7e0" }}>{["Personel", "Rol", "İşlem", "Toplam Satış", "Upsales", "📞 Arama", "💬 WhatsApp"].map(b => <th key={b} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#9b8f88", fontWeight: 500 }}>{b}</th>)}</tr></thead>
            <tbody>
              {perSatis.map(p => (
                <tr key={p.id} style={{ borderBottom: "1px solid #f1ede8" }}>
                  <td style={{ padding: "11px 14px" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar isim={p.isim} boyut={30} /><span style={{ fontWeight: 600, fontSize: 14 }}>{p.isim}</span></div></td>
                  <td style={{ padding: "11px 14px" }}><span style={{ fontSize: 11, color: p.rol === "admin" ? "#e11d48" : "#9b8f88", background: p.rol === "admin" ? "#fff1f2" : "#f1ede8", padding: "2px 8px", borderRadius: 6 }}>{p.rol}</span></td>
                  <td style={{ padding: "11px 14px" }}><span className="mono" style={{ fontWeight: 700 }}>{p.txSayisi}</span></td>
                  <td style={{ padding: "11px 14px" }}><span className="mono" style={{ fontWeight: 700, color: "#059669" }}>{paraFmt(p.topSatis)}</span></td>
                  <td style={{ padding: "11px 14px" }}><span className="mono" style={{ fontWeight: 700, color: "#ca8a04" }}>{paraFmt(p.upSatis)}</span></td>
                  <td style={{ padding: "11px 14px" }}><span className="mono" style={{ color: "#2563eb" }}>{p.aramaSayisi}</span></td>
                  <td style={{ padding: "11px 14px" }}><span className="mono" style={{ color: "#059669" }}>{p.waSayisi}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* UPSALES (admin hepsini, personel kendini) */}
      {tab === "upsales" && <>
        <div className="grid3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {[{ e: isAdmin ? "Toplam Upsales" : "Benim Upsalesim", d: paraFmt(topUp), r: "#ca8a04" }, { e: "Bu Ay", d: paraFmt(ayUp), r: "#059669" }, { e: "Upsales Sayısı", d: upTx.length, r: "#7c3aed" }].map(k => (
            <div key={k.e} className="kart" style={{ padding: "18px 20px" }}>
              <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: k.r }}>{k.d}</div>
              <div style={{ fontSize: 12, color: "#9b8f88", marginTop: 4 }}>{k.e}</div>
            </div>
          ))}
        </div>
        <div className="kart tableCard" style={{ overflow: "hidden" }}>
          <table className="responsiveTable" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#fefce8", borderBottom: "1px solid #fde68a" }}>{["Ana İşlem", "Upsales İşlem", "Upsales Tutarı", "Personel", "Tarih"].map(b => <th key={b} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#92400e", fontWeight: 500 }}>{b}</th>)}</tr></thead>
            <tbody>
              {upTx.length === 0 && <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#b0a89e" }}>Henüz upsales kaydı yok</td></tr>}
              {[...upTx].sort((a, b) => b.tarih?.localeCompare(a.tarih)).map(t => (
                <tr key={t.id} style={{ borderBottom: "1px solid #f1ede8" }}>
                  <td style={{ padding: "10px 14px" }}><IslemEtiketi islem={t.islem} /></td>
                  <td style={{ padding: "10px 14px", fontSize: 13, color: "#ca8a04", fontWeight: 500 }}>{t.upsalesIslem || "—"}</td>
                  <td style={{ padding: "10px 14px" }}><span className="mono" style={{ fontWeight: 700, color: "#ca8a04" }}>{paraFmt(t.upsalesFiyat)}</span></td>
                  <td style={{ padding: "10px 14px", fontSize: 13 }}>{t.personel || "—"}</td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: "#9b8f88" }}>{tarihFmt(t.tarih)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      {/* İLETİŞİM (admin hepsini, personel kendini) */}
      {tab === "iletisim" && (
        <div className="kart tableCard" style={{ overflow: "hidden" }}>
          <table className="responsiveTable" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f8f6f3", borderBottom: "1px solid #ece7e0" }}>{["Tarih & Saat", "Hasta", "Personel", "Yöntem", "Hatırlatıcı"].map(b => <th key={b} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#9b8f88", fontWeight: 500 }}>{b}</th>)}</tr></thead>
            <tbody>
              {(isAdmin ? iletisimLog : iletisimLog.filter(l => l.personel === kullanici?.isim)).length === 0 && <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#b0a89e" }}>Henüz iletişim kaydı yok</td></tr>}
              {(isAdmin ? iletisimLog : iletisimLog.filter(l => l.personel === kullanici?.isim)).slice(0, 100).map(l => (
                <tr key={l.id} style={{ borderBottom: "1px solid #f1ede8" }}>
                  <td style={{ padding: "9px 14px" }}><span className="mono" style={{ fontSize: 11, color: "#9b8f88" }}>{l.tarih} {l.saat}</span></td>
                  <td style={{ padding: "9px 14px", fontWeight: 600, fontSize: 13 }}>{l.hastaIsim}</td>
                  <td style={{ padding: "9px 14px", fontSize: 13 }}>{l.personel}</td>
                  <td style={{ padding: "9px 14px" }}><span className="etiket" style={{ background: l.yontem === "WhatsApp" ? "#f0fdf4" : "#eff6ff", color: l.yontem === "WhatsApp" ? "#059669" : "#2563eb", border: `1px solid ${l.yontem === "WhatsApp" ? "#a7f3d0" : "#bfdbfe"}` }}>{l.yontem === "WhatsApp" ? "💬 WA" : "📞 Arama"}</span></td>
                  <td style={{ padding: "9px 14px", fontSize: 12, color: "#9b8f88" }}>{l.etiket}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   AYARLAR (sadece admin)
══════════════════════════════════════════════════ */
function Ayarlar({ personelListesi, onPersonelGuncelle, islemListesi, onIslemGuncelle, bildirimGoster }) {
  const [tab, setTab]         = useState("personel");
  const [personeller, setP]   = useState(personelListesi);
  const [islemler, setI]      = useState(islemListesi);
  const [yeniP, setYeniP]     = useState({ isim: "", rol: "personel", pin: "" });
  const [yeniI, setYeniI]     = useState({ isim: "", renk: "#8b5cf6" });

  const personelEkle = () => {
    if (!yeniP.isim || !yeniP.pin) return;
    if (yeniP.rol === "admin" && yeniP.pin.length !== 6) { bildirimGoster("Admin PIN 6 haneli olmalı!", "uyari"); return; }
    const l = [...personeller, { id: uid(), ...yeniP }]; setP(l); onPersonelGuncelle(l);
    setYeniP({ isim: "", rol: "personel", pin: "" }); bildirimGoster("Personel eklendi ✓");
  };
  const personelSil = (id) => { const l = personeller.filter(p => p.id !== id); setP(l); onPersonelGuncelle(l); bildirimGoster("Personel silindi", "uyari"); };
  const pinGuncelle = (id, yeniPin) => {
    const p = personeller.find(x => x.id === id);
    if (p?.rol === "admin" && yeniPin.length !== 6) { bildirimGoster("Admin PIN 6 haneli olmalı!", "uyari"); return; }
    const l = personeller.map(p => p.id === id ? { ...p, pin: yeniPin } : p); setP(l); onPersonelGuncelle(l); bildirimGoster("PIN güncellendi ✓");
  };
  const islemEkle = () => {
    if (!yeniI.isim) return;
    const l = [...islemler, { id: uid(), isim: yeniI.isim, renk: yeniI.renk, hatirlaticilar: [{ etiket: "2 Hafta Kontrolü", gun: 14 }, { etiket: "3 Ay Takip", gun: 90 }] }];
    setI(l); onIslemGuncelle(l); setYeniI({ isim: "", renk: "#8b5cf6" }); bildirimGoster("İşlem türü eklendi ✓");
  };
  const islemSil    = (id) => { const l = islemler.filter(i => i.id !== id); setI(l); onIslemGuncelle(l); };
  const hatGuncelle = (iId, idx, alan, val) => { const l = islemler.map(i => i.id !== iId ? i : { ...i, hatirlaticilar: i.hatirlaticilar.map((h, j) => j !== idx ? h : { ...h, [alan]: alan === "gun" ? Number(val) : val }) }); setI(l); onIslemGuncelle(l); };
  const hatEkle     = (iId) => { const l = islemler.map(i => i.id !== iId ? i : { ...i, hatirlaticilar: [...i.hatirlaticilar, { etiket: "Yeni Hatırlatıcı", gun: 30 }] }); setI(l); onIslemGuncelle(l); };
  const hatSil      = (iId, idx) => { const l = islemler.map(i => i.id !== iId ? i : { ...i, hatirlaticilar: i.hatirlaticilar.filter((_, j) => j !== idx) }); setI(l); onIslemGuncelle(l); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 860 }}>
      <div className="mobileScroll" style={{ display: "flex", gap: 6, background: "#fff", borderRadius: 12, padding: 4, border: "1px solid #ece7e0", width: "fit-content" }}>
        {[{ k: "personel", e: "👥 Personel Yönetimi" }, { k: "islem", e: "🧴 İşlem & Hatırlatıcı Ayarları" }].map(s => (
          <button key={s.k} className="btn" onClick={() => setTab(s.k)} style={{ background: tab === s.k ? "#1a1a2e" : "transparent", color: tab === s.k ? "#fff" : "#78706a", padding: "7px 18px", fontSize: 13, fontFamily: "inherit" }}>{s.e}</button>
        ))}
      </div>

      {tab === "personel" && <>
        <div className="kart tableCard" style={{ overflow: "hidden" }}>
          <table className="responsiveTable" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f8f6f3", borderBottom: "1px solid #ece7e0" }}>{["Personel", "Rol", "PIN", "İşlem"].map(b => <th key={b} style={{ padding: "11px 16px", textAlign: "left", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#9b8f88", fontWeight: 500 }}>{b}</th>)}</tr></thead>
            <tbody>{personeller.map(p => <PersonelSatiri key={p.id} p={p} onSil={personelSil} onPinGuncelle={pinGuncelle} />)}</tbody>
          </table>
        </div>
        <div className="kart" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>➕ Yeni Personel Ekle</div>
          <div className="settingsGrid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
            <div><div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 5 }}>Ad Soyad</div><input className="giris" placeholder="İsim Soyisim" value={yeniP.isim} onChange={e => setYeniP(p => ({ ...p, isim: e.target.value }))} /></div>
            <div><div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 5 }}>Rol</div><select className="giris" value={yeniP.rol} onChange={e => setYeniP(p => ({ ...p, rol: e.target.value }))}><option value="personel">Personel</option><option value="admin">Admin</option></select></div>
            <div><div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 5 }}>PIN {yeniP.rol === "admin" ? "(6 hane)" : "(4-6 hane)"}</div><input className="giris" placeholder="PIN" type="password" maxLength={6} value={yeniP.pin} onChange={e => setYeniP(p => ({ ...p, pin: e.target.value }))} /></div>
            <Btn onClick={personelEkle} koyu style={{ padding: "9px 20px" }}>+ Ekle</Btn>
          </div>
        </div>
      </>}

      {tab === "islem" && <>
        {islemler.map(i => (
          <div key={i.id} className="kart" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", background: i.renk, flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{i.isim}</span>
              <button onClick={() => islemSil(i.id)} style={{ background: "none", border: "none", color: "#e11d48", cursor: "pointer", fontSize: 13 }}>✕ Sil</button>
            </div>
            <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 8, fontWeight: 600 }}>Hatırlatıcı Günleri</div>
            {i.hatirlaticilar.map((h, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7 }}>
                <input className="giris" value={h.etiket} onChange={e => hatGuncelle(i.id, idx, "etiket", e.target.value)} style={{ flex: 2 }} />
                <input className="giris" type="number" value={h.gun} onChange={e => hatGuncelle(i.id, idx, "gun", e.target.value)} style={{ width: 80 }} />
                <span style={{ fontSize: 12, color: "#9b8f88", whiteSpace: "nowrap" }}>gün sonra</span>
                <button onClick={() => hatSil(i.id, idx)} style={{ background: "none", border: "none", color: "#e11d48", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
              </div>
            ))}
            <button onClick={() => hatEkle(i.id)} style={{ background: "none", border: "1px dashed #d6cfc6", borderRadius: 8, padding: "6px 14px", color: "#9b8f88", cursor: "pointer", fontSize: 13, marginTop: 4 }}>+ Hatırlatıcı Ekle</button>
          </div>
        ))}
        <div className="kart" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>➕ Yeni İşlem Türü Ekle</div>
          <div className="mobileWrap" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 5 }}>İşlem Adı</div><input className="giris" placeholder="Örn: PRP, Hydrafacial, Plazma…" value={yeniI.isim} onChange={e => setYeniI(p => ({ ...p, isim: e.target.value }))} /></div>
            <div><div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 5 }}>Renk</div><input type="color" value={yeniI.renk} onChange={e => setYeniI(p => ({ ...p, renk: e.target.value }))} style={{ width: 46, height: 40, border: "1.5px solid #e4ddd5", borderRadius: 9, cursor: "pointer", padding: 2 }} /></div>
            <Btn onClick={islemEkle} koyu style={{ padding: "9px 20px" }}>+ Ekle</Btn>
          </div>
        </div>
      </>}
    </div>
  );
}

function PersonelSatiri({ p, onSil, onPinGuncelle }) {
  const [duzelt, setDuzelt] = useState(false);
  const [yeniPin, setYeniPin] = useState("");
  return (
    <tr style={{ borderBottom: "1px solid #f1ede8" }}>
      <td style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Avatar isim={p.isim} boyut={32} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{p.isim}</span>
        </div>
      </td>
      <td style={{ padding: "12px 16px" }}>
        <span style={{ fontSize: 11, color: p.rol === "admin" ? "#e11d48" : "#9b8f88", background: p.rol === "admin" ? "#fff1f2" : "#f1ede8", padding: "3px 9px", borderRadius: 6, fontWeight: 600 }}>
          {p.rol === "admin" ? "👑 Admin" : "Personel"}
        </span>
      </td>
      <td style={{ padding: "12px 16px" }}>
        {duzelt ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input type="password" className="giris" placeholder="Yeni PIN" maxLength={6} value={yeniPin} onChange={e => setYeniPin(e.target.value)} style={{ width: 110 }} />
            <Btn kk koyu onClick={() => { onPinGuncelle(p.id, yeniPin); setDuzelt(false); setYeniPin(""); }}>Kaydet</Btn>
            <Btn kk onClick={() => { setDuzelt(false); setYeniPin(""); }} style={{ background: "#f1ede8", color: "#78706a" }}>İptal</Btn>
          </div>
        ) : (
          <button onClick={() => setDuzelt(true)} style={{ background: "none", border: "1px dashed #d6cfc6", borderRadius: 7, padding: "4px 12px", color: "#9b8f88", cursor: "pointer", fontSize: 13 }}>{"•".repeat(p.pin.length)} ✏️ Değiştir</button>
        )}
      </td>
      <td style={{ padding: "12px 16px" }}>
        <button onClick={() => onSil(p.id)} style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 7, padding: "5px 14px", color: "#e11d48", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Sil</button>
      </td>
    </tr>
  );
}

/* ══════════════════════════════════════════════════
   PROFİL MODALİ
══════════════════════════════════════════════════ */
function ProfilModal({ hasta, tedaviler, hatirlaticilar, onKapat, onTedaviEkle, onTedaviGuncelle, onSil, onHastaGuncelle, tamamlaIsaretle, bekleyeAl, kullanici, isAdmin, islemListesi, iletisimKaydet, ilkTedaviAc, onYeniIslemTuru }) {
  const bosTxForm = () => ({ islem: islemListesi[0]?.isim || "Botox", tarih: bugun(), fiyat: "", notlar: "", upsales: false, upsalesIslem: "", upsalesFiyat: "", ozelHatirlaticilar: null });
  const [hastaForm, setHastaForm] = useState(() => ({ isim: hasta.isim, ...telefonuParcala(hasta.telefon) }));
  const [notlar, setNotlar] = useState(hasta.notlar || "");
  const [tedaviEk, setTedaviEk] = useState(Boolean(ilkTedaviAc));
  const [bilgiKaydedildi, setBilgiKaydedildi] = useState(false);
  const [notKaydedildi, setNotKaydedildi] = useState(false);
  const [duzenlenenTedaviId, setDuzenlenenTedaviId] = useState(null);
  const [txForm, setTxForm] = useState(bosTxForm);
  const [hatTmpl, setHatTmpl] = useState([]);
  const [yeniIslemAdi, setYeniIslemAdi] = useState("");

  useEffect(() => {
    setHastaForm({ isim: hasta.isim, ...telefonuParcala(hasta.telefon) });
    setNotlar(hasta.notlar || "");
    setTedaviEk(Boolean(ilkTedaviAc));
  }, [hasta.id, hasta.isim, hasta.telefon, hasta.notlar, ilkTedaviAc]);

  useEffect(() => {
    if (txForm.ozelHatirlaticilar?.length) {
      setHatTmpl(txForm.ozelHatirlaticilar.map(h => ({ ...h })));
      return;
    }
    const b = islemListesi.find(i => i.isim === txForm.islem);
    setHatTmpl(b?.hatirlaticilar ? b.hatirlaticilar.map(h => ({ ...h })) : []);
  }, [txForm.islem, txForm.ozelHatirlaticilar, islemListesi]);

  const hatGuncelle = (idx, alan, val) => {
    const y = [...hatTmpl];
    y[idx] = { ...y[idx], [alan]: alan === "gun" ? Number(val) : val };
    setHatTmpl(y);
    setTxForm(f => ({ ...f, ozelHatirlaticilar: y }));
  };
  const hastaPayload = () => ({ isim: hastaForm.isim, ulkeKodu: hastaForm.ulkeKodu, telefon: telefonuBirlestir(hastaForm.ulkeKodu, hastaForm.numara), notlar });
  const bilgiKaydet = async () => {
    if (!hastaForm.isim || !hastaForm.numara) return;
    const kaydedildi = await onHastaGuncelle(hastaPayload());
    if (kaydedildi) {
      setBilgiKaydedildi(true);
      setTimeout(() => setBilgiKaydedildi(false), 1500);
    }
  };
  const notlarKaydet = async () => {
    const kaydedildi = await onHastaGuncelle(hastaPayload());
    if (kaydedildi) {
      setNotKaydedildi(true);
      setTimeout(() => setNotKaydedildi(false), 1500);
    }
  };
  const tedaviFormunuSifirla = () => {
    setTedaviEk(false);
    setDuzenlenenTedaviId(null);
    setTxForm(bosTxForm());
    setHatTmpl([]);
  };
  const tedaviDuzenle = (tedavi) => {
    const bekleyenTedaviHat = hatirlaticilar
      .filter(r => r.tedaviId === tedavi.id && r.durum === "pending")
      .sort((a, b) => a.sonTarih.localeCompare(b.sonTarih));
    const mevcutHatTmpl = bekleyenTedaviHat.length > 0
      ? bekleyenTedaviHat.map(r => ({ etiket: r.etiket, gun: Math.max(0, Math.round((new Date(r.sonTarih) - new Date(tedavi.tarih)) / 86400000)) }))
      : (islemListesi.find(i => i.isim === tedavi.islem)?.hatirlaticilar || []).map(h => ({ ...h }));
    setDuzenlenenTedaviId(tedavi.id);
    setTxForm({
      islem: tedavi.islem,
      tarih: tedavi.tarih || bugun(),
      fiyat: tedavi.fiyat ? String(tedavi.fiyat) : "",
      notlar: tedavi.notlar || "",
      upsales: Boolean(tedavi.upsales),
      upsalesIslem: tedavi.upsalesIslem || "",
      upsalesFiyat: tedavi.upsalesFiyat ? String(tedavi.upsalesFiyat) : "",
      ozelHatirlaticilar: mevcutHatTmpl,
    });
    setHatTmpl(mevcutHatTmpl);
    setTedaviEk(true);
  };
  const tedaviKaydet = async () => {
    if (!txForm.tarih) return;
    const payload = { ...txForm, ozelHatirlaticilar: txForm.ozelHatirlaticilar || hatTmpl };
    const kaydedildi = duzenlenenTedaviId
      ? await onTedaviGuncelle(duzenlenenTedaviId, payload)
      : await onTedaviEkle(payload);
    if (kaydedildi) tedaviFormunuSifirla();
  };
  const yeniIslemEkle = () => {
    const ad = yeniIslemAdi.trim();
    if (!ad) return;
    const eklenen = onYeniIslemTuru?.(ad) || ad;
    setTxForm(f => ({ ...f, islem: eklenen, ozelHatirlaticilar: null }));
    setYeniIslemAdi("");
  };

  const bekleyenHat = hatirlaticilar.filter(r => r.durum === "pending").sort((a, b) => a.sonTarih.localeCompare(b.sonTarih));
  const tamamlHat = hatirlaticilar.filter(r => r.durum === "done");
  const toplamHarcama = tedaviler.reduce((s, t) => s + (t.fiyat || 0), 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "28px 16px", backdropFilter: "blur(5px)", overflowY: "auto" }} onClick={onKapat}>
      <div className="profileModalBox" style={{ background: "#fff", borderRadius: 22, width: 940, maxWidth: "100%", boxShadow: "0 40px 100px rgba(0,0,0,.3)", animation: "yukariCik .25s ease", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div className="profileHeader" style={{ background: "linear-gradient(135deg,#1a1a2e,#16213e)", padding: "22px 26px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar isim={hasta.isim} boyut={48} />
            <div>
              <div style={{ fontSize: 21, fontWeight: 700, color: "#fff" }}>{hasta.isim}</div>
              <div className="mono" style={{ fontSize: 11, color: "#9b9bbb" }}>ID: {hasta.id}</div>
            </div>
          </div>
          <div className="profileActions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a href={`tel:${hasta.telefon}`} onClick={() => iletisimKaydet(hasta.id, hasta.isim, "Arama", kullanici?.isim, "—")}>
              <Btn style={{ background: "rgba(255,255,255,.12)", color: "#fff" }}>📞 {hasta.telefon}</Btn>
            </a>
            <a href={`https://wa.me/${hasta.telefon.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" onClick={() => iletisimKaydet(hasta.id, hasta.isim, "WhatsApp", kullanici?.isim, "—")}>
              <Btn style={{ background: "#059669", color: "#fff" }}>💬 WhatsApp</Btn>
            </a>
            {!tedaviEk && <Btn onClick={() => { setDuzenlenenTedaviId(null); setTedaviEk(true); }} style={{ background: "#e11d48", color: "#fff" }}>+ Tedavi Ekle</Btn>}
            <button onClick={onKapat} style={{ background: "none", border: "none", color: "#9b9bbb", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
        </div>

        <div className="profileGrid" style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
              {[
                { e: "Tedavi", d: tedaviler.length, r: "#7c3aed" },
                { e: "Bekleyen", d: bekleyenHat.length, r: "#e11d48" },
                { e: isAdmin ? "Harcama" : "Upsales", d: isAdmin ? paraFmt(toplamHarcama) : tedaviler.filter(t => t.upsales).length, r: isAdmin ? "#059669" : "#ca8a04" },
              ].map(s => (
                <div key={s.e} style={{ background: "#f8f6f3", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: s.r }}>{s.d}</div>
                  <div style={{ fontSize: 11, color: "#9b8f88" }}>{s.e}</div>
                </div>
              ))}
            </div>

            <div className="kart" style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Hasta Bilgileri</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input className="giris" value={hastaForm.isim} onChange={e => setHastaForm(f => ({ ...f, isim: e.target.value }))} placeholder="Ad Soyad" />
                <div className="mobileWrap" style={{ display: "flex", gap: 8 }}>
                  <input className="giris" value={hastaForm.ulkeKodu} onChange={e => setHastaForm(f => ({ ...f, ulkeKodu: e.target.value.startsWith("+") ? e.target.value : `+${e.target.value.replace(/\+/g, "")}` }))} placeholder="+90" style={{ maxWidth: 100 }} />
                  <input className="giris" type="tel" value={hastaForm.numara} onChange={e => setHastaForm(f => ({ ...f, numara: e.target.value }))} placeholder="532 000 0000" style={{ flex: 1 }} />
                </div>
                <Btn onClick={bilgiKaydet} koyu style={{ width: "100%", background: bilgiKaydedildi ? "#059669" : "#1a1a2e", fontWeight: 600 }}>
                  {bilgiKaydedildi ? "✓ Bilgiler Kaydedildi" : "Bilgileri Kaydet"}
                </Btn>
              </div>
            </div>

            {tedaviEk && (
              <div style={{ background: "#f8f6f3", borderRadius: 14, padding: 18, border: "2px solid #1a1a2e" }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: "#1a1a2e" }}>{duzenlenenTedaviId ? "🛠 Tedaviyi Düzenle" : "🧴 Yeni Tedavi Ekle"}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <select className="giris" value={txForm.islem} onChange={e => setTxForm(f => ({ ...f, islem: e.target.value, ozelHatirlaticilar: null }))}>
                    {islemListesi.map(i => <option key={i.id}>{i.isim}</option>)}
                  </select>
                  <div className="mobileWrap" style={{ display: "flex", gap: 8 }}>
                    <input className="giris" placeholder="Listede yoksa yeni tedavi adı" value={yeniIslemAdi} onChange={e => setYeniIslemAdi(e.target.value)} />
                    <Btn onClick={yeniIslemEkle} style={{ background: "#eef5ff", color: "#1d4ed8", border: "1px solid #bfdbfe", whiteSpace: "nowrap" }}>Listeye Ekle</Btn>
                  </div>

                  <div style={{ background: "#fff", borderRadius: 10, padding: "12px 14px", border: "1px solid #e4ddd5" }}>
                    <div style={{ fontSize: 12, color: "#9b8f88", fontWeight: 600, marginBottom: 10 }}>🔔 Hatırlatıcı Günleri</div>
                    {hatTmpl.map((h, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 7 }}>
                        <input className="giris" value={h.etiket} onChange={e => hatGuncelle(idx, "etiket", e.target.value)} style={{ flex: 2, fontSize: 12 }} />
                        <input type="number" className="giris" value={h.gun} onChange={e => hatGuncelle(idx, "gun", e.target.value)} style={{ width: 68, fontSize: 12 }} />
                        <span style={{ fontSize: 11, color: "#9b8f88" }}>gün</span>
                      </div>
                    ))}
                  </div>

                  <input type="date" className="giris" value={txForm.tarih} onChange={e => setTxForm(f => ({ ...f, tarih: e.target.value }))} />
                  <input className="giris" type="number" placeholder="Ücret (₺)" value={txForm.fiyat} onChange={e => setTxForm(f => ({ ...f, fiyat: e.target.value }))} />
                  <textarea className="giris" rows={2} placeholder="Notlar…" value={txForm.notlar} onChange={e => setTxForm(f => ({ ...f, notlar: e.target.value }))} style={{ resize: "none" }} />

                  <div style={{ background: "#fffbeb", border: "2px solid #fde68a", borderRadius: 10, padding: "12px 14px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontWeight: 700, fontSize: 14, color: "#92400e" }}>
                      <input type="checkbox" checked={txForm.upsales} onChange={e => setTxForm(f => ({ ...f, upsales: e.target.checked }))} style={{ width: 18, height: 18, cursor: "pointer" }} />
                      ⬆ Upsales yapıldı mı?
                    </label>
                    {txForm.upsales && (
                      <div className="mobileWrap" style={{ display: "flex", gap: 9, marginTop: 12 }}>
                        <input className="giris" placeholder="Upsales işlem adı" value={txForm.upsalesIslem} onChange={e => setTxForm(f => ({ ...f, upsalesIslem: e.target.value }))} style={{ flex: 2 }} />
                        <input className="giris" type="number" placeholder="₺ Tutar" value={txForm.upsalesFiyat} onChange={e => setTxForm(f => ({ ...f, upsalesFiyat: e.target.value }))} style={{ flex: 1 }} />
                      </div>
                    )}
                  </div>

                  <div className="mobileWrap" style={{ display: "flex", gap: 8 }}>
                    <Btn onClick={tedaviFormunuSifirla} style={{ background: "#f1ede8", color: "#78706a", flex: 1 }}>İptal</Btn>
                    <Btn onClick={tedaviKaydet} koyu style={{ flex: 2, fontWeight: 700 }}>{duzenlenenTedaviId ? "Tedaviyi Güncelle" : "Tedaviyi Kaydet"}</Btn>
                  </div>
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Klinik Notları</div>
              <textarea className="giris" rows={3} value={notlar} onChange={e => setNotlar(e.target.value)} placeholder="Alerji, tercih, gözlem…" style={{ resize: "vertical" }} />
              <Btn onClick={notlarKaydet} koyu style={{ width: "100%", marginTop: 8, background: notKaydedildi ? "#059669" : "#1a1a2e", fontWeight: 600 }}>{notKaydedildi ? "✓ Notlar Kaydedildi" : "Notları Kaydet"}</Btn>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Tedavi Geçmişi</div>
              {tedaviler.length === 0 ? <Bos metin="Henüz tedavi yok" /> :
                [...tedaviler].sort((a, b) => b.tarih?.localeCompare(a.tarih)).map(t => (
                  <div key={t.id} style={{ background: "#f8f6f3", borderRadius: 10, padding: "10px 14px", marginBottom: 7, border: "1px solid #ece7e0" }}>
                    <div className="mobileWrap" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <IslemEtiketi islem={t.islem} />
                      <span style={{ fontSize: 12, color: "#9b8f88" }}>{tarihFmt(t.tarih)}</span>
                      {t.upsales && (
                        <span style={{ background: "#fefce8", color: "#ca8a04", border: "1px solid #fde68a", borderRadius: 5, padding: "1px 7px", fontSize: 11, fontWeight: 600 }}>
                          ⬆ {t.upsalesIslem}{isAdmin ? ` · ${paraFmt(t.upsalesFiyat)}` : ""}
                        </span>
                      )}
                      {isAdmin && t.fiyat > 0 && <span className="mono" style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "#059669" }}>{paraFmt(t.fiyat)}</span>}
                      <Btn kk onClick={() => tedaviDuzenle(t)} style={{ background: "#fff", border: "1px solid #d6cfc6", color: "#5a4a3a" }}>Düzenle</Btn>
                    </div>
                    {t.notlar && <div style={{ fontSize: 12, color: "#78706a" }}>{t.notlar}</div>}
                    <div style={{ fontSize: 11, color: "#b0a89e", marginTop: 3 }}>Personel: {t.personel || "—"}</div>
                  </div>
                ))
              }
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Yaklaşan Hatırlatıcılar</div>
              {bekleyenHat.length === 0 ? <Bos metin="Bekleyen hatırlatıcı yok 🎉" /> :
                bekleyenHat.map(r => {
                  const g = gunFarki(r.sonTarih);
                  return (
                    <div key={r.id} style={{ background: g < 0 ? "#fff8f8" : g === 0 ? "#fffbeb" : "#f8f6f3", borderRadius: 10, padding: "11px 14px", marginBottom: 7, border: `1px solid ${g < 0 ? "#fecdd3" : g === 0 ? "#fde68a" : "#ece7e0"}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                        <IslemEtiketi islem={r.islem} kucuk />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{r.etiket}</span>
                        <span className="mono" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: g < 0 ? "#e11d48" : g === 0 ? "#d97706" : "#059669" }}>
                          {g < 0 ? `${Math.abs(g)}g gecikti` : g === 0 ? "Bugün" : `${g}g sonra`}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#9b8f88", marginBottom: 8 }}>{tarihFmt(r.sonTarih)}</div>
                      <div style={{ display: "flex", gap: 7 }}>
                        <a href={`tel:${hasta.telefon}`} onClick={() => iletisimKaydet(hasta.id, hasta.isim, "Arama", kullanici?.isim, r.etiket)}><Btn kk koyu>📞</Btn></a>
                        <a href={`https://wa.me/${hasta.telefon.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Merhaba ${hasta.isim.split(" ")[0]}, ${r.islem} için ${r.etiket} zamanı geldi! 😊`)}`} target="_blank" rel="noreferrer" onClick={() => iletisimKaydet(hasta.id, hasta.isim, "WhatsApp", kullanici?.isim, r.etiket)}>
                          <Btn kk style={{ background: "#f0fdf4", color: "#059669", border: "1px solid #a7f3d0" }}>💬</Btn>
                        </a>
                        <Btn kk onClick={() => tamamlaIsaretle(r.id)} style={{ background: "#1a1a2e", color: "#fff", flex: 1, fontWeight: 600 }}>✓ Tamamlandı</Btn>
                      </div>
                    </div>
                  );
                })
              }
            </div>

            {tamamlHat.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "#9b8f88", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Tamamlananlar ({tamamlHat.length})</div>
                {tamamlHat.map(r => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #a7f3d0", marginBottom: 5 }}>
                    <span style={{ color: "#059669", fontSize: 14 }}>✓</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#059669" }}>{r.etiket}</span>
                      <span style={{ fontSize: 11, color: "#9b8f88", marginLeft: 8 }}>{tarihKisa(r.tamamlananTarih)} · {r.tamamlayan}</span>
                    </div>
                    <button onClick={() => bekleyeAl(r.id)} style={{ background: "none", border: "none", color: "#9b8f88", cursor: "pointer", fontSize: 12 }}>↩</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {isAdmin && (
          <div style={{ padding: "0 24px 22px", display: "flex", justifyContent: "flex-end" }}>
            <button className="btn" onClick={onSil} style={{ background: "#fff1f2", color: "#e11d48", border: "1px solid #fecdd3", padding: "8px 20px", fontSize: 13, fontWeight: 600 }}>🗑 Hastayı Sil</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   AI ÖZET
══════════════════════════════════════════════════ */
function OzetPaneli({ hastalar, hatirlaticilar, hastaHaritasi, bugunHat, gecmisHat, bildirimGoster }) {
  const [ozet, setOzet] = useState(""); const [yukl, setYukl] = useState(false); const [kopyalandi, setKopyalandi] = useState(false);
  const baglamOlustur = () => {
    const acil = [...gecmisHat, ...bugunHat].map(r => { const h = hastaHaritasi[r.hastaId]; const g = gunFarki(r.sonTarih); return `- ${h?.isim} (${h?.telefon}) | ${r.islem} | ${r.etiket} | ${g < 0 ? `${Math.abs(g)} GÜN GECİKTİ` : "BUGÜN"} | Atanan: ${r.atanan}`; }).join("\n");
    return `Bugün: ${new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}\n\nGeçmiş: ${gecmisHat.length} | Bugün: ${bugunHat.length} | Toplam Hasta: ${hastalar.length}\n\nACİL:\n${acil || "Yok"}`;
  };
  const ozetOlustur = async () => {
    setYukl(true); setOzet("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: `Sen ${KLINIK_ADI} için çalışan klinik koordinatör asistanısın. Estetik klinik personeli için kısa, sıcak günlük brifing e-postaları yazıyorsun. Türkçe yaz. 250 kelimeden az.`, messages: [{ role: "user", content: `Günlük brifing e-postası yaz:\n\n${baglamOlustur()}` }] }) });
      const veri = await res.json();
      setOzet(veri.content?.map(c => c.text || "").join("") || "Özet oluşturulamadı.");
    } catch { setOzet("Hata oluştu. Tekrar deneyin."); }
    setYukl(false);
  };
  const kopyala = () => { navigator.clipboard.writeText(ozet); setKopyalandi(true); setTimeout(() => setKopyalandi(false), 2000); bildirimGoster("Kopyalandı ✓"); };
  return (
    <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="kart" style={{ padding: 24 }}>
        <BolumBasligi ikon="✉" baslik="AI Günlük Brifing" />
        <div className="grid3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, margin: "16px 0" }}>
          {[{ i: "🔴", e: "Geçmiş", d: gecmisHat.length, r: "#e11d48" }, { i: "📞", e: "Bugün", d: bugunHat.length, r: "#d97706" }, { i: "👥", e: "Hastalar", d: hastalar.length, r: "#7c3aed" }].map(s => (
            <div key={s.e} style={{ background: "#f8f6f3", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>{s.i}</span>
              <div><div className="mono" style={{ fontSize: 20, fontWeight: 700, color: s.r }}>{s.d}</div><div style={{ fontSize: 11, color: "#9b8f88" }}>{s.e}</div></div>
            </div>
          ))}
        </div>
        <div className="mobileWrap" style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={ozetOlustur} disabled={yukl} style={{ background: "#1a1a2e", color: "#fff", padding: "11px 22px", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            {yukl ? <><span style={{ width: 14, height: 14, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "don 1s linear infinite" }} /> Oluşturuluyor…</> : "✨ Brifing Oluştur"}
          </button>
          {ozet && <button className="btn" onClick={kopyala} style={{ background: "#f1ede8", color: "#5a4a3a", padding: "11px 18px", fontSize: 13 }}>{kopyalandi ? "✓ Kopyalandı" : "📋 Kopyala"}</button>}
        </div>
      </div>
      {ozet && (
        <div className="kart" style={{ padding: 22 }}>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.8, color: "#1a1a2e", background: "#f8f6f3", borderRadius: 10, padding: "16px 18px" }}>{ozet}</div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   MODALLER
══════════════════════════════════════════════════ */
function HastaEkleModal({ onKapat, onKaydet }) {
  const [f, setF] = useState({ isim: "", ulkeKodu: VARSAYILAN_ULKE_KODU, telefon: "", notlar: "" });
  const kaydet = async () => {
    if (!f.isim || !f.telefon) return;
    const kaydedildi = await onKaydet({ isim: f.isim, ulkeKodu: f.ulkeKodu, telefon: telefonuBirlestir(f.ulkeKodu, f.telefon), notlar: f.notlar });
    if (kaydedildi) onKapat();
  };
  return (
    <Modal onKapat={onKapat} baslik="Yeni Hasta Ekle">
      <Alan etiket="Ad Soyad *"><input className="giris" value={f.isim} onChange={e => setF(p => ({ ...p, isim: e.target.value }))} placeholder="Ayşe Yılmaz" autoFocus /></Alan>
      <Alan etiket="Telefon Numarası *">
        <div className="mobileWrap" style={{ display: "flex", gap: 8 }}>
          <input className="giris" value={f.ulkeKodu} onChange={e => setF(p => ({ ...p, ulkeKodu: e.target.value.startsWith("+") ? e.target.value : `+${e.target.value.replace(/\+/g, "")}` }))} placeholder="+90" style={{ maxWidth: 100 }} />
          <input className="giris" type="tel" value={f.telefon} onChange={e => setF(p => ({ ...p, telefon: e.target.value }))} placeholder="532 000 0000" style={{ flex: 1 }} />
        </div>
      </Alan>
      <Alan etiket="Notlar"><textarea className="giris" rows={3} value={f.notlar} onChange={e => setF(p => ({ ...p, notlar: e.target.value }))} placeholder="Alerji, tercih…" style={{ resize: "none" }} /></Alan>
      <div className="mobileWrap" style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <Btn onClick={onKapat} style={{ flex: 1, background: "#f1ede8", color: "#78706a", padding: 11 }}>İptal</Btn>
        <Btn koyu onClick={kaydet} style={{ flex: 2, padding: 11, fontWeight: 700 }}>Hasta Ekle</Btn>
      </div>
    </Modal>
  );
}

function IceriAktarModal({ onKapat, onAktar }) {
  const [dosyaAdi, setDosyaAdi] = useState("");
  const [kayitlar, setKayitlar] = useState([]);
  const [hazirlaniyor, setHazirlaniyor] = useState(false);
  const [aktariliyor, setAktariliyor] = useState(false);
  const [hata, setHata] = useState("");

  const sablonIndir = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      ["isim", "telefon", "islem", "tarih", "fiyat", "notlar"],
      ["Ayşe Yılmaz", "+90 532 000 0001", "Botox", "2026-03-15", "1200", "Alın"],
      ["Fatma Kaya", "+90 532 000 0002", "Filler", "2026-02-20", "2200", "Yanak"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hastalar");
    XLSX.writeFile(wb, "hasta-aktarim-sablonu.xlsx");
  };

  const dosyaOku = async (dosya) => {
    if (!dosya) return;
    setHazirlaniyor(true);
    setHata("");
    try {
      const XLSX = await import("xlsx");
      const buffer = await dosya.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const satirlar = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
      const cozulmus = satirlar
        .map(satir => ({
          isim: String(alanDegeriBul(satir, EXCEL_ALANLARI.isim) || "").trim(),
          telefon: String(alanDegeriBul(satir, EXCEL_ALANLARI.telefon) || "").trim(),
          islem: String(alanDegeriBul(satir, EXCEL_ALANLARI.islem) || "").trim(),
          tarih: excelTarihiniNormalizeEt(alanDegeriBul(satir, EXCEL_ALANLARI.tarih)),
          fiyat: String(alanDegeriBul(satir, EXCEL_ALANLARI.fiyat) || "").trim(),
          notlar: String(alanDegeriBul(satir, EXCEL_ALANLARI.notlar) || "").trim(),
        }))
        .filter(kayit => Object.values(kayit).some(Boolean));

      if (!cozulmus.length) throw new Error("Dosyada okunabilir satır bulunamadı.");
      if (cozulmus.length > CSV_IMPORT_LIMIT) throw new Error(`En fazla ${CSV_IMPORT_LIMIT} hasta içe aktarılabilir.`);

      setDosyaAdi(dosya.name);
      setKayitlar(cozulmus);
    } catch (err) {
      setDosyaAdi("");
      setKayitlar([]);
      setHata(err?.message || "Dosya okunamadı. İlk satırda kolon başlıkları olduğundan emin olun.");
    } finally {
      setHazirlaniyor(false);
    }
  };

  const aktar = async () => {
    if (!kayitlar.length) return;
    setAktariliyor(true);
    await onAktar(kayitlar);
    setAktariliyor(false);
    onKapat();
  };

  return (
    <Modal onKapat={onKapat} baslik="Excel'den İçe Aktar">
      <p style={{ fontSize: 13, color: "#78706a", marginBottom: 12, lineHeight: 1.6 }}>
        Excel, CSV veya Numbers'tan dışa aktarılan dosyayı yükleyin. Zorunlu sütunlar:
        {" "}<code style={{ background: "#f1ede8", padding: "1px 5px", borderRadius: 4 }}>isim</code>
        {" "}<code style={{ background: "#f1ede8", padding: "1px 5px", borderRadius: 4 }}>telefon</code>. Tek dosyada en fazla {CSV_IMPORT_LIMIT} hasta içe aktarılır.
      </p>

      <div style={{ background: "#f8f6f3", borderRadius: 10, padding: 12, marginBottom: 12, border: "1px dashed #d6cfc6" }}>
        <div style={{ fontSize: 12, color: "#78706a", marginBottom: 8, fontWeight: 600 }}>Desteklenen sütunlar</div>
        <div style={{ fontSize: 12, color: "#9b8f88", lineHeight: 1.7 }}>
          isim, telefon, islem, tarih, fiyat, notlar
        </div>
      </div>

      <div className="mobileWrap" style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <Btn onClick={sablonIndir} style={{ background: "#f1ede8", color: "#5a4a3a" }}>Şablonu İndir</Btn>
        <label className="btn" style={{ background: "#fff", border: "1px dashed #d6cfc6", color: "#5a4a3a", padding: "8px 16px", display: "inline-flex", alignItems: "center" }}>
          Dosya Seç
          <input type="file" accept=".xlsx,.xls,.csv" onChange={e => dosyaOku(e.target.files?.[0])} style={{ display: "none" }} />
        </label>
      </div>

      <div style={{ background: "#f8f6f3", borderRadius: 10, padding: 12, border: "1px solid #ece7e0", minHeight: 84 }}>
        {hazirlaniyor && <div style={{ fontSize: 13, color: "#78706a" }}>Dosya hazırlanıyor…</div>}
        {!hazirlaniyor && !dosyaAdi && !hata && <div style={{ fontSize: 13, color: "#9b8f88" }}>Henüz dosya seçilmedi.</div>}
        {!hazirlaniyor && dosyaAdi && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e", marginBottom: 4 }}>{dosyaAdi}</div>
            <div style={{ fontSize: 12, color: "#78706a" }}>{kayitlar.length} satır içe aktarmaya hazır.</div>
          </>
        )}
        {!hazirlaniyor && hata && <div style={{ fontSize: 13, color: "#e11d48" }}>{hata}</div>}
      </div>

      <div className="mobileWrap" style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <Btn onClick={onKapat} style={{ flex: 1, background: "#f1ede8", color: "#78706a", padding: 11 }}>İptal</Btn>
        <Btn koyu onClick={aktar} disabled={!kayitlar.length || hazirlaniyor || aktariliyor} style={{ flex: 2, padding: 11, fontWeight: 700 }}>
          {aktariliyor ? "Aktarılıyor…" : "⬆ İçe Aktar"}
        </Btn>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════
   KÜÇÜK BİLEŞENLER
══════════════════════════════════════════════════ */
function IstatistikKarti({ etiket, deger, renk, arkaplan, kenar, onClick }) {
  return (
    <div className="kart" onClick={onClick} style={{ padding: "16px 18px", background: arkaplan, border: `1px solid ${kenar}`, cursor: onClick ? "pointer" : "default", transition: "transform .15s,box-shadow .15s" }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,.1)"; } }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
      <div className="mono" style={{ fontSize: 28, fontWeight: 800, color: renk, lineHeight: 1 }}>{deger}</div>
      <div style={{ fontSize: 12, color: "#78706a", marginTop: 5 }}>{etiket}</div>
    </div>
  );
}

function IslemEtiketi({ islem, kucuk }) {
  const renkler = { Botox: "#2563eb", Filler: "#db2777", Mezoterapi: "#059669" };
  const renk = renkler[islem] || "#7c3aed";
  return <span className="etiket" style={{ background: renk + "18", color: renk, border: `1px solid ${renk}30`, fontSize: kucuk ? 10 : 11 }}>{islem}</span>;
}

function Avatar({ isim, boyut = 36 }) {
  const renkler = ["#e11d48", "#2563eb", "#7c3aed", "#059669", "#d97706", "#0369a1", "#db2777", "#ca8a04"];
  const bg = renkler[(isim?.charCodeAt(0) || 0) % renkler.length];
  return <div style={{ width: boyut, height: boyut, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: boyut * .38, flexShrink: 0 }}>{isim?.charAt(0)?.toUpperCase()}</div>;
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
      <div className="modalBox" style={{ background: "#fff", borderRadius: 18, padding: 28, width: 480, maxWidth: "95vw", animation: "yukariCik .25s ease", boxShadow: "0 24px 80px rgba(0,0,0,.25)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e", marginBottom: 20 }}>{baslik}</div>
        {children}
      </div>
    </div>
  );
}

function BolumBasligi({ ikon, baslik, titreme }) {
  return <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1a2e", display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}><span style={{ animation: titreme ? "don 2s linear infinite" : "none" }}>{ikon}</span>{baslik}</div>;
}
function Bos({ metin }) { return <div style={{ textAlign: "center", padding: "22px 0", color: "#b0a89e", fontSize: 13, fontStyle: "italic" }}>{metin}</div>; }
function Bildirim({ msg, tip }) { return <div style={{ position: "fixed", bottom: 26, right: 26, zIndex: 99999, background: tip === "uyari" ? "#7c0a02" : tip === "hata" ? "#450a0a" : "#1a2e1a", color: "#fff", borderRadius: 10, padding: "12px 20px", fontSize: 14, boxShadow: "0 8px 32px rgba(0,0,0,.25)", animation: "yukariCik .25s ease", maxWidth: 340 }}>{msg}</div>; }
function Yukleniyor() { return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}><div style={{ textAlign: "center" }}><div style={{ width: 40, height: 40, border: "3px solid #e4ddd5", borderTopColor: "#1a1a2e", borderRadius: "50%", animation: "don 1s linear infinite", margin: "0 auto 14px" }} /><div style={{ color: "#9b8f88", fontSize: 14 }}>Yükleniyor…</div></div></div>; }
function YetkiYok() { return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh" }}><div style={{ textAlign: "center" }}><div style={{ fontSize: 48, marginBottom: 14 }}>🔒</div><div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e" }}>Bu alana erişim yetkiniz yok</div><div style={{ fontSize: 14, color: "#9b8f88", marginTop: 6 }}>Yalnızca admin görebilir</div></div></div>; }
