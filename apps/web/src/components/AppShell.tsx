import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  AudioWaveform,
  Boxes,
  FolderOpen,
  Home,
  Library,
  ListMusic,
  Menu,
  Music,
  Scissors,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Waves,
  X,
} from "lucide-react";
import { api } from "../api/client";
import { useI18n } from "../i18n";
import { classNames } from "../lib/format";
import { usePolling } from "../lib/hooks";
import { useSettings } from "../state/settings";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}

export function AppShell() {
  const { t } = useI18n();
  const { online, settings } = useSettings();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeJobs, setActiveJobs] = useState<number | null>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  usePolling(async () => {
    try {
      const jobs = await api.jobs();
      setActiveJobs(jobs.filter((job) => job.status === "queued" || job.status === "running").length);
    } catch {
      setActiveJobs(null);
    }
  }, 15000);

  const createItems: NavItem[] = [
    { to: "/generate/music", label: t("nav.music"), icon: Music },
    { to: "/generate/sfx", label: t("nav.sfx"), icon: Sparkles },
    { to: "/generate/ambient", label: t("nav.ambient"), icon: Waves },
  ];
  const workspaceItems: NavItem[] = [
    { to: "/", label: t("nav.home"), icon: Home, end: true },
    { to: "/editor", label: t("nav.editor"), icon: Scissors },
    { to: "/studio", label: t("nav.studio"), icon: SlidersHorizontal },
    { to: "/library", label: t("nav.library"), icon: Library },
  ];
  const manageItems: NavItem[] = [
    { to: "/models", label: t("nav.models"), icon: Boxes },
    { to: "/queue", label: t("nav.queue"), icon: ListMusic },
    { to: "/settings", label: t("nav.settings"), icon: Settings },
  ];

  const renderItem = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => classNames("nav__link", isActive && "is-active")}
      onClick={() => setMenuOpen(false)}
    >
      <item.icon size={17} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <div className={classNames("app-shell", menuOpen && "menu-open")}>
      <a className="skip-link" href="#main-content">
        {t("a11y.skipToContent")}
      </a>
      <aside className="sidebar" aria-label={t("a11y.mainNavigation")}>
        <div className="sidebar__brand">
          <span className="brand-mark" aria-hidden="true">
            <AudioWaveform size={20} />
          </span>
          <div>
            <span className="brand-name">{t("app.name")}</span>
            <span className="brand-tagline">{t("app.localFirst")}</span>
          </div>
          <button
            type="button"
            className="icon-button sidebar__close"
            aria-label={t("a11y.closeMenu")}
            onClick={() => setMenuOpen(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="nav">
          <div className="nav__group">
            <span className="nav__label">{t("nav.workspace")}</span>
            {workspaceItems.map(renderItem)}
          </div>
          <div className="nav__group">
            <span className="nav__label">{t("nav.create")}</span>
            {createItems.map(renderItem)}
          </div>
          <div className="nav__group">
            <span className="nav__label">{t("nav.manage")}</span>
            {manageItems.map(renderItem)}
          </div>
        </nav>

        <div className="sidebar__footer">
          <NavLink
            to="/queue"
            className="service-status"
            title={online === null ? t("nav.connecting") : online ? t("nav.online") : t("nav.offline")}
          >
            <span
              className={classNames(
                "status-dot",
                online === null && "status-dot--unknown",
                online === true && "status-dot--online",
                online === false && "status-dot--offline",
              )}
              aria-hidden="true"
            />
            <span>
              <strong>
                {online === null
                  ? t("nav.connecting")
                  : online
                    ? t("nav.online")
                    : t("nav.offline")}
              </strong>
              <small>
                {activeJobs === null
                  ? t("nav.noActiveJobs")
                  : activeJobs > 0
                    ? t("nav.activeJobs", { count: activeJobs })
                    : t("nav.noActiveJobs")}
              </small>
            </span>
          </NavLink>
          {settings && !settings.onboarding_complete ? (
            <NavLink to="/onboarding" className="sidebar__setup">
              <Sparkles size={15} aria-hidden="true" />
              {t("home.startSetup")}
            </NavLink>
          ) : null}
        </div>
      </aside>

      <button
        type="button"
        className="sidebar-scrim"
        aria-label={t("a11y.closeMenu")}
        onClick={() => setMenuOpen(false)}
        tabIndex={-1}
      />

      <div className="app-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar__menu"
            aria-label={t("a11y.openMenu")}
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="topbar__title">
            <strong>{t("app.name")}</strong>
            <span>{t("app.tagline")}</span>
          </div>
          <div className="topbar__actions">
            <NavLink to="/library" className="topbar__link">
              <FolderOpen size={15} aria-hidden="true" />
              <span>{t("nav.library")}</span>
            </NavLink>
            <NavLink to="/queue" className="topbar__link">
              <ListMusic size={15} aria-hidden="true" />
              <span>
                {activeJobs && activeJobs > 0
                  ? t("nav.activeJobs", { count: activeJobs })
                  : t("nav.noActiveJobs")}
              </span>
            </NavLink>
          </div>
        </header>

        <main id="main-content" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
