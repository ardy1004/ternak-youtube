import { useState } from "react";
import Dashboard from "./screens/Dashboard";
import Channels from "./screens/Channels";
import AddChannel from "./screens/AddChannel";
import ContentLibrary from "./screens/ContentLibrary";
import UploadFlow from "./screens/UploadFlow";
import Schedule from "./screens/Schedule";
import Analytics from "./screens/Analytics";
import ActivityLogs from "./screens/ActivityLogs";
import Settings from "./screens/Settings";
import { useApp, type NewVideoInput } from "./store/AppStore";
import { useAuth } from "./auth/AuthGate";

type Screen =
  | "dashboard"
  | "channels"
  | "add-channel"
  | "library"
  | "schedule"
  | "analytics"
  | "logs"
  | "settings";

interface NavItem {
  id: Screen;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "⬡" },
  { id: "channels", label: "Channels", icon: "◈" },
  { id: "library", label: "Content Library", icon: "▤" },
  { id: "schedule", label: "Schedule", icon: "▦" },
  { id: "analytics", label: "Analytics", icon: "▲" },
  { id: "logs", label: "Activity & Logs", icon: "≡" },
  { id: "settings", label: "Settings", icon: "◎" },
];

function SidebarItem({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-fast text-left ${
        active ? "bg-surface-2 text-text-primary font-medium" : "text-text-muted"
      }`}
    >
      <span className="text-xs w-4 text-center flex-shrink-0">{item.icon}</span>
      {item.label}
    </button>
  );
}

export default function App() {
  const { dryRun, setDryRun, addVideo, today, channels } = useApp();
  // Channel dianggap SIAP hanya bila aktif dan kredensialnya lengkap — itu
  // syarat minimum agar dispatch bisa berhasil.
  const readyChannels = channels.filter(
    (c) => c.status === "active" && (c as { hasZernioKey?: boolean }).hasZernioKey && (c as { zernioAccountId?: string }).zernioAccountId,
  ).length;
  const { user, logout } = useAuth();
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [showUpload, setShowUpload] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);

  const navigate = (s: Screen) => setScreen(s);

  const openChannelForm = (channelId: string | null) => {
    setEditingChannelId(channelId);
    navigate("add-channel");
  };

  const handleConfirmUpload = (input: NewVideoInput) => {
    addVideo(input);
    setShowUpload(false);
    setScreen("library");
    setToast(
      input.reviewQueue ? "Sent to review queue — validation failed" : "Video added to library"
    );
    setTimeout(() => setToast(null), 3000);
  };

  const displayDate = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex h-full bg-bg-0 font-ui">
      {/* Sidebar */}
      <div className="flex flex-col border-r border-border flex-shrink-0 bg-bg-0 w-[220px]">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded flex items-center justify-center text-xs font-medium bg-accent text-bg-0">
              TY
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">Ternak Youtube</div>
              <div className="text-xs text-text-muted">Operator Console</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <SidebarItem
              key={item.id}
              item={item}
              active={
                screen === item.id || (item.id === "channels" && screen === "add-channel")
              }
              onClick={() => navigate(item.id)}
            />
          ))}
        </nav>

        {/* Bottom section */}
        <div className="px-2 py-3 border-t border-border space-y-0.5">
          {/* Dry-run toggle */}
          <div className="px-3 py-2">
            <div className="label-caps mb-2">Dry-run Mode</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDryRun(!dryRun)}
                aria-pressed={dryRun}
                aria-label="Toggle dry-run mode"
                className={`relative w-8 h-4 rounded-full border transition-fast ${
                  dryRun ? "bg-accent/20 border-accent" : "bg-surface-2 border-border"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                    dryRun ? "bg-accent" : "bg-text-muted"
                  }`}
                  style={{ left: dryRun ? "calc(100% - 14px)" : "2px" }}
                />
              </button>
              <span
                className={`text-xs font-mono ${dryRun ? "text-accent" : "text-text-muted"}`}
              >
                {dryRun ? "ON" : "OFF"}
              </span>
            </div>
          </div>

          {/* Connection status */}
          <div className="px-3 py-2">
            {/*
              Dulu dua baris ini selalu berbunyi "Connected" tanpa memeriksa
              apa pun. Sekarang dihitung dari channel yang benar-benar ada:
              sebuah channel "siap" hanya bila aktif DAN punya kunci Zernio
              serta accountId. Indikator status yang tidak pernah salah
              adalah indikator yang tidak berguna.
            */}
            <div
              className={`flex items-center gap-1.5 text-xs ${
                readyChannels > 0 ? "text-success" : "text-text-muted"
              }`}
            >
              <span className={`status-dot ${readyChannels > 0 ? "active" : "draft"}`} />
              <span>
                {channels.length === 0
                  ? "Belum ada channel"
                  : `${readyChannels}/${channels.length} channel siap`}
              </span>
            </div>
          </div>

          {/* Operator + keluar */}
          <div className="px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs text-text-muted truncate" title={user.username}>
              {user.username}
            </span>
            <button
              onClick={logout}
              className="text-xs text-text-muted hover:text-text-primary transition-fast flex-shrink-0"
            >
              Keluar
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-shrink-0 bg-bg-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{displayDate}</span>
            <span className="text-border">·</span>
            <span className="text-xs font-mono text-text-muted">WIB (UTC+7)</span>
          </div>

          <div className="flex items-center gap-2">
            {toast && (
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-success/12 text-success">
                <span className="status-dot published" />
                {toast}
              </div>
            )}
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-fast hover:opacity-90 bg-accent text-bg-0"
            >
              + Upload Video
            </button>
          </div>
        </div>

        {/* Screen content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {screen === "dashboard" && <Dashboard onAddChannel={() => openChannelForm(null)} />}
          {screen === "channels" && (
            <Channels
              onAddChannel={() => openChannelForm(null)}
              onEditChannel={(id) => openChannelForm(id)}
            />
          )}
          {screen === "add-channel" && (
            <AddChannel
              key={editingChannelId ?? "new"}
              editingChannelId={editingChannelId}
              onSave={() => navigate("channels")}
              onCancel={() => navigate("channels")}
            />
          )}
          {screen === "library" && <ContentLibrary onUpload={() => setShowUpload(true)} />}
          {screen === "schedule" && <Schedule />}
          {screen === "analytics" && <Analytics />}
          {screen === "logs" && <ActivityLogs />}
          {screen === "settings" && <Settings />}
        </div>
      </div>

      {/* Upload modal */}
      {showUpload && (
        <UploadFlow onClose={() => setShowUpload(false)} onConfirm={handleConfirmUpload} />
      )}
    </div>
  );
}
