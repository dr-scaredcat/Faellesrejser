import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useMutate } from '../hooks/useMutate';
import { DatePicker } from '../components/DatePicker';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';
import {
  capacityEstimates,
  computeVehicleStats,
  drivingCost,
  priceSpread,
  MIN_SOC_DELTA,
} from '../lib/drivingStats';
import type { DrivingLog, EnergyPurchase, EnergyType, Vehicle } from '../lib/types';

type Tab = 'koersel' | 'energi' | 'statistik';

const ENERGY_LABELS: Record<EnergyType, string> = {
  el: 'El',
  benzin: 'Benzin',
  diesel: 'Diesel',
};

const LOCATION_LABELS: Record<string, string> = {
  hjemme: 'Hjemme',
  offentlig: 'Offentlig lader',
  arbejde: 'Arbejde',
  andet: 'Andet',
};

const unit = (type: EnergyType) => (type === 'el' ? 'kWh' : 'liter');

export default function DrivingPage() {
  const { trip, members, namesById, isEditable } = useTrip();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const mutate = useMutate();

  const [tab, setTab] = useState<Tab>('koersel');
  const [logs, setLogs] = useState<DrivingLog[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [purchases, setPurchases] = useState<EnergyPurchase[]>([]);
  const [onlyThisTrip, setOnlyThisTrip] = useState(false);

  // Kørsel
  const [showForm, setShowForm] = useState(false);
  const [vehicleId, setVehicleId] = useState('');
  const [distance, setDistance] = useState('');
  const [energyType, setEnergyType] = useState<EnergyType>('el');
  const [energyAmount, setEnergyAmount] = useState('');
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  // Ny bil
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [newVehicleName, setNewVehicleName] = useState('');
  const [newVehicleType, setNewVehicleType] = useState<EnergyType>('el');
  const [newVehicleCapacity, setNewVehicleCapacity] = useState('');

  // Opladning / tankning
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [pVehicleId, setPVehicleId] = useState('');
  const [pDate, setPDate] = useState(new Date().toISOString().slice(0, 10));
  const [pAmount, setPAmount] = useState('');
  const [pPrice, setPPrice] = useState('');
  const [pStartSoc, setPStartSoc] = useState('');
  const [pEndSoc, setPEndSoc] = useState('');
  const [pAtCharger, setPAtCharger] = useState(true);
  const [pLocationType, setPLocationType] = useState('');
  const [pLocationLabel, setPLocationLabel] = useState('');
  const [pDuration, setPDuration] = useState('');
  const [pNotes, setPNotes] = useState('');
  const [pLinkTrip, setPLinkTrip] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  // Standarddato for en ny registrering er rejsens første dag, ikke dags
  // dato — man logger typisk kørsel efterfølgende, ofte for hele turen.
  useEffect(() => {
    setLogDate(trip?.start_date ?? new Date().toISOString().slice(0, 10));
  }, [trip?.start_date]);

  async function load() {
    const [{ data: vehicleData }, { data: purchaseData }] = await Promise.all([
      supabase.from('vehicles').select('*').eq('is_active', true).order('name'),
      supabase.from('energy_purchases').select('*').order('purchased_on', { ascending: false }),
    ]);
    setVehicles((vehicleData as Vehicle[]) ?? []);
    setPurchases((purchaseData as EnergyPurchase[]) ?? []);

    if (!trip) return;
    const { data } = await supabase
      .from('driving_logs')
      .select('*, profile:profiles(*)')
      .eq('trip_id', trip.id)
      .order('log_date', { ascending: false });
    setLogs((data as unknown as DrivingLog[]) ?? []);
  }

  const vehicleById = useMemo(() => {
    const map: Record<string, Vehicle> = {};
    for (const v of vehicles) map[v.id] = v;
    return map;
  }, [vehicles]);

  // Bilen bestemmer energitypen — vælger man en elbil, giver det ingen mening
  // at kunne sætte "benzin" ved siden af.
  const valgtBil = vehicleId ? vehicleById[vehicleId] : undefined;
  const aktivEnergiType = valgtBil?.energy_type ?? energyType;

  const pVehicle = pVehicleId ? vehicleById[pVehicleId] : undefined;
  const pEnergyType = pVehicle?.energy_type ?? 'el';

  const stats = useMemo(
    () => computeVehicleStats(vehicles, logs, purchases),
    [vehicles, logs, purchases]
  );
  const statsById = useMemo(() => {
    const map: Record<string, (typeof stats)[number]> = {};
    for (const s of stats) map[s.vehicle.id] = s;
    return map;
  }, [stats]);

  async function handleCreateVehicle(e: FormEvent) {
    e.preventDefault();
    if (!profile || !newVehicleName.trim()) return;

    const { data, ok } = await mutate(
      supabase
        .from('vehicles')
        .insert({
          name: newVehicleName.trim(),
          energy_type: newVehicleType,
          battery_capacity_kwh: newVehicleCapacity ? Number(newVehicleCapacity) : null,
          created_by: profile.id,
        })
        .select()
        .single(),
      { fallback: 'Bilen kunne ikke oprettes. Findes der allerede en med samme navn?' }
    );
    if (!ok || !data) return;

    setNewVehicleName('');
    setNewVehicleCapacity('');
    setShowVehicleForm(false);
    await load();
    const nyId = (data as Vehicle).id;
    setVehicleId(nyId);
    setPVehicleId(nyId);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trip || !profile) return;

    const { ok } = await mutate(
      supabase.from('driving_logs').insert({
        trip_id: trip.id,
        user_id: profile.id,
        vehicle_id: vehicleId || null,
        vehicle_label: valgtBil?.name ?? null,
        distance_km: Number(distance),
        energy_type: aktivEnergiType,
        energy_amount: Number(energyAmount),
        log_date: logDate,
        notes: notes || null,
      })
    );
    if (!ok) return;

    setDistance('');
    setEnergyAmount('');
    setNotes('');
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Slet denne kørsel?')) return;
    const { ok } = await mutate(supabase.from('driving_logs').delete().eq('id', id));
    if (ok) load();
  }

  async function handleAddPurchase(e: FormEvent) {
    e.preventDefault();
    if (!profile || !pVehicleId) return;

    const { ok } = await mutate(
      supabase.from('energy_purchases').insert({
        vehicle_id: pVehicleId,
        user_id: profile.id,
        trip_id: pLinkTrip && trip ? trip.id : null,
        purchased_on: pDate,
        energy_type: pEnergyType,
        amount: Number(pAmount),
        price_per_unit: pPrice ? Number(pPrice) : null,
        start_soc_percent: pEnergyType === 'el' && pStartSoc ? Number(pStartSoc) : null,
        end_soc_percent: pEnergyType === 'el' && pEndSoc ? Number(pEndSoc) : null,
        measured_at_charger: pAtCharger,
        location_type: pLocationType || null,
        location_label: pLocationLabel || null,
        duration_minutes: pDuration ? Number(pDuration) : null,
        notes: pNotes || null,
      }),
      { success: 'Registreringen er gemt.' }
    );
    if (!ok) return;

    setPAmount('');
    setPPrice('');
    setPStartSoc('');
    setPEndSoc('');
    setPLocationLabel('');
    setPDuration('');
    setPNotes('');
    setShowPurchaseForm(false);
    load();
  }

  async function handleDeletePurchase(id: string) {
    if (!confirm('Slet denne registrering?')) return;
    const { ok } = await mutate(supabase.from('energy_purchases').delete().eq('id', id));
    if (ok) load();
  }

  /**
   * Lægger kørslen ind som en udgift i rejsens regnskab.
   *
   * Beløbet beregnes af bilens vægtede gennemsnitspris. Er der ingen prissatte
   * køb på bilen, kan vi ikke vide, hvad kørslen kostede — og så er det bedre
   * at sige det end at gætte.
   */
  async function handleAddToExpenses(log: DrivingLog) {
    if (!trip || !profile) return;

    const bilStats = log.vehicle_id ? statsById[log.vehicle_id] : undefined;
    const beloeb = drivingCost(log, bilStats);

    if (beloeb == null) {
      showToast(
        'Prisen er ukendt. Registrér en opladning eller tankning med pris på bilen først, så kan beløbet beregnes.',
        'error'
      );
      return;
    }

    const bilNavn = log.vehicle_id ? vehicleById[log.vehicle_id]?.name : log.vehicle_label;

    const { data, ok } = await mutate(
      supabase.rpc('save_expense', {
        _expense_id: null,
        _trip_id: trip.id,
        _description: `Kørsel${bilNavn ? `: ${bilNavn}` : ''}, ${formatNumber(log.distance_km, 0)} km`,
        _category: 'Transport',
        _amount: Math.round(beloeb * 100) / 100,
        _paid_by: log.user_id,
        _expense_date: log.log_date,
        _participants: members.map((m) => m.user_id),
      })
    );
    if (!ok) return;

    await mutate(
      supabase.from('driving_logs').update({ expense_id: data as string }).eq('id', log.id),
      { success: `Kørslen er lagt i regnskabet med ${formatCurrency(beloeb)}.` }
    );
    load();
  }

  const totalKm = logs.reduce((s, l) => s + Number(l.distance_km), 0);
  const synligeKoeb = onlyThisTrip ? purchases.filter((p) => p.trip_id === trip?.id) : purchases;
  const spread = useMemo(() => priceSpread(purchases), [purchases]);

  function efficiencyLabel(type: EnergyType, km: number, energy: number) {
    if (energy === 0) return '–';
    return `${formatNumber(km / energy, 2)} km/${type === 'el' ? 'kWh' : 'l'}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-1 text-xs">
        <button
          className={`tab ${tab === 'koersel' ? 'tab-active' : 'tab-inactive'}`}
          onClick={() => setTab('koersel')}
        >
          Kørsel
        </button>
        <button
          className={`tab ${tab === 'energi' ? 'tab-active' : 'tab-inactive'}`}
          onClick={() => setTab('energi')}
        >
          Opladning og tankning
        </button>
        <button
          className={`tab ${tab === 'statistik' ? 'tab-active' : 'tab-inactive'}`}
          onClick={() => setTab('statistik')}
        >
          Statistik
        </button>
      </div>

      {tab === 'koersel' && (
        <>
          <div className="card p-5">
            <h2 className="mb-1 font-semibold text-river-800">
              Samlet på denne rejse: {formatNumber(totalKm, 1)} km
            </h2>
            {logs.length === 0 && <p className="text-sm text-river-400">Ingen kørsel registreret endnu.</p>}
          </div>

          <div className="space-y-3">
            {logs.map((log) => {
              const bil = log.vehicle_id ? vehicleById[log.vehicle_id] : undefined;
              const bilStats = log.vehicle_id ? statsById[log.vehicle_id] : undefined;
              const pris = drivingCost(log, bilStats);

              return (
                <div key={log.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-river-800">
                        {bil?.name || log.vehicle_label || 'Køretøj'} ·{' '}
                        {formatNumber(log.distance_km, 1)} km
                      </p>
                      <p className="text-sm text-river-500">
                        {formatNumber(log.energy_amount, 2)} {unit(log.energy_type)} (
                        {ENERGY_LABELS[log.energy_type]}) —{' '}
                        {efficiencyLabel(
                          log.energy_type,
                          Number(log.distance_km),
                          Number(log.energy_amount)
                        )}
                        {pris != null && <> · ca. {formatCurrency(pris)}</>}
                      </p>
                      <p className="text-xs text-river-400">
                        {namesById[log.user_id] ?? '?'} · {formatDate(log.log_date)}
                        {log.notes ? ` · ${log.notes}` : ''}
                      </p>
                    </div>
                    {isEditable && (
                      <button
                        className="shrink-0 text-xs text-red-500 hover:underline"
                        onClick={() => handleDelete(log.id)}
                      >
                        Slet
                      </button>
                    )}
                  </div>

                  {isEditable && (
                    <div className="mt-2 border-t border-river-100 pt-2">
                      {log.expense_id ? (
                        <span className="text-xs text-river-400">Lagt i regnskabet</span>
                      ) : (
                        <button
                          className="text-xs text-river-600 hover:underline"
                          onClick={() => handleAddToExpenses(log)}
                        >
                          Læg i regnskabet
                          {pris != null ? ` (${formatCurrency(pris)})` : ''}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isEditable && !showForm && (
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              + Registrér kørsel
            </button>
          )}

          {isEditable && showForm && (
            <form onSubmit={handleSubmit} className="card space-y-3 p-5">
              <VehiclePicker
                vehicles={vehicles}
                value={vehicleId}
                onChange={setVehicleId}
                onCreateNew={() => setShowVehicleForm(true)}
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Distance (km)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Energitype</label>
                  <select
                    className="input"
                    value={aktivEnergiType}
                    onChange={(e) => setEnergyType(e.target.value as EnergyType)}
                    disabled={!!valgtBil}
                  >
                    <option value="el">El</option>
                    <option value="benzin">Benzin</option>
                    <option value="diesel">Diesel</option>
                  </select>
                  {valgtBil && (
                    <p className="mt-1 text-xs text-river-400">Følger den valgte bil.</p>
                  )}
                </div>
              </div>

              <div>
                <label className="label">Forbrug ({unit(aktivEnergiType)})</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={energyAmount}
                  onChange={(e) => setEnergyAmount(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Dato</label>
                <DatePicker value={logDate} onChange={setLogDate} />
              </div>

              <textarea
                className="input"
                placeholder="Noter"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />

              <div className="flex gap-2">
                <button className="btn-primary">Gem</button>
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                  Annuller
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {tab === 'energi' && (
        <>
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-river-800">Opladninger og tankninger</h2>
              {trip && (
                <label className="flex items-center gap-1 text-xs text-river-500">
                  <input
                    type="checkbox"
                    checked={onlyThisTrip}
                    onChange={(e) => setOnlyThisTrip(e.target.checked)}
                  />
                  Kun denne rejse
                </label>
              )}
            </div>
            <p className="mt-1 text-sm text-river-500">
              Kan registreres frit — også hjemme mellem ture. Ladeprocenterne bruges til at beregne
              batteriets faktiske kapacitet.
            </p>
          </div>

          <div className="space-y-3">
            {synligeKoeb.map((p) => {
              const bil = vehicleById[p.vehicle_id];
              const delta =
                p.start_soc_percent != null && p.end_soc_percent != null
                  ? p.end_soc_percent - p.start_soc_percent
                  : null;

              return (
                <div key={p.id} className="card flex items-start justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium text-river-800">
                      {bil?.name ?? 'Ukendt bil'} · {formatNumber(p.amount, 2)}{' '}
                      {unit(p.energy_type)}
                      {p.total_cost != null && <> · {formatCurrency(p.total_cost)}</>}
                    </p>
                    <p className="text-sm text-river-500">
                      {p.price_per_unit != null && (
                        <>
                          {formatCurrency(p.price_per_unit)} pr. {unit(p.energy_type)}
                        </>
                      )}
                      {delta != null && (
                        <>
                          {p.price_per_unit != null && ' · '}
                          {p.start_soc_percent}% → {p.end_soc_percent}%
                          {delta < MIN_SOC_DELTA && (
                            <span
                              className="text-river-400"
                              title={`Spring under ${MIN_SOC_DELTA} procentpoint tæller ikke med i kapacitetsberegningen, fordi afrundingen på procenterne gør buddet for usikkert.`}
                            >
                              {' '}
                              (for lille spring)
                            </span>
                          )}
                        </>
                      )}
                    </p>
                    <p className="text-xs text-river-400">
                      {formatDate(p.purchased_on)}
                      {p.location_type && ` · ${LOCATION_LABELS[p.location_type]}`}
                      {p.location_label && ` · ${p.location_label}`}
                      {namesById[p.user_id] && ` · ${namesById[p.user_id]}`}
                      {p.trip_id && p.trip_id === trip?.id && ' · denne rejse'}
                    </p>
                  </div>
                  {p.user_id === profile?.id && (
                    <button
                      className="shrink-0 text-xs text-red-500 hover:underline"
                      onClick={() => handleDeletePurchase(p.id)}
                    >
                      Slet
                    </button>
                  )}
                </div>
              );
            })}
            {synligeKoeb.length === 0 && (
              <p className="text-sm text-river-400">Ingen registreringer endnu.</p>
            )}
          </div>

          {!showPurchaseForm && (
            <button className="btn-primary" onClick={() => setShowPurchaseForm(true)}>
              + Tilføj opladning eller tankning
            </button>
          )}

          {showPurchaseForm && (
            <form onSubmit={handleAddPurchase} className="card space-y-3 p-5">
              <VehiclePicker
                vehicles={vehicles}
                value={pVehicleId}
                onChange={setPVehicleId}
                onCreateNew={() => setShowVehicleForm(true)}
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Mængde ({unit(pEnergyType)})</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={pAmount}
                    onChange={(e) => setPAmount(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Pris pr. {unit(pEnergyType)}</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={pPrice}
                    onChange={(e) => setPPrice(e.target.value)}
                  />
                </div>
              </div>

              {pEnergyType === 'el' && (
                <div className="space-y-3 rounded-lg border border-river-100 p-3">
                  <p className="text-xs text-river-500">
                    Ladeprocenterne bruges til at beregne batteriets kapacitet. Spring på mindst{' '}
                    {MIN_SOC_DELTA} procentpoint tæller med — mindre ladninger gemmes stadig og tæller i
                    økonomien.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Ladeprocent før</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className="input"
                        value={pStartSoc}
                        onChange={(e) => setPStartSoc(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label">Ladeprocent efter</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className="input"
                        value={pEndSoc}
                        onChange={(e) => setPEndSoc(e.target.value)}
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-sm text-river-600">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={pAtCharger}
                      onChange={(e) => setPAtCharger(e.target.checked)}
                    />
                    <span>
                      kWh er aflæst ved laderen
                      <span className="block text-xs text-river-400">
                        Ved AC-ladning går typisk 10-15% tabt som varme, så kapaciteten bliver en anelse
                        for høj. Aflæser du i stedet i bilen, så fjern fluebenet.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Sted</label>
                  <select
                    className="input"
                    value={pLocationType}
                    onChange={(e) => setPLocationType(e.target.value)}
                  >
                    <option value="">Ikke angivet</option>
                    <option value="hjemme">Hjemme</option>
                    <option value="offentlig">Offentlig lader</option>
                    <option value="arbejde">Arbejde</option>
                    <option value="andet">Andet</option>
                  </select>
                </div>
                <div>
                  <label className="label">Navn på stedet</label>
                  <input
                    className="input"
                    placeholder="fx Ionity Skanderborg"
                    value={pLocationLabel}
                    onChange={(e) => setPLocationLabel(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Dato</label>
                  <DatePicker value={pDate} onChange={setPDate} />
                </div>
                <div>
                  <label className="label">Varighed (min, valgfrit)</label>
                  <input
                    type="number"
                    className="input"
                    value={pDuration}
                    onChange={(e) => setPDuration(e.target.value)}
                  />
                </div>
              </div>

              <textarea
                className="input"
                placeholder="Noter"
                value={pNotes}
                onChange={(e) => setPNotes(e.target.value)}
              />

              {trip && (
                <label className="flex items-center gap-2 text-sm text-river-600">
                  <input
                    type="checkbox"
                    checked={pLinkTrip}
                    onChange={(e) => setPLinkTrip(e.target.checked)}
                  />
                  Knyt til denne rejse
                </label>
              )}

              <div className="flex gap-2">
                <button className="btn-primary" disabled={!pVehicleId}>
                  Gem
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPurchaseForm(false)}
                >
                  Annuller
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {tab === 'statistik' && (
        <>
          {stats.length === 0 && (
            <div className="card p-8 text-center text-river-400">
              Opret en bil og registrér kørsel eller opladning for at se statistik her.
            </div>
          )}

          {stats.map((s) => {
            const estimater = capacityEstimates(purchases.filter((p) => p.vehicle_id === s.vehicle.id));
            return (
              <div key={s.vehicle.id} className="card space-y-3 p-5">
                <div>
                  <h3 className="font-semibold text-river-800">{s.vehicle.name}</h3>
                  <p className="text-xs text-river-400">
                    {ENERGY_LABELS[s.vehicle.energy_type]} · {s.drivingCount} kørsler ·{' '}
                    {s.purchaseCount} {s.vehicle.energy_type === 'el' ? 'opladninger' : 'tankninger'}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Fact label="Kørt i alt" value={`${formatNumber(s.totalKm, 1)} km`} />
                  <Fact
                    label="Forbrug"
                    value={
                      s.efficiency != null
                        ? `${formatNumber(s.efficiency, 2)} km/${s.vehicle.energy_type === 'el' ? 'kWh' : 'l'}`
                        : '–'
                    }
                  />
                  <Fact
                    label="Pris pr. km"
                    value={s.costPerKm != null ? formatCurrency(s.costPerKm) : '–'}
                    sub={
                      s.averageUnitPrice != null
                        ? `${formatCurrency(s.averageUnitPrice)} pr. ${unit(s.vehicle.energy_type)}`
                        : undefined
                    }
                  />

                  {s.vehicle.energy_type === 'el' && (
                    <>
                      <Fact
                        label="Målt kapacitet"
                        value={
                          s.measuredCapacityKwh != null
                            ? `${formatNumber(s.measuredCapacityKwh, 1)} kWh`
                            : '–'
                        }
                        sub={
                          s.capacitySampleCount > 0
                            ? `median af ${s.capacitySampleCount} ladninger`
                            : `kræver ladninger med mindst ${MIN_SOC_DELTA} procentpoints spring`
                        }
                      />
                      <Fact
                        label="Rækkevidde, fuld opladning"
                        value={
                          s.estimatedRangeKm != null
                            ? `${formatNumber(s.estimatedRangeKm, 0)} km`
                            : '–'
                        }
                        sub="kapacitet gange forbrug"
                      />
                      {s.vehicle.battery_capacity_kwh != null && s.measuredCapacityKwh != null && (
                        <Fact
                          label="Ift. oplyst kapacitet"
                          value={`${formatNumber(
                            (s.measuredCapacityKwh / Number(s.vehicle.battery_capacity_kwh) - 1) * 100,
                            1
                          )}%`}
                          sub={`oplyst ${formatNumber(s.vehicle.battery_capacity_kwh, 1)} kWh`}
                        />
                      )}
                    </>
                  )}

                  <Fact
                    label="Købt i alt"
                    value={`${formatNumber(s.purchasedAmount, 1)} ${unit(s.vehicle.energy_type)}`}
                    sub={s.totalCost != null ? `for ${formatCurrency(s.totalCost)}` : undefined}
                  />
                </div>

                {estimater.length > 1 && (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-river-400">
                      Kapacitet over tid
                    </p>
                    <ul className="space-y-0.5 text-sm text-river-600">
                      {estimater.map((e) => (
                        <li key={e.purchaseId}>
                          {formatDate(e.date)} — {formatNumber(e.capacityKwh, 1)} kWh
                          <span className="text-xs text-river-400">
                            {' '}
                            ({e.socDelta} procentpoint
                            {e.measuredAtCharger ? ', målt ved laderen' : ', målt i bilen'})
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-river-400">
                      Falder tallene systematisk over årene, er det batteriets ældning. Spredning mellem
                      enkeltmålinger er normal — derfor bruges medianen ovenfor.
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {spread.cheapest && spread.mostExpensive && (
            <div className="card space-y-2 p-5">
              <h3 className="font-semibold text-river-800">Priser</h3>
              <p className="text-sm text-river-600">
                Billigste: {formatCurrency(spread.cheapest.price_per_unit ?? 0)} pr.{' '}
                {unit(spread.cheapest.energy_type)}
                {spread.cheapest.location_label && ` (${spread.cheapest.location_label})`} ·{' '}
                {formatDate(spread.cheapest.purchased_on)}
              </p>
              <p className="text-sm text-river-600">
                Dyreste: {formatCurrency(spread.mostExpensive.price_per_unit ?? 0)} pr.{' '}
                {unit(spread.mostExpensive.energy_type)}
                {spread.mostExpensive.location_label && ` (${spread.mostExpensive.location_label})`} ·{' '}
                {formatDate(spread.mostExpensive.purchased_on)}
              </p>
              {spread.homeAverage != null && spread.publicAverage != null && (
                <p className="text-sm text-river-600">
                  Hjemme {formatCurrency(spread.homeAverage)} mod offentligt{' '}
                  {formatCurrency(spread.publicAverage)} i gennemsnit.
                </p>
              )}
              {spread.potentialSaving != null && spread.potentialSaving > 0 && (
                <p className="text-sm text-river-600">
                  Havde alt været ladet hjemme, var der sparet ca.{' '}
                  <strong>{formatCurrency(spread.potentialSaving)}</strong>.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {showVehicleForm && (
        <form onSubmit={handleCreateVehicle} className="card space-y-3 p-5">
          <h3 className="font-semibold text-river-800">Ny bil</h3>
          <div>
            <label className="label">Navn</label>
            <input
              className="input"
              placeholder="fx Tesla Model 3"
              value={newVehicleName}
              onChange={(e) => setNewVehicleName(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-river-400">
              Bilen deles med alle. Brug samme navn hver gang, ellers bliver statistikken delt op.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Energitype</label>
              <select
                className="input"
                value={newVehicleType}
                onChange={(e) => setNewVehicleType(e.target.value as EnergyType)}
              >
                <option value="el">El</option>
                <option value="benzin">Benzin</option>
                <option value="diesel">Diesel</option>
              </select>
            </div>
            {newVehicleType === 'el' && (
              <div>
                <label className="label">Oplyst kapacitet (kWh, valgfrit)</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={newVehicleCapacity}
                  onChange={(e) => setNewVehicleCapacity(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary">Opret</button>
            <button type="button" className="btn-secondary" onClick={() => setShowVehicleForm(false)}>
              Annuller
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function VehiclePicker({
  vehicles,
  value,
  onChange,
  onCreateNew,
  required,
}: {
  vehicles: Vehicle[];
  value: string;
  onChange: (value: string) => void;
  onCreateNew: () => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="label">Bil</label>
      <div className="flex gap-2">
        <select
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        >
          <option value="">{required ? 'Vælg bil' : 'Ingen bil valgt'}</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({ENERGY_LABELS[v.energy_type]})
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary shrink-0" onClick={onCreateNew}>
          Ny bil
        </button>
      </div>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-river-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-river-800">{value}</p>
      {sub && <p className="text-xs text-river-400">{sub}</p>}
    </div>
  );
}
