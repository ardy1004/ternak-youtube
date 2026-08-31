export type ChannelStatus = "active" | "paused";
export type VideoStatus = "draft" | "queued" | "scheduled" | "published" | "failed" | "cancelled";
export type PostStatus = "scheduled" | "published" | "failed" | "cancelled";

/**
 * The prototype runs against a fixed "today" so every screen tells the same
 * story regardless of when it is opened.
 */
export const TODAY = "2024-12-20";

/** Mirrors the `channels` table in PRD §9, minus the encrypted credential refs. */
export interface Channel {
  id: string;
  name: string;
  handle: string;
  status: ChannelStatus;
  // Targeting
  market: string;
  niche: string;
  contentType: string;
  contentLang: string;
  // Scheduling
  timezone: string;
  videosPerDay: number;
  maxUploadsPerDay: number;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  activeDays: string[];
  // YouTube defaults
  visibility: string;
  category: string;
  baselineTags: string;
  playlistId: string;
  madeForKids: boolean;
  // AI
  aiOutputLang: string;
  aiTone: string;
  aiFewShot: string;
  aiCtaTemplate: string;
  // Warm-up
  warmupEnabled: boolean;
  warmupDays: number;
  warmupStartPerDay: number;
  // Derived/reporting
  weeklyViews: number;
}

export interface Video {
  id: string;
  channelId: string;
  title: string;
  thumbnail: string;
  type: string;
  market: string;
  status: VideoStatus;
  brief: string;
  tags: string[];
  description: string;
  titleVariants: string[];
  createdAt: string;
  durationSec: number;
}

/**
 * PRD §9 scheduled_posts. This is the single source of truth for "when does a
 * video go out" — Dashboard's today panel and the Schedule calendar both
 * derive from it rather than keeping their own copies.
 */
export interface ScheduledPost {
  id: string;
  videoId: string;
  channelId: string;
  slotTimeUtc: string;
  zernioPostId: string | null;
  idempotencyKey: string;
  status: PostStatus;
  failReason: string | null;
  retryCount: number;
}

export interface ActivityEntry {
  id: string;
  type: "publish" | "fail" | "webhook" | "cron" | "retry" | "cancel" | "upload" | "channel";
  message: string;
  channel: string;
  videoTitle?: string;
  timestamp: string;
  status: "success" | "failed" | "info";
}

export interface JobRun {
  id: string;
  type: string;
  status: "success" | "failed";
  started: string;
  finished: string;
  detail: string;
}

export interface WebhookEvent {
  id: string;
  source: string;
  type: string;
  channel: string;
  timestamp: string;
  status: "success" | "failed" | "info";
}

/** Per-day, per-segment metric rows so Analytics filters operate on real data. */
export interface MetricPoint {
  date: string;
  channelId: string;
  contentType: string;
  market: string;
  views: number;
  watchTimeSec: number;
  videosPublished: number;
}

export const channels: Channel[] = [
  {
    id: "ch_001",
    name: "InfoTech Indonesia",
    handle: "@infotech.id",
    status: "active",
    market: "Indonesia",
    niche: "Technology",
    contentType: "Tutorial",
    contentLang: "id",
    timezone: "Asia/Jakarta",
    videosPerDay: 2,
    maxUploadsPerDay: 3,
    windowStart: "07:00",
    windowEnd: "20:00",
    intervalMin: 60,
    activeDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    visibility: "public",
    category: "Science & Technology",
    baselineTags: "tech, indonesia, tutorial, developer",
    playlistId: "PLinfotech2024",
    madeForKids: false,
    aiOutputLang: "Bahasa Indonesia",
    aiTone: "Educational & Clear",
    aiFewShot:
      "Tutorial Next.js 15 App Router — Dari Nol Sampai Deploy\nBelajar TypeScript dalam 2 Jam — Complete Crash Course",
    aiCtaTemplate: "Subscribe untuk konten tech terbaru.\nSource code: [LINK]",
    warmupEnabled: false,
    warmupDays: 14,
    warmupStartPerDay: 1,
    weeklyViews: 128_450,
  },
  {
    id: "ch_002",
    name: "FinanceMY",
    handle: "@financemy.official",
    status: "active",
    market: "Malaysia",
    niche: "Finance",
    contentType: "Education",
    contentLang: "ms",
    timezone: "Asia/Kuala_Lumpur",
    videosPerDay: 1,
    maxUploadsPerDay: 2,
    windowStart: "09:00",
    windowEnd: "18:00",
    intervalMin: 120,
    activeDays: ["Mon", "Wed", "Fri"],
    visibility: "public",
    category: "Education",
    baselineTags: "kewangan, malaysia, labur, saham",
    playlistId: "",
    madeForKids: false,
    aiOutputLang: "Bahasa Malaysia",
    aiTone: "Professional & Authoritative",
    aiFewShot:
      "Cara Melabur Saham untuk Pemula Malaysia 2024\nPanduan Lengkap Melabur Bursa Malaysia — Dari Sifar",
    aiCtaTemplate: "Langgan untuk tips kewangan mingguan.\nRujukan: [LINK]",
    warmupEnabled: false,
    warmupDays: 14,
    warmupStartPerDay: 1,
    weeklyViews: 43_205,
  },
  {
    id: "ch_003",
    name: "Crypto Global EN",
    handle: "@cryptoglobal.en",
    status: "paused",
    market: "International",
    niche: "Crypto",
    contentType: "Education",
    contentLang: "en",
    timezone: "UTC",
    videosPerDay: 3,
    maxUploadsPerDay: 4,
    windowStart: "06:00",
    windowEnd: "22:00",
    intervalMin: 90,
    activeDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    visibility: "public",
    category: "Education",
    baselineTags: "crypto, blockchain, defi, web3",
    playlistId: "",
    madeForKids: false,
    aiOutputLang: "English",
    aiTone: "Professional & Authoritative",
    aiFewShot:
      "What Is Restaking? A Plain-English Breakdown\nStablecoin Depegs Explained — What Actually Goes Wrong",
    aiCtaTemplate: "Subscribe for weekly market breakdowns.\nResources: [LINK]",
    warmupEnabled: true,
    warmupDays: 21,
    warmupStartPerDay: 1,
    weeklyViews: 12_890,
  },
  {
    id: "ch_004",
    name: "Kuliner Nusantara",
    handle: "@kulinernusantara",
    status: "active",
    market: "Indonesia",
    niche: "Food & Lifestyle",
    contentType: "Recipe",
    contentLang: "id",
    timezone: "Asia/Jakarta",
    videosPerDay: 3,
    maxUploadsPerDay: 4,
    windowStart: "07:00",
    windowEnd: "19:00",
    intervalMin: 150,
    activeDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    visibility: "public",
    category: "Howto & Style",
    baselineTags: "resep, masakan indonesia, kuliner, memasak",
    playlistId: "PLkuliner2024",
    madeForKids: false,
    aiOutputLang: "Bahasa Indonesia",
    aiTone: "Conversational & Friendly",
    aiFewShot:
      "Resep Rendang Sapi Padang Asli — Tips Daging Empuk\n10 Makanan Wajib Coba di Jogja — Street Food Tour",
    aiCtaTemplate: "Subscribe untuk resep baru tiap minggu.\nResep lengkap: [LINK]",
    warmupEnabled: false,
    warmupDays: 14,
    warmupStartPerDay: 1,
    weeklyViews: 89_320,
  },
];

const THUMBS = {
  ai: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=160&h=90&fit=crop&auto=format",
  code: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=160&h=90&fit=crop&auto=format",
  stocks: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=160&h=90&fit=crop&auto=format",
  rendang: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=160&h=90&fit=crop&auto=format",
  containers: "https://images.unsplash.com/photo-1605745341112-85968b19335b?w=160&h=90&fit=crop&auto=format",
  streetfood: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=160&h=90&fit=crop&auto=format",
  savings: "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=160&h=90&fit=crop&auto=format",
  typescript: "https://images.unsplash.com/photo-1587620962725-abab19836100?w=160&h=90&fit=crop&auto=format",
  soup: "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=160&h=90&fit=crop&auto=format",
  git: "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=160&h=90&fit=crop&auto=format",
  grill: "https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=160&h=90&fit=crop&auto=format",
  bundle: "https://images.unsplash.com/photo-1550439062-609e1531270e?w=160&h=90&fit=crop&auto=format",
  salad: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=160&h=90&fit=crop&auto=format",
  state: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=160&h=90&fit=crop&auto=format",
  budget: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=160&h=90&fit=crop&auto=format",
};

export const videos: Video[] = [
  {
    id: "vid_001",
    channelId: "ch_001",
    title: "5 Framework AI Terbaik untuk Developer Indonesia 2024",
    thumbnail: THUMBS.ai,
    type: "Tutorial",
    market: "Indonesia",
    status: "scheduled",
    brief: "Bahas top 5 AI framework yang banyak dipakai developer Indonesia: LangChain, LlamaIndex, Haystack, CrewAI, dan AutoGen.",
    tags: ["AI", "developer", "programming", "Indonesia", "framework"],
    description: "Di video ini kita akan bahas 5 framework AI terpopuler yang wajib dikuasai developer Indonesia di 2024...",
    titleVariants: [
      "5 Framework AI Terbaik untuk Developer Indonesia 2024",
      "Wajib Tahu! AI Framework yang Dipakai Developer Profesional",
      "Top 5 AI Tools Developer Indonesia — Mana yang Paling Worth?",
    ],
    createdAt: "2024-12-18T10:30:00Z",
    durationSec: 842,
  },
  {
    id: "vid_002",
    channelId: "ch_001",
    title: "Tutorial Next.js 15 App Router — Dari Nol Sampai Deploy",
    thumbnail: THUMBS.code,
    type: "Tutorial",
    market: "Indonesia",
    status: "published",
    brief: "Tutorial lengkap Next.js 15 App Router untuk pemula hingga intermediate, termasuk SSR, ISR, dan deploy ke Vercel.",
    tags: ["nextjs", "react", "tutorial", "Indonesia"],
    description: "Next.js 15 hadir dengan banyak perubahan di App Router. Di video ini saya akan tunjukkan cara build project dari nol...",
    titleVariants: [
      "Tutorial Next.js 15 App Router — Dari Nol Sampai Deploy",
      "Next.js 15 Full Course Bahasa Indonesia — App Router Terlengkap",
      "Belajar Next.js 15 App Router: SSR, ISR, dan Deploy ke Vercel",
    ],
    createdAt: "2024-12-15T09:00:00Z",
    durationSec: 3120,
  },
  {
    id: "vid_003",
    channelId: "ch_002",
    title: "Cara Melabur Saham untuk Pemula Malaysia 2024",
    thumbnail: THUMBS.stocks,
    type: "Education",
    market: "Malaysia",
    status: "failed",
    brief: "Panduan lengkap melabur dalam saham Bursa Malaysia untuk pemula: akaun, pemilihan saham, strategi jangka panjang.",
    tags: ["saham", "labur", "Malaysia", "kewangan", "Bursa"],
    description: "Nak mula melabur tapi tak tahu dari mana? Video ini akan tunjukkan langkah demi langkah cara buka akaun CDS...",
    titleVariants: [
      "Cara Melabur Saham untuk Pemula Malaysia 2024",
      "Panduan Lengkap Melabur Bursa Malaysia — Dari Sifar",
      "Mula Melabur Saham dengan RM500 — Strategi Pemula 2024",
    ],
    createdAt: "2024-12-17T14:00:00Z",
    durationSec: 1265,
  },
  {
    id: "vid_004",
    channelId: "ch_004",
    title: "Resep Rendang Sapi Padang Asli — Tips Daging Empuk",
    thumbnail: THUMBS.rendang,
    type: "Recipe",
    market: "Indonesia",
    status: "scheduled",
    brief: "Resep rendang sapi authentic Minangkabau, tips memilih daging, bumbu lengkap, dan cara masak hingga santan mengering sempurna.",
    tags: ["rendang", "masakan padang", "resep", "kuliner Indonesia"],
    description: "Rendang adalah masakan terenak di dunia! Di video ini saya berbagi resep keluarga rendang sapi Padang asli...",
    titleVariants: [
      "Resep Rendang Sapi Padang Asli — Tips Daging Empuk",
      "Cara Buat Rendang Sapi yang Benar: Resep Authentic Minangkabau",
      "Rendang Sapi Empuk dan Meresap — Rahasia Resep Nenek",
    ],
    createdAt: "2024-12-18T11:00:00Z",
    durationSec: 968,
  },
  {
    id: "vid_005",
    channelId: "ch_001",
    title: "Docker vs Kubernetes — Kapan Harus Pakai Masing-masing?",
    thumbnail: THUMBS.containers,
    type: "Explainer",
    market: "Indonesia",
    status: "queued",
    brief: "Penjelasan komprehensif perbedaan Docker dan Kubernetes, use case masing-masing, dan kapan upgrade ke K8s.",
    tags: ["docker", "kubernetes", "devops", "Indonesia"],
    description: "",
    titleVariants: [],
    createdAt: "2024-12-19T08:00:00Z",
    durationSec: 1104,
  },
  {
    id: "vid_006",
    channelId: "ch_004",
    title: "10 Makanan Wajib Coba di Jogja — Street Food Tour",
    thumbnail: THUMBS.streetfood,
    type: "Vlog",
    market: "Indonesia",
    status: "published",
    brief: "Street food tour di Jogja: Gudeg Bu Tjitro, Bakpia Pathuk, Angkringan Kopi Joss, Mie Ayam Tumini, dan 6 tempat lainnya.",
    tags: ["jogja", "street food", "kuliner", "wisata kuliner"],
    description: "Jogja surganya kuliner! Di video ini kami explore 10 makanan wajib coba yang belum banyak diekspos...",
    titleVariants: [
      "10 Makanan Wajib Coba di Jogja — Street Food Tour",
      "Hidden Gems Kuliner Jogja yang Wajib Kamu Coba!",
      "Street Food Tour Jogja: 10 Spot yang Bikin Nagih",
    ],
    createdAt: "2024-12-14T10:00:00Z",
    durationSec: 1432,
  },
  {
    id: "vid_007",
    channelId: "ch_002",
    title: "EPF Withdrawal Strategy — Maximizing Your Retirement Savings",
    thumbnail: THUMBS.savings,
    type: "Education",
    market: "Malaysia",
    status: "scheduled",
    brief: "Strategy untuk keluarkan EPF dengan optimum: Account 1 vs 2, timing withdrawal, dan cara maximize dividend.",
    tags: ["EPF", "KWSP", "simpanan", "persaraan", "Malaysia"],
    description: "EPF adalah salah satu simpanan persaraan terpenting untuk rakyat Malaysia. Tapi ramai yang tak tahu cara...",
    titleVariants: [
      "EPF Withdrawal Strategy — Maximizing Your Retirement Savings",
      "Cara Keluarkan EPF dengan Bijak — Strategi Lengkap 2024",
      "Maximize EPF Returns: Bila dan Macam Mana Nak Keluarkan",
    ],
    createdAt: "2024-12-19T13:00:00Z",
    durationSec: 1078,
  },
  {
    id: "vid_008",
    channelId: "ch_001",
    title: "Belajar TypeScript dalam 2 Jam — Complete Crash Course",
    thumbnail: THUMBS.typescript,
    type: "Tutorial",
    market: "Indonesia",
    status: "draft",
    brief: "TypeScript crash course 2 jam: types, interfaces, generics, utility types, dan integrasi dengan React.",
    tags: ["typescript", "tutorial", "programming", "react"],
    description: "",
    titleVariants: [],
    createdAt: "2024-12-20T08:00:00Z",
    durationSec: 7260,
  },
  {
    id: "vid_009",
    channelId: "ch_004",
    title: "Cara Buat Soto Betawi Kuah Santan — Resep Otentik",
    thumbnail: THUMBS.soup,
    type: "Recipe",
    market: "Indonesia",
    status: "scheduled",
    brief: "Resep soto betawi kuah santan khas Jakarta: pilihan jeroan, bumbu halus, dan cara agar santan tidak pecah.",
    tags: ["soto betawi", "resep", "kuliner Jakarta", "masakan Indonesia"],
    description: "Soto Betawi yang benar itu kuahnya gurih tapi tidak enek. Kuncinya di perbandingan santan dan susu...",
    titleVariants: [
      "Cara Buat Soto Betawi Kuah Santan — Resep Otentik",
      "Resep Soto Betawi Jakarta yang Gurih dan Tidak Enek",
      "Soto Betawi Rumahan — Kuah Santan Anti Pecah",
    ],
    createdAt: "2024-12-18T12:00:00Z",
    durationSec: 754,
  },
  {
    id: "vid_010",
    channelId: "ch_001",
    title: "Git Branching Strategy untuk Tim Developer",
    thumbnail: THUMBS.git,
    type: "Tutorial",
    market: "Indonesia",
    status: "scheduled",
    brief: "Perbandingan Git Flow, GitHub Flow, dan trunk-based development, plus kapan tim sebaiknya pindah strategi.",
    tags: ["git", "workflow", "devops", "tim developer"],
    description: "Salah pilih branching strategy bikin tim saling menunggu. Video ini bandingkan tiga pendekatan paling umum...",
    titleVariants: [
      "Git Branching Strategy untuk Tim Developer",
      "Git Flow vs Trunk-Based — Mana yang Cocok untuk Tim Kamu?",
      "Berhenti Salah Pakai Git Branch: Panduan untuk Tim",
    ],
    createdAt: "2024-12-19T09:30:00Z",
    durationSec: 1196,
  },
  {
    id: "vid_011",
    channelId: "ch_004",
    title: "Resep Ayam Bakar Taliwang Lombok — Pedas Autentik",
    thumbnail: THUMBS.grill,
    type: "Recipe",
    market: "Indonesia",
    status: "scheduled",
    brief: "Ayam bakar taliwang khas Lombok: bumbu terasi bakar, teknik ungkep, dan cara membakar agar tidak gosong.",
    tags: ["ayam taliwang", "lombok", "resep pedas", "kuliner Indonesia"],
    description: "Ayam Taliwang asli Lombok itu pedasnya berkarakter, bukan sekadar pedas. Rahasianya di terasi yang dibakar dulu...",
    titleVariants: [
      "Resep Ayam Bakar Taliwang Lombok — Pedas Autentik",
      "Ayam Taliwang Khas Lombok: Resep Bumbu Terasi Bakar",
      "Cara Buat Ayam Bakar Taliwang yang Pedasnya Pas",
    ],
    createdAt: "2024-12-19T11:15:00Z",
    durationSec: 812,
  },
  {
    id: "vid_012",
    channelId: "ch_001",
    title: "Optimasi Bundle Size React — Dari 2MB ke 300KB",
    thumbnail: THUMBS.bundle,
    type: "Tutorial",
    market: "Indonesia",
    status: "scheduled",
    brief: "Studi kasus nyata memangkas bundle React: code splitting, tree shaking, analisis dependency, dan lazy loading route.",
    tags: ["react", "performance", "bundle size", "optimasi"],
    description: "Bundle 2MB bikin halaman pertama lambat di koneksi 4G Indonesia. Ini langkah-langkah memangkasnya sampai 300KB...",
    titleVariants: [
      "Optimasi Bundle Size React — Dari 2MB ke 300KB",
      "Cara Memangkas Bundle React 85% Tanpa Ganti Framework",
      "React Lambat? Ini Cara Analisis dan Perkecil Bundle-nya",
    ],
    createdAt: "2024-12-19T15:00:00Z",
    durationSec: 1385,
  },
  {
    id: "vid_013",
    channelId: "ch_004",
    title: "Cara Buat Gado-gado Jakarta — Bumbu Kacang Spesial",
    thumbnail: THUMBS.salad,
    type: "Recipe",
    market: "Indonesia",
    status: "scheduled",
    brief: "Gado-gado Jakarta dengan bumbu kacang ulek: perbandingan kacang, gula merah, dan cara mengatur kekentalan bumbu.",
    tags: ["gado-gado", "bumbu kacang", "resep", "kuliner Jakarta"],
    description: "Bumbu kacang gado-gado Jakarta itu diulek, bukan diblender. Teksturnya yang bikin beda...",
    titleVariants: [
      "Cara Buat Gado-gado Jakarta — Bumbu Kacang Spesial",
      "Resep Gado-gado Betawi: Bumbu Kacang Ulek Autentik",
      "Gado-gado Jakarta Rumahan — Bumbu Kacang Anti Gagal",
    ],
    createdAt: "2024-12-20T06:45:00Z",
    durationSec: 690,
  },
  {
    id: "vid_014",
    channelId: "ch_001",
    title: "Zustand vs Redux Toolkit — Mana yang Menang di 2025?",
    thumbnail: THUMBS.state,
    type: "Explainer",
    market: "Indonesia",
    status: "scheduled",
    brief: "Perbandingan Zustand dan Redux Toolkit dari sisi boilerplate, devtools, ukuran bundle, dan skala tim.",
    tags: ["zustand", "redux", "state management", "react"],
    description: "Redux Toolkit sudah jauh lebih ringkas dari Redux lama, tapi Zustand tetap menang di boilerplate. Ini perbandingannya...",
    titleVariants: [
      "Zustand vs Redux Toolkit — Mana yang Menang di 2025?",
      "Berhenti Pakai Redux? Perbandingan Jujur dengan Zustand",
      "State Management React 2025: Zustand atau Redux Toolkit?",
    ],
    createdAt: "2024-12-20T07:20:00Z",
    durationSec: 1024,
  },
  {
    id: "vid_015",
    channelId: "ch_002",
    title: "Analisis Bajet 2025 Malaysia — Kesan pada Rakyat",
    thumbnail: THUMBS.budget,
    type: "Education",
    market: "Malaysia",
    status: "cancelled",
    brief: "Ringkasan Bajet 2025: subsidi sasaran, cukai baharu, dan kesan langsung pada perbelanjaan isi rumah.",
    tags: ["bajet 2025", "Malaysia", "cukai", "kewangan"],
    description: "Bajet 2025 membawa perubahan besar pada struktur subsidi. Ini kesan yang paling terasa untuk isi rumah...",
    titleVariants: [
      "Analisis Bajet 2025 Malaysia — Kesan pada Rakyat",
      "Bajet 2025: Apa yang Berubah untuk Poket Anda",
      "Subsidi Sasaran dan Cukai Baharu — Penjelasan Bajet 2025",
    ],
    createdAt: "2024-12-16T09:00:00Z",
    durationSec: 902,
  },
];

export const scheduledPosts: ScheduledPost[] = [
  // Dec 20 — today
  {
    id: "sp_001", videoId: "vid_004", channelId: "ch_004",
    slotTimeUtc: "2024-12-20T00:00:00Z", zernioPostId: "zrn_cc9012",
    idempotencyKey: "ch_004:vid_004:2024-12-20T00:00:00Z",
    status: "scheduled", failReason: null, retryCount: 0,
  },
  {
    id: "sp_002", videoId: "vid_001", channelId: "ch_001",
    slotTimeUtc: "2024-12-20T01:00:00Z", zernioPostId: "zrn_aa1234",
    idempotencyKey: "ch_001:vid_001:2024-12-20T01:00:00Z",
    status: "scheduled", failReason: null, retryCount: 0,
  },
  {
    id: "sp_003", videoId: "vid_003", channelId: "ch_002",
    slotTimeUtc: "2024-12-20T02:00:00Z", zernioPostId: null,
    idempotencyKey: "ch_002:vid_003:2024-12-20T02:00:00Z",
    status: "failed",
    failReason: "YouTube API returned 403 Forbidden. Daily upload limit reached for this project's credentials.",
    retryCount: 1,
  },
  {
    id: "sp_004", videoId: "vid_009", channelId: "ch_004",
    slotTimeUtc: "2024-12-20T05:00:00Z", zernioPostId: "zrn_ff2244",
    idempotencyKey: "ch_004:vid_009:2024-12-20T05:00:00Z",
    status: "scheduled", failReason: null, retryCount: 0,
  },
  {
    id: "sp_005", videoId: "vid_010", channelId: "ch_001",
    slotTimeUtc: "2024-12-20T09:00:00Z", zernioPostId: "zrn_gg5566",
    idempotencyKey: "ch_001:vid_010:2024-12-20T09:00:00Z",
    status: "scheduled", failReason: null, retryCount: 0,
  },
  // Dec 21
  {
    id: "sp_006", videoId: "vid_011", channelId: "ch_004",
    slotTimeUtc: "2024-12-21T00:00:00Z", zernioPostId: "zrn_hh7788",
    idempotencyKey: "ch_004:vid_011:2024-12-21T00:00:00Z",
    status: "scheduled", failReason: null, retryCount: 0,
  },
  {
    id: "sp_007", videoId: "vid_012", channelId: "ch_001",
    slotTimeUtc: "2024-12-21T01:00:00Z", zernioPostId: "zrn_ii9900",
    idempotencyKey: "ch_001:vid_012:2024-12-21T01:00:00Z",
    status: "scheduled", failReason: null, retryCount: 0,
  },
  {
    id: "sp_008", videoId: "vid_007", channelId: "ch_002",
    slotTimeUtc: "2024-12-21T02:00:00Z", zernioPostId: "zrn_ee7890",
    idempotencyKey: "ch_002:vid_007:2024-12-21T02:00:00Z",
    status: "scheduled", failReason: null, retryCount: 0,
  },
  // Dec 22
  {
    id: "sp_009", videoId: "vid_013", channelId: "ch_004",
    slotTimeUtc: "2024-12-22T00:00:00Z", zernioPostId: "zrn_jj1122",
    idempotencyKey: "ch_004:vid_013:2024-12-22T00:00:00Z",
    status: "scheduled", failReason: null, retryCount: 0,
  },
  {
    id: "sp_010", videoId: "vid_014", channelId: "ch_001",
    slotTimeUtc: "2024-12-22T01:00:00Z", zernioPostId: "zrn_kk3344",
    idempotencyKey: "ch_001:vid_014:2024-12-22T01:00:00Z",
    status: "scheduled", failReason: null, retryCount: 0,
  },
  // Past — published
  {
    id: "sp_011", videoId: "vid_002", channelId: "ch_001",
    slotTimeUtc: "2024-12-19T01:00:00Z", zernioPostId: "zrn_bb5678",
    idempotencyKey: "ch_001:vid_002:2024-12-19T01:00:00Z",
    status: "published", failReason: null, retryCount: 0,
  },
  {
    id: "sp_012", videoId: "vid_006", channelId: "ch_004",
    slotTimeUtc: "2024-12-18T00:00:00Z", zernioPostId: "zrn_dd3456",
    idempotencyKey: "ch_004:vid_006:2024-12-18T00:00:00Z",
    status: "published", failReason: null, retryCount: 0,
  },
  // Cancelled
  {
    id: "sp_013", videoId: "vid_015", channelId: "ch_002",
    slotTimeUtc: "2024-12-18T02:00:00Z", zernioPostId: null,
    idempotencyKey: "ch_002:vid_015:2024-12-18T02:00:00Z",
    status: "cancelled", failReason: null, retryCount: 0,
  },
];

export const activityFeed: ActivityEntry[] = [
  {
    id: "act_001",
    type: "retry",
    message: "Retry queued — attempt 1/3 in 30 min",
    channel: "FinanceMY",
    videoTitle: "Cara Melabur Saham untuk Pemula Malaysia 2024",
    timestamp: "2024-12-20T10:05:00Z",
    status: "info",
  },
  {
    id: "act_002",
    type: "fail",
    message: "Upload failed — channel quota exceeded (403)",
    channel: "FinanceMY",
    videoTitle: "Cara Melabur Saham untuk Pemula Malaysia 2024",
    timestamp: "2024-12-20T10:01:03Z",
    status: "failed",
  },
  {
    id: "act_003",
    type: "webhook",
    message: "Webhook received: zernio.post.failed",
    channel: "FinanceMY",
    timestamp: "2024-12-20T10:01:00Z",
    status: "failed",
  },
  {
    id: "act_004",
    type: "cron",
    message: "Daily slot generator completed — 6 posts pushed to Zernio",
    channel: "System",
    timestamp: "2024-12-20T00:00:12Z",
    status: "success",
  },
  {
    id: "act_005",
    type: "cron",
    message: "Analytics sync completed — 4 snapshots updated",
    channel: "System",
    timestamp: "2024-12-19T12:00:08Z",
    status: "success",
  },
  {
    id: "act_006",
    type: "publish",
    message: "Published successfully",
    channel: "InfoTech Indonesia",
    videoTitle: "Tutorial Next.js 15 App Router — Dari Nol Sampai Deploy",
    timestamp: "2024-12-19T08:02:14Z",
    status: "success",
  },
  {
    id: "act_007",
    type: "webhook",
    message: "Webhook received: zernio.post.published",
    channel: "InfoTech Indonesia",
    timestamp: "2024-12-19T08:02:10Z",
    status: "info",
  },
  {
    id: "act_008",
    type: "cancel",
    message: "Post cancelled by operator before push",
    channel: "FinanceMY",
    videoTitle: "Analisis Bajet 2025 Malaysia — Kesan pada Rakyat",
    timestamp: "2024-12-18T09:14:00Z",
    status: "info",
  },
  {
    id: "act_009",
    type: "publish",
    message: "Published successfully",
    channel: "Kuliner Nusantara",
    videoTitle: "10 Makanan Wajib Coba di Jogja — Street Food Tour",
    timestamp: "2024-12-18T07:01:45Z",
    status: "success",
  },
];

export const jobRuns: JobRun[] = [
  { id: "job_001", type: "slot_generator", status: "success", started: "2024-12-20T00:00:00Z", finished: "2024-12-20T00:00:12Z", detail: "6 posts pushed to Zernio — 3 channels" },
  { id: "job_002", type: "analytics_sync", status: "success", started: "2024-12-19T12:00:00Z", finished: "2024-12-19T12:00:08Z", detail: "4 metric snapshots updated across 3 channels" },
  { id: "job_003", type: "slot_generator", status: "success", started: "2024-12-19T00:00:00Z", finished: "2024-12-19T00:00:09Z", detail: "5 posts pushed to Zernio" },
  { id: "job_004", type: "reconciliation", status: "success", started: "2024-12-18T06:00:00Z", finished: "2024-12-18T06:00:18Z", detail: "D1 ↔ Zernio sync — no drift detected" },
  { id: "job_005", type: "slot_generator", status: "failed", started: "2024-12-17T00:00:00Z", finished: "2024-12-17T00:00:04Z", detail: "Zernio API timeout — 3 posts not pushed, retried via Queue" },
  { id: "job_006", type: "analytics_sync", status: "success", started: "2024-12-17T12:00:00Z", finished: "2024-12-17T12:00:11Z", detail: "8 metric snapshots updated" },
];

export const webhookEvents: WebhookEvent[] = [
  { id: "wh_001", source: "Zernio", type: "zernio.post.failed", channel: "FinanceMY", timestamp: "2024-12-20T10:01:00Z", status: "failed" },
  { id: "wh_002", source: "Zernio", type: "zernio.queue.updated", channel: "System", timestamp: "2024-12-20T00:00:14Z", status: "info" },
  { id: "wh_003", source: "Zernio", type: "zernio.post.published", channel: "InfoTech Indonesia", timestamp: "2024-12-19T08:02:10Z", status: "success" },
  { id: "wh_004", source: "Zernio", type: "zernio.post.published", channel: "Kuliner Nusantara", timestamp: "2024-12-18T07:01:45Z", status: "success" },
  { id: "wh_005", source: "Zernio", type: "zernio.post.published", channel: "InfoTech Indonesia", timestamp: "2024-12-17T08:01:23Z", status: "success" },
];

/**
 * Metric seed. Each segment carries a daily baseline; the per-day factors give
 * a plausible curve. Totals per channel add up to that channel's weeklyViews,
 * so Analytics and the Channels cards agree.
 */
const METRIC_DATES = [
  "2024-12-13", "2024-12-14", "2024-12-15", "2024-12-16",
  "2024-12-17", "2024-12-18", "2024-12-19", "2024-12-20",
];

const DAY_FACTORS = [0.70, 1.07, 1.27, 0.82, 1.54, 1.83, 1.61, 1.18];

// videosPerDay mirrors each channel's configured cadence, so the dashboard's
// "published this week" and the Channels cards tell the same story. ch_003 is
// paused: its back catalogue still earns views, but nothing new goes out.
const METRIC_SEGMENTS = [
  { channelId: "ch_001", contentType: "Tutorial", market: "Indonesia", baseViews: 9637, avgViewSec: 268, videosPerDay: 1 },
  { channelId: "ch_001", contentType: "Explainer", market: "Indonesia", baseViews: 3183, avgViewSec: 224, videosPerDay: 1 },
  { channelId: "ch_002", contentType: "Education", market: "Malaysia", baseViews: 4312, avgViewSec: 245, videosPerDay: 1 },
  { channelId: "ch_003", contentType: "Education", market: "International", baseViews: 1286, avgViewSec: 198, videosPerDay: 0 },
  { channelId: "ch_004", contentType: "Recipe", market: "Indonesia", baseViews: 6509, avgViewSec: 212, videosPerDay: 2 },
  { channelId: "ch_004", contentType: "Vlog", market: "Indonesia", baseViews: 2405, avgViewSec: 176, videosPerDay: 1 },
];

export const metricPoints: MetricPoint[] = METRIC_SEGMENTS.flatMap((seg) =>
  METRIC_DATES.map((date, i) => {
    const views = Math.round(seg.baseViews * DAY_FACTORS[i]);
    return {
      date,
      channelId: seg.channelId,
      contentType: seg.contentType,
      market: seg.market,
      views,
      watchTimeSec: views * seg.avgViewSec,
      videosPublished: seg.videosPerDay,
    };
  })
);
