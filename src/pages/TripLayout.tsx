import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { TripProvider, useTrip } from '../context/TripContext';
import { DEFAULT_TRIP_NAV_ORDER, orderedTripPages, parseTripNavOrder, tripPageHref } from '../lib/tripNav';

interface Tab {
  to: string;
  label: string;
  end?: boolean;
}

// Hvor mange faner der vises direkte på mobil, før resten samles under
// "Mere". Den fjerde plads er enten selve "Mere"-knappen, eller — hvis den
// aktive side ligger blandt de skjulte — navnet på netop den side, så man
// aldrig er i tvivl om, hvor man befinder sig.
const MOBILE_PRIMARY_COUNT = 3;

function TripLayoutInner() {
  const { tripId } = useParams();
  const { trip, loading, isEditable } = useTrip();
  const location = useLocation();
  const [navOrder, setNavOrder] = useState<string[]>(DEFAULT_TRIP_NAV_ORDER);

  // Rækkefølgen sættes på admin-siden "Navigation" og gælder for alle
  // rejser. Uafhængig af hvilken rejse man kigger på, så den hentes én gang,
  // ikke pr. rejseskift.
  useEffect(() => {
    let annulleret = false;
    supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'trip_nav_order')
      .maybeSingle()
      .then(({ data }) => {
        if (annulleret) return;
        setNavOrder(parseTripNavOrder(data?.value as string | undefined));
      });
    return () => {
      annulleret = true;
    };
  }, []);

  if (loading) return <div className="p-8 text-river-500">Indlæser rejse…</div>;
  if (!trip) return <div className="p-8 text-river-500">Rejsen blev ikke fundet.</div>;

  // Den globale rækkefølge filtreres til det, der er relevant for netop
  // denne rejsetype — de tre Gudenå-specifikke sider springes over på
  // almindelige rejser, men resten beholder deres indbyrdes rækkefølge.
  const tabs: Tab[] = orderedTripPages(navOrder, trip.trip_type === 'gudenaa').map((page) => ({
    to: tripPageHref(tripId!, page),
    label: page.label,
    end: page.end,
  }));

  function isTabActive(tab: Tab): boolean {
    return tab.end ? location.pathname === tab.to : location.pathname.startsWith(tab.to);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {trip.trip_type === 'gudenaa' && (
            <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-medium text-sand-500">
              Gudenåen
            </span>
          )}
          {!isEditable && (
            <span className="rounded-full bg-river-100 px-2 py-0.5 text-xs font-medium text-river-500">
              Arkiveret – skrivebeskyttet
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-river-800">{trip.name}</h1>
        <p className="text-sm text-river-500">{trip.destination}</p>
      </div>

      {/* Mobil: faste faner + "Mere"-menu, så skjulte sider aldrig kræver at
          nogen selv opdager, at baren kan scrolles. */}
      <div className="mb-6 sm:hidden">
        <MobileTabBar tabs={tabs} isTabActive={isTabActive} />
      </div>

      {/* Fra sm og op er der normalt plads til alle faner i én række. */}
      <div className="mb-6 hidden gap-1 overflow-x-auto border-b border-river-100 pb-2 sm:flex">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `tab ${isActive ? 'tab-active' : 'tab-inactive'}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}

function MobileTabBar({ tabs, isTabActive }: { tabs: Tab[]; isTabActive: (tab: Tab) => boolean }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const primaryTabs = tabs.slice(0, MOBILE_PRIMARY_COUNT);
  const restTabs = tabs.slice(MOBILE_PRIMARY_COUNT);
  const activeHiddenTab = restTabs.find(isTabActive);

  // Luk menuen ved klik udenfor eller Escape, så den ikke bliver hængende
  // åben, hvis man trykker et andet sted på siden.
  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Skifter automatisk til lukket, hver gang man rent faktisk navigerer et
  // sted hen — også hvis det sker på anden vis end via selve menuen.
  useEffect(() => {
    setOpen(false);
  }, [restTabs.map((t) => t.to).join(',')]);

  if (restTabs.length === 0) {
    // Færre end fire faner i alt — ingen grund til en "Mere"-knap.
    return (
      <div className="flex gap-1 border-b border-river-100 pb-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `tab min-w-0 flex-1 truncate text-center ${isActive ? 'tab-active' : 'tab-inactive'}`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
    );
  }

  return (
    <div className="relative border-b border-river-100 pb-2" ref={menuRef}>
      <div className="flex gap-1">
        {primaryTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `tab min-w-0 flex-1 truncate text-center ${isActive ? 'tab-active' : 'tab-inactive'}`
            }
          >
            {tab.label}
          </NavLink>
        ))}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`tab flex min-w-0 flex-1 items-center justify-center gap-1 text-center ${
            activeHiddenTab ? 'tab-active' : 'tab-inactive'
          }`}
        >
          <span className="min-w-0 truncate">{activeHiddenTab ? activeHiddenTab.label : 'Mere'}</span>
          <svg
            viewBox="0 0 20 20"
            className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <path
              d="M5 7.5 L10 12.5 L15 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-river-100 bg-surface py-1 shadow-lg"
        >
          {restTabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block px-4 py-2 text-sm ${
                  isActive ? 'bg-river-50 font-medium text-river-800' : 'text-river-600 hover:bg-river-50'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TripLayout() {
  return (
    <TripProvider>
      <TripLayoutInner />
    </TripProvider>
  );
}
