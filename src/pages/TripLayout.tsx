import { NavLink, Outlet, useParams } from 'react-router-dom';
import { TripProvider, useTrip } from '../context/TripContext';

function TripLayoutInner() {
  const { tripId } = useParams();
  const { trip, loading, isEditable } = useTrip();

  if (loading) return <div className="p-8 text-river-500">Indlæser rejse…</div>;
  if (!trip) return <div className="p-8 text-river-500">Rejsen blev ikke fundet.</div>;

  const tabs = [
    { to: `/rejser/${tripId}`, label: 'Overblik', end: true },
    { to: `/rejser/${tripId}/pakkeliste`, label: 'Pakkeliste' },
    { to: `/rejser/${tripId}/rejseplan`, label: 'Rejseplan' },
    { to: `/rejser/${tripId}/regnskab`, label: 'Regnskab' },
    { to: `/rejser/${tripId}/koersel`, label: 'Kørsel' },
  ];

  if (trip.trip_type === 'gudenaa') {
    tabs.push(
      { to: `/rejser/${tripId}/ruteplanlaegger`, label: 'Ruteplanlægger' },
      { to: `/rejser/${tripId}/statistik`, label: 'Statistik' },
      { to: `/rejser/${tripId}/sejltider`, label: 'Sejltider' }
    );
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

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-river-100 pb-2">
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

export default function TripLayout() {
  return (
    <TripProvider>
      <TripLayoutInner />
    </TripProvider>
  );
}
