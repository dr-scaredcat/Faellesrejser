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
  is_settled: boolean;
  paid_by_profile?: Profile;
  participant_ids?: string[];
}

export interface DrivingLog {
  id: string;
  trip_id: string;
  user_id: string;
  vehicle_label: string | null;
  distance_km: number;
  energy_type: 'benzin' | 'diesel' | 'el';
  energy_amount: number;
  log_date: string;
  notes: string | null;
  profile?: Profile;
}

export interface GudenaaStop {
  id: string;
  name: string;
  sort_order: number;
  distance_from_previous_km: number;
  sail_time_hours: number;
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

export const EXPENSE_CATEGORIES = [
  'Mad/Drikke',
  'Transport',
  'Overnatning',
  'Grej',
  'Sjov',
  'Diverse',
] as const;
