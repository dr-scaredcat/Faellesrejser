export interface Profile {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  created_at: string;
}

export type TripType = 'standard' | 'gudenaa';

export interface Trip {
  id: string;
  name: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  trip_type: TripType;
  created_by: string;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
}

export interface TripMember {
  trip_id: string;
  user_id: string;
  invited_by: string | null;
  joined_at: string;
  profile?: Profile;
}

export interface TripPair {
  id: string;
  trip_id: string;
  member1_id: string;
  member2_id: string | null;
  label: string | null;
  created_at: string;
}

export interface PackingCategory {
  id: string;
  trip_id: string;
  name: string;
  sort_order: number;
  /** Kan slås fra pr. rejse uden at blive slettet, fx "Grej" på en tur uden bagage. */
  is_enabled: boolean;
}

export interface PackingItem {
  id: string;
  category_id: string;
  name: string;
  created_by: string | null;
}

export interface PackingItemStatus {
  item_id: string;
  user_id: string;
  packed: boolean;
  packed_at: string | null;
  profile?: Profile;
}

export interface ItineraryItem {
  id: string;
  trip_id: string;
  title: string;
  address: string | null;
  starts_at: string | null;
  ends_at: string | null;
  info: string | null;
  booking_reference: string | null;
  contact_info: string | null;
  cost: number | null;
  sort_order: number;
}

export interface Expense {
  id: string;
  trip_id: string;
  description: string;
  category: string;
  amount: number;
  paid_by: string;
  expense_date: string;
  /**
   * Posten er gjort op uden om det løbende regnskab — typisk fordi alle har
   * overført deres andel direkte til den, der lagde ud (fx selve rejsen,
   * betalt inden afrejse). Beløbet tæller stadig med i det samlede forbrug,
   * men indgår slet ikke i "hvem skylder hvem".
   */
  is_settled: boolean;
  paid_by_profile?: Profile;
  participant_ids?: string[];
}

export interface ExpenseCategory {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

/**
 * En faktisk overførsel mellem to personer på en rejse — fx når man krydser
 * en linje af under "hvem skylder hvem". Registreres altid person-til-person,
 * også når regnskabet vises pr. par, for det er personer der sender penge.
 */
export interface Settlement {
  id: string;
  trip_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  settled_on: string;
  note: string | null;
  created_by: string;
  created_at: string;
}

export type EnergyType = 'benzin' | 'diesel' | 'el';

export interface Vehicle {
  id: string;
  name: string;
  energy_type: EnergyType;
  /** Producentens oplyste kapacitet. Den målte regnes ud af ladningerne. */
  battery_capacity_kwh: number | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

/**
 * En opladning eller tankning. Kan registreres frit — også hjemme mellem
 * ture, hvor trip_id er tom.
 *
 * `amount` er kWh for el og liter for brændstof; `price_per_unit` er
 * tilsvarende kr/kWh eller kr/liter.
 */
export interface EnergyPurchase {
  id: string;
  vehicle_id: string;
  user_id: string;
  trip_id: string | null;
  purchased_on: string;
  energy_type: EnergyType;
  amount: number;
  price_per_unit: number | null;
  total_cost: number | null;
  /** Kun for el: ladeprocent før og efter. Bruges til kapacitetsberegningen. */
  start_soc_percent: number | null;
  end_soc_percent: number | null;
  /** kWh målt ved laderen inkluderer ladetab; målt i bilen gør ikke. */
  measured_at_charger: boolean;
  location_label: string | null;
  location_type: 'hjemme' | 'offentlig' | 'arbejde' | 'andet' | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  vehicle?: Vehicle;
}

export interface DrivingLog {
  id: string;
  trip_id: string;
  user_id: string;
  vehicle_id: string | null;
  /** Bevaret af hensyn til gamle registreringer. Brug vehicle_id fremover. */
  vehicle_label: string | null;
  distance_km: number;
  energy_type: EnergyType;
  energy_amount: number;
  log_date: string;
  notes: string | null;
  /** Udgiften kørslen er lagt ind som. Tom = endnu ikke i regnskabet. */
  expense_id: string | null;
  profile?: Profile;
  vehicle?: Vehicle;
}

/**
 * Et klikbart udsnit på Gudenå-oversigtskortet, der åbner et mere detaljeret
 * kort. Positionen er gemt som procent af oversigtskortets bredde/højde
 * (0-100), ikke pixels, så den rammer rigtigt uanset skærmstørrelse.
 */
export interface GudenaaMapSection {
  id: string;
  label: string;
  storage_path: string;
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
  sort_order: number;
}

export interface GudenaaStop {
  id: string;
  name: string;
  sort_order: number;
  distance_from_previous_km: number;
  sail_time_hours: number;
  /**
   * Samlet retning for strækket fra forrige stop til dette, i grader med uret
   * fra nord. Null hvis den ikke er angivet endnu.
   */
  bearing_degrees: number | null;
  description: string | null;
  tags?: string[];
}

export interface RoutePlan {
  id: string;
  trip_id: string;
  start_stop_id: string;
  num_days: number;
}

export interface RoutePlanDay {
  id: string;
  route_plan_id: string;
  day_number: number;
  end_stop_id: string | null;
}

export interface SailingTime {
  id: string;
  trip_id: string | null;
  user_id: string;
  start_stop_id: string;
  end_stop_id: string;
  total_time_hours: number;
  sailing_time_hours: number;
  sail_date: string;
  profile?: Profile;
}

/**
 * Sejltid beriget med dagens vandføring, som den kommer fra viewet
 * `sailing_times_with_flow`.
 *
 * `flow_ratio` er det tal, beregningerne skal bruge: vandføringen divideret
 * med medianen for årstiden på den pågældende målestation. Rå m³/s kan ikke
 * sammenlignes mellem Åstedbro og Ulstrup, men forholdstallet kan.
 */
export interface SailingTimeWithFlow extends SailingTime {
  flow_upstream_m3s: number | null;
  flow_upstream_ratio: number | null;
  flow_upstream_percentile: number | null;
  flow_downstream_m3s: number | null;
  flow_downstream_ratio: number | null;
  flow_downstream_percentile: number | null;
  /** Den station der havde data. Falder tilbage til den anden, hvis en logger svigtede. */
  flow_ratio: number | null;
  flow_source: 'opstroems_tange' | 'nedstroems_tange' | null;

  /**
   * Døgnets vindvektor. Det er DISSE to der skal bruges til at beregne med-
   * og modvind — de har allerede udlignet vind, der skiftede retning i løbet
   * af dagen. Retningen er den vinden kom FRA, meteorologisk konvention.
   */
  wind_speed_ms: number | null;
  wind_dir_degrees: number | null;
  /** Hvor meget det blæste uanset retning. Kun til visning. */
  wind_scalar_speed_ms: number | null;
  /** 0-1. Tæt på 1 = vinden holdt retning hele dagen. */
  wind_steadiness: number | null;
}
